import { randomUUID } from "crypto";
import express from "express";
import { actorName } from "../auth";
import { auditDb, esc } from "../db";
import { scopeOf } from "../services";
import { domainOf, staleVersionError } from "../domain";
import { assertWritable } from "../envs";
import { backupThenWrite } from "../backupFirst";
import { discardSnapshot, snapshotBeforeChange } from "../presetSync";
import { autoSummary, composeNote, parseReason } from "../changeSummary";

// Route: CRUD konfigurasi (detail, buat, update + optimistic locking, hapus) dan riwayat.

export const router = express.Router();

// 3. Get Configuration Detail (JSONB Value)
router.get("/api/configs/:configId", async (req, res) => {
  try {
    const { configId } = req.params;
    const D = domainOf(req);
    const rowRes = await req.targetDb!.query(`
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
router.post("/api/configs", async (req, res) => {
  const { tenantId, groupId, configType, path: configPath, value } = req.body;

  if (!configType) {
    return res.status(400).json({ error: "configType wajib diisi!" });
  }
  if (!assertWritable(req, res)) return;

  try {
    const targetTenantId = (tenantId === "GLOBAL_DEFAULT" || !tenantId) ? null : tenantId;
    const cleanGroupId = groupId ? groupId.trim() : null;
    const cleanPath = configPath || configType.toLowerCase().replace(/_/g, "-");
    const jsonValue = value && typeof value === "object" ? value : {};
    const configId = (req.body.id && typeof req.body.id === "string" && req.body.id.trim()) ? req.body.id.trim() : randomUUID();
    const D = domainOf(req);

    const insertRes = await req.targetDb!.query(`
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
      (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name, target_env, target_service)
      VALUES (
        ${targetTenantId ? esc(targetTenantId) : "NULL"}, 
        ${cleanGroupId ? esc(cleanGroupId) : "NULL"}, 
        ${esc(configType)}, 
        ${esc(newConfigId)}, 
        1, 
        ${esc(JSON.stringify(jsonValue))}::jsonb, 
        'Initial creation', 
        ${esc(actorName(req))},
        ${esc(req.targetEnv!.name)},
        ${esc(req.targetService!.key)}
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

// 5. Update Configuration & Record Audit Snapshot
router.put("/api/configs/:configId", async (req, res) => {
  const { configId } = req.params;
  const { value, groupId, changeSummary, expectedVersion } = req.body;
  const authorName = actorName(req);
  const D = domainOf(req);

  if (!value || typeof value !== "object") {
    return res.status(400).json({ error: "Value must be a valid JSON object" });
  }
  // changeSummary dari klien diperlakukan sebagai alasan perubahan (wajib)
  const reason = parseReason(changeSummary);
  if (!reason.ok) return res.status(400).json({ error: reason.error });
  if (!assertWritable(req, res)) return;

  try {
    const curRes = await req.targetDb!.query(`
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

    // Cadangkan isi lama ke history DULU; bila tulis gagal/stale, cadangan dibuang
    let backupVersion = 0;
    const outcome = await backupThenWrite({
      backup: async () => {
        const snap = await snapshotBeforeChange(
          currentConfig,
          composeNote(reason.value, autoSummary(currentConfig.value, value)),
          authorName,
          scopeOf(req)
        );
        backupVersion = snap.version;
        return snap.historyId;
      },
      write: async () => {
        const updRes = await req.targetDb!.query(`
          UPDATE ${D.table} 
          SET 
            value = ${esc(JSON.stringify(value))}::jsonb, 
            group_id = ${finalGroupId ? esc(finalGroupId) : "NULL"},
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
      message: `Configuration ${configId} successfully updated to version ${backupVersion}`,
      version: backupVersion,
      versionToken: outcome.result.version_token
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5a. Ringkasan otomatis beda dua nilai config (hanya membaca, tidak menulis apa pun)
router.post("/api/change-summary", (req, res) => {
  const { before, after } = req.body;
  if (after === undefined) {
    return res.status(400).json({ error: "after wajib diisi" });
  }
  res.json({ data: { summary: autoSummary(before ?? null, after) } });
});

// 5b. Delete Configuration with Safety Confirmation & Audit Snapshot
router.delete("/api/configs/:configId", async (req, res) => {
  try {
    const { configId } = req.params;
    const { confirmationConfigType } = req.body;
    const authorName = actorName(req);
    if (!assertWritable(req, res)) return;
    const D = domainOf(req);

    const curRes = await req.targetDb!.query(`
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
      WHERE core_config_id = ${esc(configId)} AND target_env = ${esc(req.targetEnv!.name)} AND target_service = ${esc(req.targetService!.key)};
    `);
    const nextVersion = parseInt(verRes.rows[0].last_version, 10) + 1;

    await auditDb.query(`
      INSERT INTO tenant_studio.tenant_config_histories 
      (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name, target_env, target_service)
      VALUES (
        ${currentConfig.tenant_id ? esc(currentConfig.tenant_id) : "NULL"}, 
        ${currentConfig.group_id ? esc(currentConfig.group_id) : "NULL"}, 
        ${currentConfig.config_type ? esc(currentConfig.config_type) : "NULL"}, 
        ${esc(configId)}, 
        ${nextVersion}, 
        ${esc(JSON.stringify(currentConfig.value || {}))}::jsonb, 
        ${esc(`DELETED: Konfigurasi ${currentConfig.config_type} dihapus oleh ${authorName}`)}, 
        ${esc(authorName)},
        ${esc(req.targetEnv!.name)},
        ${esc(req.targetService!.key)}
      );
    `);

    // 2. Soft-delete di tabel domain aktif
    await req.targetDb!.query(`
      UPDATE ${D.table} 
      SET deleted_at = NOW(), updated_at = NOW() 
      WHERE id = ${esc(configId)};
    `);

    // 3. Bersihkan tautan preset_links jika ada
    if (currentConfig.tenant_id && currentConfig.config_type) {
      await auditDb.query(`
        DELETE FROM tenant_studio.preset_links 
        WHERE target_env = ${esc(req.targetEnv!.name)} AND target_service = ${esc(req.targetService!.key)} AND tenant_id = ${esc(currentConfig.tenant_id)} AND config_type = ${esc(D.linkKey(currentConfig.config_type))};
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
router.get("/api/configs/:configId/histories", async (req, res) => {
  try {
    const { configId } = req.params;
    // batch_*: diisi bila entri dibuat oleh Salin (label "Salin · <env sumber> · <kode tenant sumber>")
    const histRes = await auditDb.query(`
      SELECT h.id, h.version, h.group_id, h.config_value, h.change_summary, h.author_name, h.created_at,
        h.batch_id, b.kind AS batch_kind, b.source_env AS batch_source_env, b.source_tenant_code AS batch_source_tenant_code
      FROM tenant_studio.tenant_config_histories h
      LEFT JOIN tenant_studio.config_change_batches b ON b.id = h.batch_id
      WHERE h.core_config_id = ${esc(configId)} AND h.target_env = ${esc(req.targetEnv!.name)} AND h.target_service = ${esc(req.targetService!.key)}
      ORDER BY h.version DESC;
    `);
    res.json({ data: histRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
