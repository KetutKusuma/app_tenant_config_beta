import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

// Load .env from workspace root
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const app = express();
const PORT = process.env.PORT_BFF || 4000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Helper to escape values safely for Neon SQL proxy
function esc(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  return "'" + String(val).replace(/'/g, "''") + "'";
}

// Domain konfigurasi: tenant_config (public.tenant_configurations) atau
// workflow_pipeline (public.pipeline_workflow_configurations). Keduanya ada di DB target (ats_db)
// dengan struktur hampir sama; bedanya kolom tipe (`workflow_config_type`) dan tidak ada kolom `path`.
type ConfigDomain = "tenant_config" | "workflow_pipeline";
interface DomainSpec {
  key: ConfigDomain;
  table: string;
  typeCol: string;
  hasPath: boolean;
  /** kolom path untuk SELECT (NULL bila tabel tidak punya kolom path) */
  pathSel: string;
  /** key config_type di tenant_studio.preset_links, diberi prefix agar tidak bentrok antar domain */
  linkKey: (configType: string) => string;
}
const DOMAINS: Record<ConfigDomain, DomainSpec> = {
  tenant_config: {
    key: "tenant_config",
    table: "public.tenant_configurations",
    typeCol: "config_type",
    hasPath: true,
    pathSel: "path",
    linkKey: (t) => t
  },
  workflow_pipeline: {
    key: "workflow_pipeline",
    table: "public.pipeline_workflow_configurations",
    typeCol: "workflow_config_type",
    hasPath: false,
    pathSel: "NULL::text AS path",
    linkKey: (t) => `WORKFLOW_PIPELINE:${t}`
  }
};
function domainOf(req: express.Request): DomainSpec {
  const raw = req.header("x-config-domain") || (req.query.domain as string) || req.body?.domain;
  return raw === "workflow_pipeline" ? DOMAINS.workflow_pipeline : DOMAINS.tenant_config;
}

// 1. Target Database (tempat tabel public.tenant_configurations berada)
function getTargetDbConfig() {
  if (process.env.DB_HOST) {
    const isSsl = process.env.DB_SSL === "true" || process.env.DB_SSL === "require";
    return {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE || process.env.DB_NAME || "ats_db",
      ssl: isSsl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000
    };
  }

  return {
    connectionString: process.env.TARGET_DB_URL || process.env.AUDIT_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000
  };
}

const targetDb = new Pool(getTargetDbConfig());
targetDb.on("error", (err) => console.error("Target DB Pool Error:", err.message));

// 2. Audit & Studio Metadata Database (tetap tersimpan di NeonDB ats_db)
const auditDb = new Pool({
  connectionString: process.env.AUDIT_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
});
auditDb.on("error", (err) => console.error("Audit DB Pool Error:", err.message));

// Health Check
app.get("/health", async (req, res) => {
  try {
    await targetDb.query("SELECT NOW()");
    await auditDb.query("SELECT NOW()");
    res.json({
      status: "ok",
      service: "tenant-config-bff",
      targetDatabase: "connected",
      auditDatabase: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ status: "degraded", error: err.message });
  }
});

// 1. Tenant Directory & Discovery
app.get("/api/tenants", async (req, res) => {
  try {
    const D = domainOf(req);
    const metaRes = await auditDb.query(`
      SELECT tenant_id, group_id, client_name, client_code, environment, tags, notes, updated_at
      FROM tenant_studio.tenant_metadata
      ORDER BY client_name ASC;
    `);

    const configsRes = await targetDb.query(`
      SELECT tenant_id, count(*) as total_configs
      FROM ${D.table}
      WHERE deleted_at IS NULL
      GROUP BY tenant_id;
    `);

    const atsMap = new Map<string, number>();
    configsRes.rows.forEach(r => {
      const key = r.tenant_id ? String(r.tenant_id) : "GLOBAL_DEFAULT";
      atsMap.set(key, parseInt(r.total_configs, 10));
    });

    const results = metaRes.rows.map(m => ({
      tenantId: m.tenant_id,
      groupId: m.group_id || null,
      name: m.client_name,
      code: m.client_code,
      environment: m.environment,
      tags: m.tags || [],
      notes: m.notes || "",
      totalConfigs: atsMap.get(m.tenant_id) || 0,
      updatedAt: m.updated_at
    }));

    res.json({ data: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create or Update Tenant Metadata (Label, Name, Group ID, Code, Tags, Notes)
app.post("/api/tenants", async (req, res) => {
  const { tenantId, groupId, clientName, clientCode, tags, notes } = req.body;

  if (!tenantId || !clientName) {
    return res.status(400).json({ error: "tenantId dan clientName wajib diisi!" });
  }

  try {
    const cleanTenantId = tenantId.trim();
    const cleanGroupId = groupId ? groupId.trim() : null;
    const cleanCode = (clientCode || cleanTenantId.substring(0, 4)).toUpperCase();
    const tagArray = Array.isArray(tags) ? tags : [];
    const tagsSql = "ARRAY[" + tagArray.map(t => esc(t)).join(",") + "]::text[]";

    await auditDb.query(`
      INSERT INTO tenant_studio.tenant_metadata 
      (tenant_id, group_id, client_name, client_code, environment, tags, notes, updated_at)
      VALUES (
        ${esc(cleanTenantId)}, 
        ${cleanGroupId ? esc(cleanGroupId) : "NULL"}, 
        ${esc(clientName)}, 
        ${esc(cleanCode)}, 
        'development', 
        ${tagsSql}, 
        ${esc(notes || "")}, 
        NOW()
      )
      ON CONFLICT (tenant_id) DO UPDATE 
      SET 
        group_id = EXCLUDED.group_id,
        client_name = EXCLUDED.client_name,
        client_code = EXCLUDED.client_code,
        environment = 'development',
        tags = EXCLUDED.tags,
        notes = EXCLUDED.notes,
        updated_at = NOW();
    `);

    res.json({
      success: true,
      message: `Tenant ${cleanTenantId} berhasil disimpan/diperbarui.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. List Configurations for a Tenant
app.get("/api/tenants/:tenantId/configs", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const D = domainOf(req);
    const whereClause = tenantId === "GLOBAL_DEFAULT"
      ? "tenant_id IS NULL AND deleted_at IS NULL"
      : `tenant_id = ${esc(tenantId)} AND deleted_at IS NULL`;

    const configsRes = await targetDb.query(`
      SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, ${D.pathSel}, is_default, created_at, updated_at 
      FROM ${D.table} 
      WHERE ${whereClause}
      ORDER BY ${D.typeCol} ASC;
    `);

    res.json({ data: configsRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get Configuration Detail (JSONB Value)
app.get("/api/configs/:configId", async (req, res) => {
  try {
    const { configId } = req.params;
    const D = domainOf(req);
    const rowRes = await targetDb.query(`
      SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, is_default, ${D.pathSel}, value, updated_at,
        updated_at::text AS version_token
      FROM ${D.table}
      WHERE id = ${esc(configId)};
    `);

    if (rowRes.rows.length === 0) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    res.json({ data: rowRes.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create New Configuration for a Tenant
app.post("/api/configs", async (req, res) => {
  const { tenantId, groupId, configType, path: configPath, value } = req.body;

  if (!configType) {
    return res.status(400).json({ error: "configType wajib diisi!" });
  }

  try {
    const targetTenantId = (tenantId === "GLOBAL_DEFAULT" || !tenantId) ? null : tenantId;
    const cleanGroupId = groupId ? groupId.trim() : null;
    const cleanPath = configPath || configType.toLowerCase().replace(/_/g, "-");
    const jsonValue = value && typeof value === "object" ? value : {};
    const configId = (req.body.id && typeof req.body.id === "string" && req.body.id.trim()) ? req.body.id.trim() : randomUUID();
    const D = domainOf(req);

    const insertRes = await targetDb.query(`
      INSERT INTO ${D.table} 
      (id, tenant_id, group_id, ${D.typeCol}, ${D.hasPath ? "path, " : ""}value, is_default, created_at, updated_at)
      VALUES (
        ${esc(configId)},
        ${targetTenantId ? esc(targetTenantId) : "NULL"}, 
        ${cleanGroupId ? esc(cleanGroupId) : "NULL"}, 
        ${esc(configType)}, 
        ${D.hasPath ? esc(cleanPath) + "," : ""} 
        ${esc(JSON.stringify(jsonValue))}::jsonb, 
        ${targetTenantId === null ? "true" : "false"}, 
        NOW(), 
        NOW()
      )
      RETURNING id;
    `);

    const newConfigId = insertRes.rows[0].id;

    // Catat versi 1 di history
    await auditDb.query(`
      INSERT INTO tenant_studio.tenant_config_histories 
      (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name)
      VALUES (
        ${targetTenantId ? esc(targetTenantId) : "NULL"}, 
        ${cleanGroupId ? esc(cleanGroupId) : "NULL"}, 
        ${esc(configType)}, 
        ${esc(newConfigId)}, 
        1, 
        ${esc(JSON.stringify(jsonValue))}::jsonb, 
        'Initial creation', 
        'Studio User'
      );
    `);

    res.json({
      success: true,
      data: { id: newConfigId }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Pre-flight Validator Endpoint (Comprehensive Rule & Linter Guardrail)
app.post("/api/validator/check", (req, res) => {
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

// Optimistic locking: editor wajib mengirim versi (updated_at) yang ia muat terakhir.
// Jika DB sudah berubah sejak itu, simpan ditolak agar perubahan orang lain tidak tertimpa.
function staleVersionError(expected: any, current: string): { error: string; code: string } | null {
  if (!expected) {
    return {
      code: "VERSION_REQUIRED",
      error: "Versi konfigurasi tidak diketahui. Muat ulang (pull) konfigurasi dari database sebelum menyimpan."
    };
  }
  if (expected !== current) {
    return {
      code: "STALE_VERSION",
      error: "Konfigurasi di database sudah berubah sejak terakhir Anda memuatnya. Pull/muat ulang dari database dulu, lalu terapkan ulang perubahan Anda."
    };
  }
  return null;
}

// 5. Update Configuration & Record Audit Snapshot
app.put("/api/configs/:configId", async (req, res) => {
  const { configId } = req.params;
  const { value, groupId, changeSummary, authorName, expectedVersion } = req.body;
  const D = domainOf(req);

  if (!value || typeof value !== "object") {
    return res.status(400).json({ error: "Value must be a valid JSON object" });
  }

  try {
    const curRes = await targetDb.query(`
      SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, value, updated_at::text AS version_token
      FROM ${D.table} 
      WHERE id = ${esc(configId)};
    `);

    if (curRes.rows.length === 0) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    const currentConfig = curRes.rows[0];
    const stale = staleVersionError(expectedVersion, currentConfig.version_token);
    if (stale) return res.status(409).json(stale);
    const finalGroupId = groupId !== undefined ? (groupId ? groupId.trim() : null) : currentConfig.group_id;

    const verRes = await auditDb.query(`
      SELECT COALESCE(MAX(version), 0) as last_version 
      FROM tenant_studio.tenant_config_histories 
      WHERE core_config_id = ${esc(configId)};
    `);
    const nextVersion = parseInt(verRes.rows[0].last_version, 10) + 1;

    // 1. Update konfigurasi aktif dengan data BARU, hanya jika versi DB belum berubah sejak dicek
    const updRes = await targetDb.query(`
      UPDATE ${D.table} 
      SET 
        value = ${esc(JSON.stringify(value))}::jsonb, 
        group_id = ${finalGroupId ? esc(finalGroupId) : "NULL"},
        updated_at = NOW() 
      WHERE id = ${esc(configId)} AND updated_at::text = ${esc(currentConfig.version_token)}
      RETURNING updated_at::text AS version_token;
    `);
    if (updRes.rows.length === 0) {
      return res.status(409).json(staleVersionError("", "changed")!);
    }

    // 2. Simpan snapshot data SEBELUM perubahan ke audit history (Previous Version Backup)
    await auditDb.query(`
      INSERT INTO tenant_studio.tenant_config_histories 
      (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name)
      VALUES (
        ${currentConfig.tenant_id ? esc(currentConfig.tenant_id) : "NULL"}, 
        ${currentConfig.group_id ? esc(currentConfig.group_id) : "NULL"}, 
        ${currentConfig.config_type ? esc(currentConfig.config_type) : "NULL"}, 
        ${esc(configId)}, 
        ${nextVersion}, 
        ${esc(JSON.stringify(currentConfig.value || {}))}::jsonb, 
        ${esc(changeSummary || `Snapshot sebelum perubahan v${nextVersion}`)}, 
        ${esc(authorName || "Studio User")}
      );
    `);

    res.json({
      success: true,
      message: `Configuration ${configId} successfully updated to version ${nextVersion}`,
      version: nextVersion,
      versionToken: updRes.rows[0].version_token
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5b. Delete Configuration with Safety Confirmation & Audit Snapshot
app.delete("/api/configs/:configId", async (req, res) => {
  try {
    const { configId } = req.params;
    const { confirmationConfigType, authorName = "Studio User" } = req.body;
    const D = domainOf(req);

    const curRes = await targetDb.query(`
      SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, value 
      FROM ${D.table} 
      WHERE id = ${esc(configId)} AND deleted_at IS NULL;
    `);

    if (curRes.rows.length === 0) {
      return res.status(404).json({ error: "Konfigurasi tidak ditemukan atau sudah dihapus." });
    }

    const currentConfig = curRes.rows[0];

    // Validasi keamanan: nama konfirmasi harus sama persis dengan config_type
    if (!confirmationConfigType || confirmationConfigType.trim() !== currentConfig.config_type) {
      return res.status(400).json({ 
        error: `Nama konfirmasi '${confirmationConfigType}' tidak cocok dengan nama konfigurasi '${currentConfig.config_type}'. Penghapusan dibatalkan.` 
      });
    }

    // 1. Catat snapshot kondisi SEBELUM dihapus ke riwayat audit (NeonDB)
    const verRes = await auditDb.query(`
      SELECT COALESCE(MAX(version), 0) as last_version 
      FROM tenant_studio.tenant_config_histories 
      WHERE core_config_id = ${esc(configId)};
    `);
    const nextVersion = parseInt(verRes.rows[0].last_version, 10) + 1;

    await auditDb.query(`
      INSERT INTO tenant_studio.tenant_config_histories 
      (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name)
      VALUES (
        ${currentConfig.tenant_id ? esc(currentConfig.tenant_id) : "NULL"}, 
        ${currentConfig.group_id ? esc(currentConfig.group_id) : "NULL"}, 
        ${currentConfig.config_type ? esc(currentConfig.config_type) : "NULL"}, 
        ${esc(configId)}, 
        ${nextVersion}, 
        ${esc(JSON.stringify(currentConfig.value || {}))}::jsonb, 
        ${esc(`DELETED: Konfigurasi ${currentConfig.config_type} dihapus oleh ${authorName}`)}, 
        ${esc(authorName)}
      );
    `);

    // 2. Soft-delete di tabel domain aktif
    await targetDb.query(`
      UPDATE ${D.table} 
      SET deleted_at = NOW(), updated_at = NOW() 
      WHERE id = ${esc(configId)};
    `);

    // 3. Bersihkan tautan preset_links jika ada
    if (currentConfig.tenant_id && currentConfig.config_type) {
      await auditDb.query(`
        DELETE FROM tenant_studio.preset_links 
        WHERE tenant_id = ${esc(currentConfig.tenant_id)} AND config_type = ${esc(D.linkKey(currentConfig.config_type))};
      `).catch(() => {});
    }

    res.json({
      success: true,
      message: `Konfigurasi '${currentConfig.config_type}' berhasil dihapus. Snapshot terakhir dicatat di riwayat audit v${nextVersion}.`,
      deletedConfigId: configId,
      configType: currentConfig.config_type
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get History Snapshots
app.get("/api/configs/:configId/histories", async (req, res) => {
  try {
    const { configId } = req.params;
    const histRes = await auditDb.query(`
      SELECT id, version, group_id, config_value, change_summary, author_name, created_at 
      FROM tenant_studio.tenant_config_histories 
      WHERE core_config_id = ${esc(configId)}
      ORDER BY version DESC;
    `);
    res.json({ data: histRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Dynamic Local Reference Files Endpoint (Bisa mengubah folder path referensi secara bebas)
app.get("/api/references", (req, res) => {
  try {
    const customDir = (req.query.dir as string) || "/Users/ketutkusuma/Python/test_redis_stream/stable";
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

app.get("/api/references/file", (req, res) => {
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
function copyTenantSkillFiles(targetDir: string): { success: boolean; exportedSkillFiles: string[]; error?: string } {
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
app.post("/api/references/save", (req, res) => {
  try {
    const { dir, filename, content, includeSkill = false } = req.body;
    const targetDir = dir && typeof dir === "string" && dir.trim() 
      ? dir.trim() 
      : "/Users/ketutkusuma/Python/test_redis_stream/stable";

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
app.post("/api/references/export-bulk", async (req, res) => {
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
      : "/Users/ketutkusuma/Python/test_redis_stream/stable";

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

    const { rows } = await targetDb.query(query);

    // Ambil info metadata tenant untuk nama folder yang rapi
    const tenantMetaRes = await auditDb.query("SELECT tenant_id, client_name, client_code FROM tenant_studio.tenant_metadata");
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
app.post("/api/references/export-skill", (req, res) => {
  try {
    const { dir } = req.body;
    const targetDir = dir && typeof dir === "string" && dir.trim()
      ? dir.trim()
      : "/Users/ketutkusuma/Python/test_redis_stream/stable";

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
app.post("/api/references/sync-single", async (req, res) => {
  try {
    const { configId, content, authorName = "Preset Sync", sourceFilename, expectedVersion } = req.body;
    const D = domainOf(req);
    if (!configId) {
      return res.status(400).json({ error: "configId wajib disertakan!" });
    }
    if (!content) {
      return res.status(400).json({ error: "Konten preset tidak boleh kosong!" });
    }

    const currRes = await targetDb.query(`
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

    // Ambil versi terakhir dari history
    const vRes = await auditDb.query(`
      SELECT COALESCE(MAX(version), 0) as max_v 
      FROM tenant_studio.tenant_config_histories 
      WHERE core_config_id = ${esc(configId)};
    `);
    const nextVersion = (vRes.rows[0]?.max_v || 0) + 1;

    // 1. Update nilai baru di database, hanya jika versi DB belum berubah sejak dicek
    const updRes = await targetDb.query(`
      UPDATE ${D.table} 
      SET 
        value = ${esc(JSON.stringify(jsonParsed))}::jsonb,
        updated_at = NOW()
      WHERE id = ${esc(configId)} AND updated_at::text = ${esc(currentConfig.version_token)}
      RETURNING updated_at::text AS version_token;
    `);
    if (updRes.rows.length === 0) {
      return res.status(409).json(staleVersionError("", "changed")!);
    }

    // 2. Simpan snapshot kondisi SEBELUM perubahan ke history
    await auditDb.query(`
      INSERT INTO tenant_studio.tenant_config_histories 
      (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name)
      VALUES (
        ${currentConfig.tenant_id ? esc(currentConfig.tenant_id) : "NULL"}, 
        ${currentConfig.group_id ? esc(currentConfig.group_id) : "NULL"}, 
        ${esc(currentConfig.config_type || "UNKNOWN")}, 
        ${esc(configId)}, 
        ${nextVersion}, 
        ${esc(JSON.stringify(currentConfig.value || {}))}::jsonb, 
        ${esc(`Synchronized from preset file: ${sourceFilename || "local file"}`)}, 
        ${esc(authorName)}
      );
    `);

    res.json({
      success: true,
      message: `Konfigurasi ${currentConfig.config_type} berhasil disinkronkan dari file preset ke database!`,
      version: nextVersion,
      versionToken: updRes.rows[0].version_token,
      data: jsonParsed
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Sync Center: public.tenant_configurations <-> file JSON preset lokal
// ============================================================================
const DEFAULT_PRESET_DIR = "/Users/ketutkusuma/Python/test_redis_stream/stable";

// Tabel pemetaan config_type -> file lokal (disimpan di schema studio, bukan di DB target)
auditDb
  .query(`
    CREATE TABLE IF NOT EXISTS tenant_studio.preset_links (
      tenant_id text NOT NULL,
      config_type text NOT NULL,
      file_path text NOT NULL,
      updated_at timestamp DEFAULT now(),
      PRIMARY KEY (tenant_id, config_type)
    );
  `)
  // base_db_version = updated_at DB saat file terakhir di-pull/di-push; dipakai untuk menolak push
  // dari file yang belum pernah di-pull atau yang DB-nya sudah berubah sejak pull terakhir.
  .then(() => auditDb.query(`ALTER TABLE tenant_studio.preset_links ADD COLUMN IF NOT EXISTS base_db_version text;`))
  .catch((err) => console.error("Gagal membuat tabel preset_links:", err.message));

// Urutkan key secara rekursif agar urutan key (jsonb vs file) tidak dianggap perbedaan
function canonicalize(v: any): any {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((acc: any, k) => {
      acc[k] = canonicalize(v[k]);
      return acc;
    }, {});
  }
  return v;
}
function sameJson(a: any, b: any): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}
function normalizeName(s: any): string {
  if (!s || typeof s !== "string") return "";
  return s.replace(/\.json$/i, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}
function isSafePresetPath(p: any): p is string {
  return typeof p === "string" && path.isAbsolute(p) && p.toLowerCase().endsWith(".json");
}
function scanJsonFiles(dir: string): Array<{ path: string; name: string; mtime: number }> {
  const out: Array<{ path: string; name: string; mtime: number }> = [];
  const walk = (cur: string) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith(".json")) {
        out.push({ path: full, name: entry.name, mtime: fs.statSync(full).mtimeMs });
      }
    }
  };
  walk(dir);
  return out;
}
// Tulis file dengan cadangan 1 level (<file>.bak, bukan .json sehingga tidak ikut terpindai)
function writeJsonFileWithBackup(filePath: string, value: any): { existed: boolean } {
  const existed = fs.existsSync(filePath);
  if (existed) fs.copyFileSync(filePath, filePath + ".bak");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
  return { existed };
}
async function snapshotBeforeChange(row: any, summary: string, author: string): Promise<number> {
  const v = await auditDb.query(`
    SELECT COALESCE(MAX(version), 0) AS last_version
    FROM tenant_studio.tenant_config_histories
    WHERE core_config_id = ${esc(row.id)};
  `);
  const nextVersion = parseInt(v.rows[0].last_version, 10) + 1;
  await auditDb.query(`
    INSERT INTO tenant_studio.tenant_config_histories
    (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name)
    VALUES (
      ${row.tenant_id ? esc(row.tenant_id) : "NULL"},
      ${row.group_id ? esc(row.group_id) : "NULL"},
      ${esc(row.config_type || "UNKNOWN")},
      ${esc(row.id)},
      ${nextVersion},
      ${esc(JSON.stringify(row.value || {}))}::jsonb,
      ${esc(summary)},
      ${esc(author)}
    );
  `);
  return nextVersion;
}
async function upsertPresetLink(tenantId: string, configType: string, filePath: string) {
  await auditDb.query(`
    INSERT INTO tenant_studio.preset_links (tenant_id, config_type, file_path, updated_at)
    VALUES (${esc(tenantId)}, ${esc(configType)}, ${esc(filePath)}, NOW())
    ON CONFLICT (tenant_id, config_type) DO UPDATE
    SET file_path = EXCLUDED.file_path,
        base_db_version = CASE WHEN preset_links.file_path = EXCLUDED.file_path THEN preset_links.base_db_version END,
        updated_at = NOW();
  `);
}
async function setPresetBase(tenantId: string, configType: string, filePath: string, versionToken: string) {
  await upsertPresetLink(tenantId, configType, filePath);
  await auditDb.query(`
    UPDATE tenant_studio.preset_links SET base_db_version = ${esc(versionToken)}
    WHERE tenant_id = ${esc(tenantId)} AND config_type = ${esc(configType)};
  `);
}

// Tulis 1 file lokal persis di path yang diberikan (untuk edit window Preset Lokal)
app.put("/api/references/file", (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!isSafePresetPath(filePath)) {
      return res.status(400).json({ error: "Path harus absolut dan berekstensi .json" });
    }
    if (content === undefined || content === null) {
      return res.status(400).json({ error: "Konten tidak boleh kosong" });
    }
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const { existed } = writeJsonFileWithBackup(filePath, parsed);
    res.json({
      success: true,
      existed,
      backup: existed ? filePath + ".bak" : null,
      mtime: fs.statSync(filePath).mtimeMs,
      message: `File ${path.basename(filePath)} berhasil disimpan${existed ? " (cadangan lama: .bak)" : " sebagai file baru"}.`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Status sinkronisasi tiap config milik 1 tenant terhadap file lokal
app.get("/api/sync/status", async (req, res) => {
  try {
    const tenantId = String(req.query.tenantId || "GLOBAL_DEFAULT");
    const dir = (req.query.dir as string) || DEFAULT_PRESET_DIR;
    const isGlobal = tenantId === "GLOBAL_DEFAULT";
    const D = domainOf(req);

    const cfgRes = await targetDb.query(`
      SELECT id, group_id, ${D.typeCol} AS config_type, value, updated_at, updated_at::text AS version_token
      FROM ${D.table}
      WHERE ${isGlobal ? "tenant_id IS NULL" : `tenant_id = ${esc(tenantId)}`} AND deleted_at IS NULL
      ORDER BY ${D.typeCol} ASC;
    `);
    const linkRes = await auditDb.query(`
      SELECT config_type, file_path, base_db_version FROM tenant_studio.preset_links WHERE tenant_id = ${esc(tenantId)};
    `);
    const links = new Map<string, string>(linkRes.rows.map((r: any) => [r.config_type, r.file_path]));
    const bases = new Map<string, string | null>(linkRes.rows.map((r: any) => [r.config_type, r.base_db_version]));
    // Hitung config_type kembar (mis. 2 baris aktif bertipe sama): sync per-tipe jadi ambigu
    const typeCount = new Map<string, number>();
    cfgRes.rows.forEach((r: any) => typeCount.set(r.config_type, (typeCount.get(r.config_type) || 0) + 1));

    const files = fs.existsSync(dir) ? scanJsonFiles(dir) : [];
    // Saran otomatis: nama file == config_type (case/pemisah diabaikan). Jika kembar, ambil path terpendek.
    const byNorm = new Map<string, { path: string; name: string; mtime: number }>();
    for (const f of files) {
      const key = normalizeName(f.name);
      const cur = byNorm.get(key);
      if (!cur || f.path.length < cur.path.length) byNorm.set(key, f);
    }

    const rows = cfgRes.rows.map((row: any) => {
      let filePath: string | null = links.get(D.linkKey(row.config_type)) || null;
      let linkSource: "saved" | "auto" | null = filePath ? "saved" : null;
      if (!filePath) {
        const f = byNorm.get(normalizeName(row.config_type));
        if (f) {
          filePath = f.path;
          linkSource = "auto";
        }
      }

      let status: "identical" | "different" | "no_file" | "file_missing" | "invalid_json" = "no_file";
      let fileMtime: number | null = null;
      if (filePath) {
        if (!fs.existsSync(filePath)) {
          status = "file_missing";
        } else {
          fileMtime = fs.statSync(filePath).mtimeMs;
          try {
            const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
            status = sameJson(row.value || {}, parsed) ? "identical" : "different";
          } catch {
            status = "invalid_json";
          }
        }
      }
      // Push diblokir bila file berbeda dari DB tetapi belum di-pull dari versi DB yang sekarang
      const pullRequired =
        status === "different" &&
        (linkSource !== "saved" || bases.get(D.linkKey(row.config_type)) !== row.version_token);
      return {
        configId: row.id,
        configType: row.config_type,
        groupId: row.group_id,
        dbUpdatedAt: row.updated_at,
        filePath,
        linkSource,
        status,
        pullRequired,
        duplicateType: (typeCount.get(row.config_type) || 0) > 1,
        fileMtime
      };
    });

    const used = new Set(rows.map((r: any) => r.filePath).filter(Boolean));
    const unlinkedFiles = files.filter((f) => !used.has(f.path));

    res.json({ data: rows, unlinkedFiles, totalFiles: files.length, dir, dirExists: fs.existsSync(dir) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Simpan / hapus pemetaan config_type -> file lokal
app.put("/api/sync/link", async (req, res) => {
  try {
    const { tenantId, filePath } = req.body;
    const D = domainOf(req);
    if (!tenantId || !req.body.configType) {
      return res.status(400).json({ error: "tenantId dan configType wajib diisi" });
    }
    const configType = D.linkKey(req.body.configType);
    if (!filePath) {
      await auditDb.query(`
        DELETE FROM tenant_studio.preset_links
        WHERE tenant_id = ${esc(tenantId)} AND config_type = ${esc(configType)};
      `);
      return res.json({ success: true, message: "Link file dihapus" });
    }
    if (!isSafePresetPath(filePath)) {
      return res.status(400).json({ error: "Path harus absolut dan berekstensi .json" });
    }
    await upsertPresetLink(tenantId, configType, filePath);
    res.json({ success: true, message: "Link file disimpan" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Terapkan sinkronisasi HANYA untuk item yang dipilih eksplisit (push: file->DB, pull: DB->file)
app.post("/api/sync/apply", async (req, res) => {
  try {
    const { tenantId, direction, items, createIfMissing = false, groupId, authorName = "Preset Sync" } = req.body;
    if (direction !== "push" && direction !== "pull") {
      return res.status(400).json({ error: "direction harus 'push' atau 'pull'" });
    }
    if (!tenantId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "tenantId dan items wajib diisi" });
    }
    const isGlobal = tenantId === "GLOBAL_DEFAULT";
    const D = domainOf(req);
    const results: Array<{ configType: string; filePath: string; action: string; error?: string }> = [];

    for (const item of items) {
      const configType: string = item.configType;
      const linkType = D.linkKey(configType || "");
      const filePath: string = item.filePath;
      const report = (action: string, error?: string) => results.push({ configType, filePath, action, error });

      try {
        if (!configType || !isSafePresetPath(filePath)) {
          report("failed", "configType/filePath tidak valid");
          continue;
        }

        const found = await targetDb.query(`
          SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, value, updated_at::text AS version_token
          FROM ${D.table}
          WHERE ${isGlobal ? "tenant_id IS NULL" : `tenant_id = ${esc(tenantId)}`}
            AND ${D.typeCol} = ${esc(configType)} AND deleted_at IS NULL
          LIMIT 2;
        `);
        if (found.rows.length > 1) {
          report("failed", `Ada lebih dari 1 config aktif bertipe ${configType} untuk tenant ini; sync per-tipe ambigu. Edit langsung lewat editor.`);
          continue;
        }
        const row = found.rows[0];

        if (direction === "pull") {
          if (!row) {
            report("failed", "Config tidak ada di database");
            continue;
          }
          if (fs.existsSync(filePath)) {
            try {
              if (sameJson(row.value || {}, JSON.parse(fs.readFileSync(filePath, "utf8")))) {
                await setPresetBase(tenantId, linkType, filePath, row.version_token);
                report("skipped", "Sudah sama");
                continue;
              }
            } catch {
              /* file lama rusak: tetap ditimpa (ada .bak) */
            }
          }
          writeJsonFileWithBackup(filePath, row.value || {});
          await setPresetBase(tenantId, linkType, filePath, row.version_token);
          report("updated");
          continue;
        }

        // push: file -> DB
        if (!fs.existsSync(filePath)) {
          report("failed", "File tidak ditemukan");
          continue;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (e: any) {
          report("failed", "JSON file tidak valid: " + e.message);
          continue;
        }
        if (!parsed || typeof parsed !== "object") {
          report("failed", "Isi file harus berupa object JSON");
          continue;
        }

        if (row) {
          if (sameJson(row.value || {}, parsed)) {
            await setPresetBase(tenantId, linkType, filePath, row.version_token);
            report("skipped", "Sudah sama");
            continue;
          }
          // Tolak push bila file belum pernah di-pull, atau DB sudah berubah sejak pull terakhir
          const linkRow = await auditDb.query(`
            SELECT file_path, base_db_version FROM tenant_studio.preset_links
            WHERE tenant_id = ${esc(tenantId)} AND config_type = ${esc(linkType)};
          `);
          const link = linkRow.rows[0];
          if (!link || link.file_path !== filePath || !link.base_db_version) {
            report("failed", "File ini belum pernah di-pull dari database. Pull dulu sebelum push.");
            continue;
          }
          if (link.base_db_version !== row.version_token) {
            report("failed", "Database sudah berubah sejak pull terakhir. Pull dulu, lalu terapkan ulang perubahan file.");
            continue;
          }
          const upd = await targetDb.query(`
            UPDATE ${D.table}
            SET value = ${esc(JSON.stringify(parsed))}::jsonb, updated_at = NOW()
            WHERE id = ${esc(row.id)} AND updated_at::text = ${esc(row.version_token)}
            RETURNING updated_at::text AS version_token;
          `);
          if (upd.rows.length === 0) {
            report("failed", "Database berubah saat proses push. Pull dulu, lalu coba lagi.");
            continue;
          }
          // Snapshot data SEBELUM perubahan
          await snapshotBeforeChange(row, `Push dari file: ${path.basename(filePath)}`, authorName);
          await setPresetBase(tenantId, linkType, filePath, upd.rows[0].version_token);
          report("updated");
        } else if (createIfMissing) {
          const newId = randomUUID();
          const cleanGroup = groupId ? String(groupId).trim() : null;
          await targetDb.query(`
            INSERT INTO ${D.table}
            (id, tenant_id, group_id, ${D.typeCol}, ${D.hasPath ? "path, " : ""}value, is_default, created_at, updated_at)
            VALUES (
              ${esc(newId)},
              ${isGlobal ? "NULL" : esc(tenantId)},
              ${cleanGroup ? esc(cleanGroup) : "NULL"},
              ${esc(configType)},
              ${D.hasPath ? esc(configType.toLowerCase().replace(/_/g, "-")) + "," : ""}
              ${esc(JSON.stringify(parsed))}::jsonb,
              ${isGlobal ? "true" : "false"},
              NOW(), NOW()
            );
          `);
          await snapshotBeforeChange(
            { id: newId, tenant_id: isGlobal ? null : tenantId, group_id: cleanGroup, config_type: configType, value: parsed },
            `Dibuat dari file: ${path.basename(filePath)}`,
            authorName
          );
          const createdRow = await targetDb.query(`
            SELECT updated_at::text AS version_token FROM ${D.table} WHERE id = ${esc(newId)};
          `);
          await setPresetBase(tenantId, linkType, filePath, createdRow.rows[0].version_token);
          report("created");
        } else {
          report("failed", "Config belum ada di database (aktifkan 'buat baru' untuk membuatnya)");
        }
      } catch (e: any) {
        report("failed", e.message);
      }
    }

    const count = (a: string) => results.filter((r) => r.action === a).length;
    res.json({
      success: true,
      direction,
      updated: count("updated"),
      created: count("created"),
      skipped: count("skipped"),
      failed: count("failed"),
      results
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Tenant Config Studio BFF running on http://localhost:${PORT}`);
});
