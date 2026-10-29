import express from "express";
import { domainOf } from "../domain";
import { poolFor } from "../envs";
import { buildCompareEntries, loadSides } from "../compare/compareEntries";
import { fetchTenantMeta, fetchTenantRows, findProfile } from "../compare/tenantRows";
import { buildExportSql, exportFileName, resolveGroupId } from "../compare/sqlExport";
import { createBatch } from "../compare/batches";
import { actorName } from "../auth";

// Route: banding seluruh config satu tenant di env A dengan satu tenant di env B (baca saja).

export const router = express.Router();

router.get("/api/compare", async (req, res) => {
  try {
    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : "");
    const leftEnv = q("leftEnv"), leftTenant = q("leftTenant"), rightEnv = q("rightEnv"), rightTenant = q("rightTenant");
    if (!leftEnv || !leftTenant || !rightEnv || !rightTenant) {
      return res.status(400).json({ error: "Parameter leftEnv, leftTenant, rightEnv, dan rightTenant wajib diisi" });
    }
    const lp = findProfile(leftEnv), rp = findProfile(rightEnv);
    if (!lp) return res.status(400).json({ error: `Env '${leftEnv}' tidak dikenal` });
    if (!rp) return res.status(400).json({ error: `Env '${rightEnv}' tidak dikenal` });

    const D = domainOf(req);
    const loaded = await loadSides(
      async () => fetchTenantRows(poolFor(leftEnv), D, leftTenant),
      async () => fetchTenantRows(poolFor(rightEnv), D, rightTenant),
      { kiri: lp.label, kanan: rp.label }
    );
    if (!loaded.ok) return res.status(502).json({ error: loaded.error, side: loaded.side });
    res.json({ data: buildCompareEntries(loaded.left, loaded.right) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Export SQL (hanya membuat teks SQL + mencatat batch di audit DB; tidak menulis ke DB target) ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNAPSHOT_WARNING = "Isi lama di tujuan tidak bisa dicadangkan otomatis.";

export interface ExportBody {
  sourceEnv: string;
  sourceTenantId: string;
  configTypes: string[];
  mode: "timpa" | "lewati";
  target: { kind: "profile"; env: string; tenantId: string } | { kind: "manual"; tenantId: string; groupId?: string };
}

export function parseExportBody(body: any): { ok: true; value: ExportBody } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (!body || typeof body !== "object") return fail("Body permintaan tidak valid");
  const sourceEnv = str(body.sourceEnv), sourceTenantId = str(body.sourceTenantId);
  if (!sourceEnv || !sourceTenantId) return fail("sourceEnv dan sourceTenantId wajib diisi");
  if (!Array.isArray(body.configTypes) || body.configTypes.length === 0) return fail("Pilih minimal satu config");
  if (!body.configTypes.every((t: unknown) => typeof t === "string" && t.trim())) return fail("configTypes harus berisi teks");
  const configTypes = Array.from(new Set<string>(body.configTypes.map((t: string) => t.trim())));
  if (body.mode !== "timpa" && body.mode !== "lewati") return fail("mode harus 'timpa' atau 'lewati'");
  const t = body.target;
  if (!t || typeof t !== "object") return fail("target wajib diisi");
  if (t.kind === "profile") {
    const env = str(t.env), tenantId = str(t.tenantId);
    if (!env || !tenantId) return fail("target.env dan target.tenantId wajib diisi");
    return { ok: true, value: { sourceEnv, sourceTenantId, configTypes, mode: body.mode, target: { kind: "profile", env, tenantId } } };
  }
  if (t.kind === "manual") {
    const tenantId = str(t.tenantId);
    if (tenantId !== "GLOBAL_DEFAULT" && !UUID_RE.test(tenantId)) return fail("Tenant ID tujuan harus berupa UUID atau GLOBAL_DEFAULT");
    const groupId = str(t.groupId);
    if (groupId && !UUID_RE.test(groupId)) return fail("Group ID tujuan harus berupa UUID");
    return { ok: true, value: { sourceEnv, sourceTenantId, configTypes, mode: body.mode, target: { kind: "manual", tenantId, ...(groupId ? { groupId } : {}) } } };
  }
  return fail("target.kind harus 'profile' atau 'manual'");
}

router.post("/api/compare/export-sql", async (req, res) => {
  try {
    const parsed = parseExportBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { sourceEnv, sourceTenantId, configTypes, mode, target } = parsed.value;
    const D = domainOf(req);
    const sp = findProfile(sourceEnv);
    if (!sp) return res.status(400).json({ error: `Env '${sourceEnv}' tidak dikenal` });

    const sourceMeta = await fetchTenantMeta(sourceEnv, sourceTenantId);
    if (!sourceMeta) return res.status(400).json({ error: `Tenant sumber belum terdaftar di env '${sourceEnv}'` });

    // Isi sumber dibaca ulang saat request.
    const srcRows = await fetchTenantRows(poolFor(sourceEnv), D, sourceTenantId, configTypes);
    const byType = new Map<string, typeof srcRows>();
    for (const r of srcRows) byType.set(r.config_type, [...(byType.get(r.config_type) ?? []), r]);
    const missing = configTypes.filter((c) => !byType.has(c));
    if (missing.length) return res.status(400).json({ error: `Config tidak ada di sumber: ${missing.join(", ")}` });
    const dupes = configTypes.filter((c) => (byType.get(c)?.length ?? 0) > 1);
    if (dupes.length) return res.status(400).json({ error: `Config berstatus ganda di sumber: ${dupes.join(", ")}` });

    // Tentukan tujuan.
    const isGlobal = target.tenantId === "GLOBAL_DEFAULT";
    let targetEnvLabel: string, batchTargetEnv: string, targetTenantCode: string;
    let groupInput: string | null;
    let snapshotEnv: string | null;
    if (target.kind === "profile") {
      if (!findProfile(target.env)) return res.status(400).json({ error: `Env '${target.env}' tidak dikenal` });
      targetEnvLabel = target.env;
      batchTargetEnv = target.env;
      snapshotEnv = target.env;
      if (isGlobal) {
        targetTenantCode = "GLOBAL_DEFAULT";
        groupInput = null;
      } else {
        const tm = await fetchTenantMeta(target.env, target.tenantId);
        if (!tm) return res.status(400).json({ error: `Tenant tujuan belum terdaftar di env '${target.env}'` });
        targetTenantCode = tm.code;
        groupInput = tm.groupId;
      }
    } else {
      targetEnvLabel = "production";
      batchTargetEnv = "production-manual";
      targetTenantCode = `${sourceMeta.baseCode}_PROD`;
      groupInput = target.groupId ?? null;
      snapshotEnv = findProfile("production") ? "production" : null;
    }
    const tenantIdForSql = isGlobal ? null : target.tenantId;
    const groupId = resolveGroupId(tenantIdForSql, groupInput);

    // before_snapshot: hanya baca; gagal tidak menggagalkan export.
    let beforeSnapshot: Record<string, { id: string; value: any; updated_at: string } | null> | null = null;
    let warning: string | null = null;
    if (snapshotEnv) {
      try {
        const tr = await fetchTenantRows(poolFor(snapshotEnv), D, target.tenantId, configTypes);
        const snap: Record<string, { id: string; value: any; updated_at: string } | null> = {};
        for (const c of configTypes) {
          const row = tr.find((r) => r.config_type === c);
          snap[c] = row ? { id: row.id, value: row.value, updated_at: row.version_token } : null;
        }
        beforeSnapshot = snap;
      } catch {
        beforeSnapshot = null;
      }
    }
    if (!beforeSnapshot) warning = SNAPSHOT_WARNING;

    const now = new Date();
    const author = actorName(req);
    const sql = buildExportSql({
      domain: { table: D.table, typeCol: D.typeCol, hasPath: D.hasPath },
      mode,
      source: { env: sourceEnv, tenantCode: sourceMeta.code },
      target: { env: targetEnvLabel, tenantId: tenantIdForSql, groupId: groupInput, tenantCode: targetTenantCode },
      author,
      createdAt: now,
      items: configTypes.map((c) => {
        const r = byType.get(c)![0];
        return { configType: c, path: r.path ?? null, value: r.value, isDefault: !!r.is_default };
      }),
    });
    const fileName = exportFileName(sourceMeta.code, D.table, now);

    const batchId = await createBatch({
      kind: "export_sql",
      domain: D.key,
      sourceEnv,
      sourceTenantId,
      sourceTenantCode: sourceMeta.code,
      targetEnv: batchTargetEnv,
      targetTenantId: target.tenantId,
      targetGroupId: groupId,
      targetTenantCode,
      mode,
      configTypes,
      counts: { total: configTypes.length },
      status: "diekspor",
      author,
      sqlText: sql,
      beforeSnapshot,
    });

    res.json({ data: { sql, fileName, batchId, beforeSnapshot: beforeSnapshot ? "tersimpan" : "tidak_tersedia", warning } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
