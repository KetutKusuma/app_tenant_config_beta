import { randomUUID } from "crypto";
import express from "express";
import fs from "fs";
import path from "path";
import { actorName } from "../auth";
import { auditDb, esc } from "../db";
import { domainOf, presetDirFor } from "../domain";
import { assertWritable } from "../envs";
import { backupThenWrite } from "../backupFirst";
import { autoSummary, composeNote, parseReason } from "../changeSummary";
import { isSafePresetPath, normalizeName, sameJson, scanJsonFiles, setPresetBase, snapshotBeforeChange, discardSnapshot, upsertPresetLink, writeJsonFileWithBackup } from "../presetSync";

// Route: Sync Center (status, tautan file, apply push/pull) dan tulis file preset lokal.

export const router = express.Router();

// Tulis 1 file lokal persis di path yang diberikan (untuk edit window Preset Lokal)
router.put("/api/references/file", (req, res) => {
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
router.get("/api/sync/status", async (req, res) => {
  try {
    const tenantId = String(req.query.tenantId || "GLOBAL_DEFAULT");
    const dir = (req.query.dir as string) || presetDirFor(req);
    const isGlobal = tenantId === "GLOBAL_DEFAULT";
    const D = domainOf(req);

    const cfgRes = await req.targetDb!.query(`
      SELECT id, group_id, ${D.typeCol} AS config_type, value, updated_at, updated_at::text AS version_token
      FROM ${D.table}
      WHERE ${isGlobal ? "tenant_id IS NULL" : `tenant_id = ${esc(tenantId)}`} AND deleted_at IS NULL
      ORDER BY ${D.typeCol} ASC;
    `);
    const linkRes = await auditDb.query(`
      SELECT config_type, file_path, base_db_version FROM tenant_studio.preset_links
      WHERE user_id = ${esc(req.user!.id)} AND target_env = ${esc(req.targetEnv!.name)} AND tenant_id = ${esc(tenantId)};
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
router.put("/api/sync/link", async (req, res) => {
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
        WHERE user_id = ${esc(req.user!.id)} AND target_env = ${esc(req.targetEnv!.name)} AND tenant_id = ${esc(tenantId)} AND config_type = ${esc(configType)};
      `);
      return res.json({ success: true, message: "Link file dihapus" });
    }
    if (!isSafePresetPath(filePath)) {
      return res.status(400).json({ error: "Path harus absolut dan berekstensi .json" });
    }
    await upsertPresetLink(req.user!.id, req.targetEnv!.name, tenantId, configType, filePath);
    res.json({ success: true, message: "Link file disimpan" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Terapkan sinkronisasi HANYA untuk item yang dipilih eksplisit (push: file->DB, pull: DB->file)
router.post("/api/sync/apply", async (req, res) => {
  try {
    const { tenantId, direction, items, createIfMissing = false, groupId, reason: rawReason } = req.body;
    const authorName = `${actorName(req, "Preset Sync")} (Sync Center)`;
    if (direction !== "push" && direction !== "pull") {
      return res.status(400).json({ error: "direction harus 'push' atau 'pull'" });
    }
    if (!tenantId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "tenantId dan items wajib diisi" });
    }
    // Pull hanya menulis file lokal; push menulis ke ats_db sehingga tunduk pada aturan env
    if (direction === "push" && !assertWritable(req, res)) return;
    // Push menulis history untuk tiap item, jadi alasan wajib dan dicek sebelum loop. Pull mengabaikan reason.
    let reason = "";
    if (direction === "push") {
      const parsedReason = parseReason(rawReason);
      if (!parsedReason.ok) return res.status(400).json({ error: parsedReason.error });
      reason = parsedReason.value;
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

        const found = await req.targetDb!.query(`
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
                await setPresetBase(req.user!.id, req.targetEnv!.name, tenantId, linkType, filePath, row.version_token);
                report("skipped", "Sudah sama");
                continue;
              }
            } catch {
              /* file lama rusak: tetap ditimpa (ada .bak) */
            }
          }
          writeJsonFileWithBackup(filePath, row.value || {});
          await setPresetBase(req.user!.id, req.targetEnv!.name, tenantId, linkType, filePath, row.version_token);
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
            await setPresetBase(req.user!.id, req.targetEnv!.name, tenantId, linkType, filePath, row.version_token);
            report("skipped", "Sudah sama");
            continue;
          }
          // Tolak push bila file belum pernah di-pull, atau DB sudah berubah sejak pull terakhir
          const linkRow = await auditDb.query(`
            SELECT file_path, base_db_version FROM tenant_studio.preset_links
            WHERE user_id = ${esc(req.user!.id)} AND target_env = ${esc(req.targetEnv!.name)} AND tenant_id = ${esc(tenantId)} AND config_type = ${esc(linkType)};
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
          let backedUp = false;
          let outcome;
          try {
            outcome = await backupThenWrite({
              backup: async () => {
                const snap = await snapshotBeforeChange(
                  row,
                  composeNote(reason, `Push dari file ${path.basename(filePath)}`, autoSummary(row.value, parsed)),
                  authorName,
                  req.targetEnv!.name
                );
                backedUp = true;
                return snap.historyId;
              },
              write: async () => {
                const upd = await req.targetDb!.query(`
                  UPDATE ${D.table}
                  SET value = ${esc(JSON.stringify(parsed))}::jsonb, updated_at = NOW()
                  WHERE id = ${esc(row.id)} AND updated_at::text = ${esc(row.version_token)}
                  RETURNING updated_at::text AS version_token;
                `);
                return upd.rows[0] ?? null;
              },
              discard: discardSnapshot,
              onDiscardError: (e) => console.error("Gagal membuang cadangan history:", e)
            });
          } catch (e: any) {
            if (!backedUp) {
              report("failed", "Gagal mencadangkan isi lama: " + e.message);
              continue;
            }
            throw e;
          }
          if (outcome.status === "stale") {
            report("failed", "Database berubah saat proses push. Pull dulu, lalu coba lagi.");
            continue;
          }
          await setPresetBase(req.user!.id, req.targetEnv!.name, tenantId, linkType, filePath, outcome.result.version_token);
          report("updated");
        } else if (createIfMissing) {
          const newId = randomUUID();
          const cleanGroup = groupId ? String(groupId).trim() : null;
          await req.targetDb!.query(`
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
            composeNote(reason, `Dibuat dari file ${path.basename(filePath)}`, "Config baru"),
            authorName,
            req.targetEnv!.name
          );
          const createdRow = await req.targetDb!.query(`
            SELECT updated_at::text AS version_token FROM ${D.table} WHERE id = ${esc(newId)};
          `);
          await setPresetBase(req.user!.id, req.targetEnv!.name, tenantId, linkType, filePath, createdRow.rows[0].version_token);
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
