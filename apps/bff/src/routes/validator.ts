import express from "express";
import { domainOf } from "../domain";

// Route: validator pre-flight (guardrail views, customData, workflow pipeline, rules).

export const router = express.Router();

// 4. Pre-flight Validator Endpoint (Comprehensive Rule & Linter Guardrail)
router.post("/api/validator/check", (req, res) => {
  const { config } = req.body;
  const issues: Array<{ severity: "error" | "warning"; message: string; path?: string }> = [];

  if (!config || typeof config !== "object") {
    return res.status(400).json({ error: "Invalid JSON configuration object" });
  }

  // Guard 1: Cek array views
  if (Array.isArray(config.views)) {
    const seenViews = new Set<string>();
    config.views.forEach((v: any, idx: number) => {
      // Wajib ada key 'view'
      if (!v.view) {
        issues.push({
          severity: "error",
          path: `views[${idx}]`,
          message: `View item pada indeks ${idx} tidak memiliki properti 'view'!`
        });
      } else {
        if (seenViews.has(v.view)) {
          issues.push({
            severity: "error",
            path: `views[${idx}] (${v.view})`,
            message: `Duplikat view '${v.view}' ditemukan! Nama view harus unik.`
          });
        }
        seenViews.add(v.view);
      }

      // Wajib ada path untuk proyeksi field
      if (!v.path) {
        issues.push({
          severity: "warning",
          path: `views[${idx}] (${v.view || "unnamed"})`,
          message: `View '${v.view || idx}' tidak memiliki 'path' (proyeksi JMESPath / kolom).`
        });
      }

      // Guard kritis: isFile tidak boleh ada resolvePaths (mencegah error 500 UUID pada ATS)
      if (v.isFile && v.resolvePaths && v.resolvePaths.length > 0) {
        issues.push({
          severity: "error",
          path: `views[${idx}] (${v.view})`,
          message: `Ditemukan 'resolvePaths' pada isFile view '${v.view}'. Ini memicu runtime error '500 invalid input syntax for type uuid' di ATS!`
        });
      }
    });
  }

  // Guard 2: Cek keselarasan customData.fields dengan views
  if (config.customData?.fields && Array.isArray(config.customData.fields)) {
    const viewNames = new Set(Array.isArray(config.views) ? config.views.map((v: any) => v.view) : []);
    config.customData.fields.forEach((cf: any) => {
      if (cf.key && !viewNames.has(cf.key)) {
        issues.push({
          severity: "warning",
          path: `customData.fields[key='${cf.key}']`,
          message: `Custom field '${cf.key}' terdaftar di customData, tapi belum memiliki view mapping di array views.`
        });
      }
      if (!cf.type) {
        issues.push({
          severity: "warning",
          path: `customData.fields[key='${cf.key}']`,
          message: `Custom field '${cf.key}' tidak mendefinisikan tipe data ('type': 'TEXT', 'JSONB', dll).`
        });
      }
    });
  }

  // Guard workflow pipeline: struktur { pipelines: [{ name, config }] }
  if (domainOf(req).key === "workflow_pipeline") {
    if (!Array.isArray(config.pipelines)) {
      issues.push({
        severity: "error",
        path: "pipelines",
        message: "Workflow pipeline wajib memiliki array 'pipelines'."
      });
    } else {
      config.pipelines.forEach((step: any, idx: number) => {
        if (!step || typeof step !== "object" || !step.name || typeof step.name !== "string") {
          issues.push({
            severity: "error",
            path: `pipelines[${idx}]`,
            message: `Step pipeline pada indeks ${idx} tidak memiliki 'name'.`
          });
        }
        if (step && step.config !== undefined && (typeof step.config !== "object" || step.config === null)) {
          issues.push({
            severity: "warning",
            path: `pipelines[${idx}] (${step.name || "unnamed"})`,
            message: `'config' pada step '${step.name || idx}' sebaiknya berupa objek.`
          });
        }
      });
      if (config.pipelines.length === 0) {
        issues.push({ severity: "warning", path: "pipelines", message: "Array 'pipelines' kosong." });
      }
    }
  }

  // Guard 3: Validasi rules/filters jika ada
  if (config.rules && typeof config.rules === "object") {
    Object.entries(config.rules).forEach(([ruleKey, ruleVal]: [string, any]) => {
      if (typeof ruleVal !== "object") {
        issues.push({
          severity: "warning",
          path: `rules.${ruleKey}`,
          message: `Format rule '${ruleKey}' harus berupa objek.`
        });
      }
    });
  }

  res.json({
    isValid: issues.filter((i) => i.severity === "error").length === 0,
    issues
  });
});
