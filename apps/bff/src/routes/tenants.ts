import express from "express";
import { auditDb, esc } from "../db";
import { domainOf } from "../domain";
import { baseTenantCode, defaultEnvName, listProfiles, pingProfile, poolFor, serviceAvailability } from "../envs";

// Route: profil target env, health check, direktori tenant & daftar config per tenant.

export const router = express.Router();

// Daftar profil target env (tanpa kredensial) + status koneksi + layanan yang tersedia di masing-masing
router.get("/api/envs", async (req, res) => {
  try {
    const { profiles, errors, defaultEnv } = listProfiles();
    const statuses = await Promise.all(profiles.map((p) => pingProfile(p.name)));
    const services = await Promise.all(profiles.map((p) => serviceAvailability(p.name)));
    res.json({
      data: profiles.map((p, i) => ({ ...p, status: statuses[i], services: services[i] })),
      errors,
      defaultEnv
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Health Check
router.get("/health", async (req, res) => {
  try {
    await poolFor(defaultEnvName()).query("SELECT NOW()");
    await auditDb.query("SELECT NOW()");
    res.json({
      status: "ok",
      service: "tenant-config-bff",
      targetDatabase: "connected",
      defaultTargetEnv: defaultEnvName(),
      auditDatabase: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ status: "degraded", error: err.message });
  }
});

// 1. Tenant Directory & Discovery
router.get("/api/tenants", async (req, res) => {
  try {
    const D = domainOf(req);
    // Tenant per target env: tenant_id/group_id/client_code berbeda di dev, staging, prod
    const metaRes = await auditDb.query(`
      SELECT tenant_id, group_id, client_name, client_code, environment, tags, notes, updated_at
      FROM tenant_studio.tenant_metadata
      WHERE target_env = ${esc(req.targetEnv!.name)}
      ORDER BY client_name ASC;
    `);
    const suffix = req.targetEnv!.tenantCodeSuffix;

    // Jumlah config dari DB target hanya pelengkap: bila DB target tidak terjangkau (mis. VPN mati),
    // daftar tenant (dari audit DB) tetap dikirim beserta peringatan, bukan gagal total.
    let configRows: Array<{ tenant_id: string | null; total_configs: string }> = [];
    let targetError: string | null = null;
    try {
      const configsRes = await req.targetDb!.query(`
        SELECT tenant_id, count(*) as total_configs
        FROM ${D.table}
        WHERE deleted_at IS NULL
        GROUP BY tenant_id;
      `);
      configRows = configsRes.rows;
    } catch (err: any) {
      targetError = err.message;
    }

    const atsMap = new Map<string, number>();
    configRows.forEach(r => {
      const key = r.tenant_id ? String(r.tenant_id) : "GLOBAL_DEFAULT";
      atsMap.set(key, parseInt(r.total_configs, 10));
    });

    const results = metaRes.rows.map(m => ({
      tenantId: m.tenant_id,
      groupId: m.group_id || null,
      name: m.client_name,
      code: m.client_code,
      baseCode: baseTenantCode(m.client_code, suffix),
      environment: m.environment,
      tags: m.tags || [],
      notes: m.notes || "",
      totalConfigs: atsMap.get(m.tenant_id) || 0,
      updatedAt: m.updated_at
    }));

    res.json({ data: results, targetError });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Hapus tenant dari daftar Studio untuk env aktif saja (baris tenant_metadata di audit DB).
// Config tenant di DB target (ats_db) TIDAK disentuh; env lain juga tidak terpengaruh.
router.delete("/api/tenants/:tenantId", async (req, res) => {
  try {
    const env = req.targetEnv!;
    const { rows } = await auditDb.query(`
      DELETE FROM tenant_studio.tenant_metadata
      WHERE target_env = ${esc(env.name)} AND tenant_id = ${esc(req.params.tenantId)}
      RETURNING tenant_id, client_name, client_code;
    `);
    if (rows.length === 0) {
      return res.status(404).json({ error: `Tenant ${req.params.tenantId} tidak terdaftar di env ${env.label}` });
    }
    res.json({ success: true, message: `${rows[0].client_name} (${rows[0].client_code}) dihapus dari daftar env ${env.label}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Klien yang sudah terdaftar di env lain tetapi belum ada di env aktif (dicocokkan lewat kode dasar).
// Dipakai sebagai saran saat mendaftarkan tenant di env baru: nama & kode bisa diisi otomatis,
// tenant_id / group_id tetap diisi manual karena berbeda di tiap env.
router.get("/api/tenants/catalog", async (req, res) => {
  try {
    const active = req.targetEnv!;
    const suffixOf = new Map(listProfiles().profiles.map(p => [p.name, p.tenantCodeSuffix]));
    const { rows } = await auditDb.query(`
      SELECT target_env, tenant_id, client_name, client_code
      FROM tenant_studio.tenant_metadata
      ORDER BY client_name ASC, target_env ASC;
    `);
    const baseOf = (r: any) => baseTenantCode(r.client_code, suffixOf.get(r.target_env) || "");
    const existing = new Set(rows.filter(r => r.target_env === active.name).map(baseOf));
    const catalog = new Map<string, { baseCode: string; name: string; envs: string[]; tenantId: string | null }>();
    for (const r of rows) {
      if (r.target_env === active.name) continue;
      const baseCode = baseOf(r);
      if (existing.has(baseCode)) continue;
      const item = catalog.get(baseCode) || { baseCode, name: r.client_name, envs: [] as string[], tenantId: null as string | null };
      if (!item.envs.includes(r.target_env)) item.envs.push(r.target_env);
      // GLOBAL_DEFAULT (config tanpa tenant) memakai id yang sama di semua env
      if (r.tenant_id === "GLOBAL_DEFAULT") item.tenantId = "GLOBAL_DEFAULT";
      catalog.set(baseCode, item);
    }
    res.json({ data: [...catalog.values()], suffix: active.tenantCodeSuffix });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create or Update Tenant Metadata (Label, Name, Group ID, Code, Tags, Notes)
router.post("/api/tenants", async (req, res) => {
  const { tenantId, groupId, clientName, clientCode, tags, notes } = req.body;

  if (!tenantId || !clientName) {
    return res.status(400).json({ error: "tenantId dan clientName wajib diisi!" });
  }

  try {
    const env = req.targetEnv!;
    const cleanTenantId = tenantId.trim();
    const cleanGroupId = groupId ? groupId.trim() : null;
    let cleanCode = (clientCode || cleanTenantId.substring(0, 4)).trim().toUpperCase();
    // Kode tenant wajib berakhiran env (IDM -> IDM_PROD) agar tidak tertukar antar env
    if (env.tenantCodeSuffix && !cleanCode.endsWith(env.tenantCodeSuffix)) cleanCode += env.tenantCodeSuffix;
    const tagArray = Array.isArray(tags) ? tags : [];
    const tagsSql = "ARRAY[" + tagArray.map(t => esc(t)).join(",") + "]::text[]";

    await auditDb.query(`
      INSERT INTO tenant_studio.tenant_metadata 
      (target_env, tenant_id, group_id, client_name, client_code, environment, tags, notes, updated_at)
      VALUES (
        ${esc(env.name)},
        ${esc(cleanTenantId)}, 
        ${cleanGroupId ? esc(cleanGroupId) : "NULL"}, 
        ${esc(clientName)}, 
        ${esc(cleanCode)}, 
        ${esc(env.name)}, 
        ${tagsSql}, 
        ${esc(notes || "")}, 
        NOW()
      )
      ON CONFLICT (target_env, tenant_id) DO UPDATE 
      SET 
        group_id = EXCLUDED.group_id,
        client_name = EXCLUDED.client_name,
        client_code = EXCLUDED.client_code,
        tags = EXCLUDED.tags,
        notes = EXCLUDED.notes,
        updated_at = NOW();
    `);

    res.json({
      success: true,
      message: `Tenant ${cleanTenantId} (${cleanCode}) berhasil disimpan untuk env ${env.label}.`,
      code: cleanCode
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. List Configurations for a Tenant
router.get("/api/tenants/:tenantId/configs", async (req, res) => {
  try {
    const { tenantId } = req.params;
    const D = domainOf(req);
    const whereClause = tenantId === "GLOBAL_DEFAULT"
      ? "tenant_id IS NULL AND deleted_at IS NULL"
      : `tenant_id = ${esc(tenantId)} AND deleted_at IS NULL`;

    const configsRes = await req.targetDb!.query(`
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
