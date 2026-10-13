import express from "express";
import { auditDb, esc } from "../db";
import { domainOf } from "../domain";
import { defaultEnvName, listProfiles, pingProfile, poolFor } from "../envs";

// Route: profil target env, health check, direktori tenant & daftar config per tenant.

export const router = express.Router();

// Daftar profil target env (tanpa kredensial) + status koneksi masing-masing
router.get("/api/envs", async (req, res) => {
  try {
    const { profiles, errors, defaultEnv } = listProfiles();
    const statuses = await Promise.all(profiles.map((p) => pingProfile(p.name)));
    res.json({
      data: profiles.map((p, i) => ({ ...p, status: statuses[i] })),
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
    const metaRes = await auditDb.query(`
      SELECT tenant_id, group_id, client_name, client_code, environment, tags, notes, updated_at
      FROM tenant_studio.tenant_metadata
      ORDER BY client_name ASC;
    `);

    const configsRes = await req.targetDb!.query(`
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
router.post("/api/tenants", async (req, res) => {
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
