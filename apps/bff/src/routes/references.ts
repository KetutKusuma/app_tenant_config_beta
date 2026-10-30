import express from "express";
import fs from "fs";
import path from "path";
import { actorName } from "../auth";
import { auditDb, esc } from "../db";
import { domainOf, presetDirFor, staleVersionError } from "../domain";
import { assertWritable } from "../envs";
import { backupThenWrite } from "../backupFirst";
import { discardSnapshot, snapshotBeforeChange } from "../presetSync";
import { autoSummary, composeNote, parseReason } from "../changeSummary";

// Route: file preset lokal (katalog, baca, simpan, ekspor massal, ekspor skill, sync 1 file).

export const router = express.Router();

// 7. Dynamic Local Reference Files Endpoint (Bisa mengubah folder path referensi secara bebas)
router.get("/api/references", (req, res) => {
  try {
    const customDir = (req.query.dir as string) || presetDirFor(req);
    const list: Array<{ path: string; name: string; category: string }> = [];

    if (fs.existsSync(customDir)) {
      const readDir = (dir: string, baseDir: string) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(baseDir, fullPath);
          if (entry.isDirectory()) {
            readDir(fullPath, baseDir);
          } else if (entry.name.endsWith(".json")) {
            list.push({
              path: fullPath,
              name: entry.name,
              category: path.dirname(relPath) === "." ? "root" : path.dirname(relPath)
            });
          }
        }
      };
      readDir(customDir, customDir);
    }
    res.json({ 
      data: list,
      currentDir: customDir
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/references/file", (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: "Invalid file path" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = fs.readFileSync(filePath, "utf8");
    res.json({ content: JSON.parse(content) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function untuk menyalin Skill tenant-configuration (SKILL.md & Panduan)
export function copyTenantSkillFiles(targetDir: string): { success: boolean; exportedSkillFiles: string[]; error?: string } {
  try {
    const candidateSkillPaths = [
      path.resolve(__dirname, "../../../docs/skills/tenant-configuration/SKILL.md"),
      path.resolve(process.cwd(), "docs/skills/tenant-configuration/SKILL.md"),
      path.resolve(process.cwd(), "../docs/skills/tenant-configuration/SKILL.md"),
      path.resolve(process.cwd(), "../../docs/skills/tenant-configuration/SKILL.md"),
      "/Users/ketutkusuma/.gemini/config/skills/tenant-configuration/SKILL.md"
    ];
    const candidateGuidePaths = [
      path.resolve(__dirname, "../../../docs/TENANT_CONFIGURATION_GUIDE.md"),
      path.resolve(process.cwd(), "docs/TENANT_CONFIGURATION_GUIDE.md"),
      path.resolve(process.cwd(), "../docs/TENANT_CONFIGURATION_GUIDE.md"),
      path.resolve(process.cwd(), "../../docs/TENANT_CONFIGURATION_GUIDE.md")
    ];

    const skillPath = candidateSkillPaths.find(p => fs.existsSync(p));
    const guidePath = candidateGuidePaths.find(p => fs.existsSync(p));

    const exported: string[] = [];

    if (skillPath) {
      const skillContent = fs.readFileSync(skillPath, "utf8");

      // 1. Standar agent skills folder: <targetDir>/skills/tenant-configuration/SKILL.md
      const dir1 = path.join(targetDir, "skills", "tenant-configuration");
      if (!fs.existsSync(dir1)) fs.mkdirSync(dir1, { recursive: true });
      fs.writeFileSync(path.join(dir1, "SKILL.md"), skillContent, "utf8");
      exported.push("skills/tenant-configuration/SKILL.md");

      // 2. Standar Antigravity workspace project: <targetDir>/.agents/skills/tenant-configuration/SKILL.md
      const dir2 = path.join(targetDir, ".agents", "skills", "tenant-configuration");
      if (!fs.existsSync(dir2)) fs.mkdirSync(dir2, { recursive: true });
      fs.writeFileSync(path.join(dir2, "SKILL.md"), skillContent, "utf8");
      exported.push(".agents/skills/tenant-configuration/SKILL.md");
    }

    if (guidePath) {
      const guideContent = fs.readFileSync(guidePath, "utf8");
      // Simpan panduan arsitektur di root preset & di dalam folder skill
      fs.writeFileSync(path.join(targetDir, "TENANT_CONFIGURATION_GUIDE.md"), guideContent, "utf8");
      exported.push("TENANT_CONFIGURATION_GUIDE.md");

      const skillGuidePath = path.join(targetDir, "skills", "tenant-configuration", "TENANT_CONFIGURATION_GUIDE.md");
      fs.writeFileSync(skillGuidePath, guideContent, "utf8");
    }

    return { success: true, exportedSkillFiles: exported };
  } catch (err: any) {
    return { success: false, exportedSkillFiles: [], error: err.message };
  }
}

// 8. Save or Update Local Preset File
router.post("/api/references/save", (req, res) => {
  try {
    const { dir, filename, content, includeSkill = false } = req.body;
    const targetDir = dir && typeof dir === "string" && dir.trim() 
      ? dir.trim() 
      : presetDirFor(req);

    if (!filename || typeof filename !== "string" || !filename.trim()) {
      return res.status(400).json({ error: "Nama file preset wajib diisi!" });
    }

    if (!content) {
      return res.status(400).json({ error: "Konten JSON konfigurasi tidak boleh kosong!" });
    }

    // Pastikan ekstensi .json
    let cleanFilename = filename.trim();
    if (!cleanFilename.endsWith(".json")) {
      cleanFilename += ".json";
    }

    // Pastikan folder ada atau buat jika belum ada
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fullPath = path.join(targetDir, cleanFilename);
    const isUpdate = fs.existsSync(fullPath);

    // Format JSON dengan rapi 2 spasi
    const jsonParsed = typeof content === "string" ? JSON.parse(content) : content;
    const formatted = JSON.stringify(jsonParsed, null, 2);

    fs.writeFileSync(fullPath, formatted, "utf8");

    let skillExportInfo: { success: boolean; files: string[] } | null = null;
    if (includeSkill) {
      const skillRes = copyTenantSkillFiles(targetDir);
      if (skillRes.success) {
        skillExportInfo = { success: true, files: skillRes.exportedSkillFiles };
      }
    }

    const skillNotice = skillExportInfo ? " + Skill tenant_config disertakan" : "";

    res.json({
      success: true,
      isUpdate,
      filename: cleanFilename,
      path: fullPath,
      skillExported: !!skillExportInfo,
      skillFiles: skillExportInfo?.files || [],
      message: isUpdate 
        ? `File preset '${cleanFilename}' berhasil diperbarui!${skillNotice}` 
        : `File preset '${cleanFilename}' baru berhasil dibuat dan disimpan!${skillNotice}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Bulk Export Configurations to Local Presets Directory
router.post("/api/references/export-bulk", async (req, res) => {
  try {
    const { 
      dir, 
      scope = "current_tenant", // "current_tenant" | "all_tenants"
      tenantId, 
      namingStrategy = "config_type", // "config_type" | "path" | "tenant_folder"
      overwrite = true,
      includeSkill = true 
    } = req.body;

    const targetDir = dir && typeof dir === "string" && dir.trim()
      ? dir.trim()
      : presetDirFor(req);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const D = domainOf(req);
    let query = `SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, ${D.pathSel}, value FROM ${D.table} WHERE deleted_at IS NULL`;
    if (scope === "current_tenant") {
      if (tenantId === "GLOBAL_DEFAULT" || !tenantId) {
        query += " AND tenant_id IS NULL";
      } else {
        query += ` AND tenant_id = ${esc(tenantId)}`;
      }
    }
    query += ` ORDER BY tenant_id, ${D.typeCol}`;

    const { rows } = await req.targetDb!.query(query);

    // Ambil info metadata tenant untuk nama folder yang rapi
    const tenantMetaRes = await auditDb.query(
      `SELECT tenant_id, client_name, client_code FROM tenant_studio.tenant_metadata WHERE target_env = ${esc(req.targetEnv!.name)}`
    );
    const tenantMap = new Map<string, string>();
    tenantMetaRes.rows.forEach(r => {
      tenantMap.set(r.tenant_id, r.client_name || r.client_code);
    });

    let createdCount = 0;
    let updatedCount = 0;
    const exportedFiles: Array<{ filename: string; path: string; isUpdate: boolean }> = [];

    for (const row of rows) {
      const typeName = row.config_type || "UNKNOWN_CONFIG";
      let relPath = "";

      if (namingStrategy === "tenant_folder" || (scope === "all_tenants" && namingStrategy !== "path")) {
        const tenantFolder = row.tenant_id 
          ? (tenantMap.get(row.tenant_id) || row.tenant_id).replace(/[/\\?%*:|"<>]/g, "_")
          : "GLOBAL_DEFAULT";
        relPath = path.join(tenantFolder, `${typeName}.json`);
      } else if (namingStrategy === "path" && row.path) {
        let p = row.path.trim();
        if (!p.endsWith(".json")) p += ".json";
        relPath = p;
      } else {
        // default: config_type
        relPath = `${typeName}.json`;
      }

      const fullFilePath = path.join(targetDir, relPath);
      const parentDir = path.dirname(fullFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const exists = fs.existsSync(fullFilePath);
      if (exists && !overwrite) {
        continue;
      }

      const formatted = JSON.stringify(row.value || {}, null, 2);
      fs.writeFileSync(fullFilePath, formatted, "utf8");

      if (exists) updatedCount++;
      else createdCount++;

      exportedFiles.push({
        filename: relPath,
        path: fullFilePath,
        isUpdate: exists
      });
    }

    let skillExportInfo: { success: boolean; files: string[] } | null = null;
    if (includeSkill) {
      const skillRes = copyTenantSkillFiles(targetDir);
      if (skillRes.success) {
        skillExportInfo = { success: true, files: skillRes.exportedSkillFiles };
      }
    }

    const skillNotice = skillExportInfo ? " + Skill tenant_config (SKILL.md) disertakan" : "";

    res.json({
      success: true,
      totalExported: exportedFiles.length,
      createdCount,
      updatedCount,
      targetDir,
      files: exportedFiles,
      skillExported: !!skillExportInfo,
      skillFiles: skillExportInfo?.files || [],
      message: `Berhasil mengekspor ${exportedFiles.length} file konfigurasi ke ${targetDir} (${createdCount} baru dibuat, ${updatedCount} diperbarui)${skillNotice}!`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit Export Skill tenant-configuration to Preset Directory
router.post("/api/references/export-skill", (req, res) => {
  try {
    const { dir } = req.body;
    const targetDir = dir && typeof dir === "string" && dir.trim()
      ? dir.trim()
      : presetDirFor(req);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const skillRes = copyTenantSkillFiles(targetDir);
    if (!skillRes.success) {
      return res.status(500).json({ error: skillRes.error || "Gagal menyalin skill tenant-configuration" });
    }

    res.json({
      success: true,
      targetDir,
      files: skillRes.exportedSkillFiles,
      message: `Skill tenant-configuration (SKILL.md & Panduan) berhasil diekspor ke ${targetDir}!`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Sync Single Preset File to Active DB Configuration
router.post("/api/references/sync-single", async (req, res) => {
  try {
    const { configId, content, sourceFilename, expectedVersion, reason: rawReason } = req.body;
    const authorName = actorName(req, "Preset Sync");
    if (!assertWritable(req, res)) return;
    const D = domainOf(req);
    if (!configId) {
      return res.status(400).json({ error: "configId wajib disertakan!" });
    }
    if (!content) {
      return res.status(400).json({ error: "Konten preset tidak boleh kosong!" });
    }
    const reason = parseReason(rawReason);
    if (!reason.ok) return res.status(400).json({ error: reason.error });

    const currRes = await req.targetDb!.query(`
      SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, value, updated_at::text AS version_token
      FROM ${D.table} 
      WHERE id = ${esc(configId)};
    `);

    if (currRes.rows.length === 0) {
      return res.status(404).json({ error: "Konfigurasi tidak ditemukan di database" });
    }

    const currentConfig = currRes.rows[0];
    const stale = staleVersionError(expectedVersion, currentConfig.version_token);
    if (stale) return res.status(409).json(stale);
    const jsonParsed = typeof content === "string" ? JSON.parse(content) : content;

    // Cadangkan isi lama ke history DULU; bila tulis gagal/stale, cadangan dibuang
    let backupVersion = 0;
    const outcome = await backupThenWrite({
      backup: async () => {
        const snap = await snapshotBeforeChange(
          currentConfig,
          composeNote(
            reason.value,
            `Sync dari preset ${sourceFilename || "file lokal"}`,
            autoSummary(currentConfig.value, jsonParsed)
          ),
          authorName,
          req.targetEnv!.name
        );
        backupVersion = snap.version;
        return snap.historyId;
      },
      write: async () => {
        const updRes = await req.targetDb!.query(`
          UPDATE ${D.table} 
          SET 
            value = ${esc(JSON.stringify(jsonParsed))}::jsonb,
            updated_at = NOW()
          WHERE id = ${esc(configId)} AND updated_at::text = ${esc(currentConfig.version_token)}
          RETURNING updated_at::text AS version_token;
        `);
        return updRes.rows[0] ?? null;
      },
      discard: discardSnapshot,
      onDiscardError: (e) => console.error("Gagal membuang cadangan history:", e)
    });
    if (outcome.status === "stale") {
      return res.status(409).json(staleVersionError("", "changed")!);
    }

    res.json({
      success: true,
      message: `Konfigurasi ${currentConfig.config_type} berhasil disinkronkan dari file preset ke database!`,
      version: backupVersion,
      versionToken: outcome.result.version_token,
      data: jsonParsed
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
