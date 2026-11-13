import { pgErrorMessage } from "../configRows";
import express from "express";
import { domainOf, domainSpecFor, isConfigDomain, type ConfigDomain, type DomainSpec } from "../domain";
import { assertServiceInEnvs } from "../compare/compareService";
import { assertWritable, poolFor, serviceAvailability } from "../envs";
import { buildCompareEntries, loadSides } from "../compare/compareEntries";
import { fetchTenantMeta, fetchTenantRows, findProfile } from "../compare/tenantRows";
import { buildExportSql, exportBatchShape, exportFileName, exportItemOf, resolveGroupId, typeKey, type ExportSection } from "../compare/sqlExport";
import { createBatch, finishBatch, getBatch, listBatches } from "../compare/batches";
import {
  PathConflictError, TargetChangedError, applyPathOverrides, batchShape, isCommitUncertain, overriddenSourcePaths, planCopy, runCopy,
  selectPlan, selectionMismatch, staleConfigTypes, writeCopyTxMulti, type CopyDeps, type CopyPart,
} from "../compare/copyConfigs";
import { duplicateFinalPaths, finalPath, findPathConflicts, takenPathsWithPrefix, tenantCodeSlug } from "../compare/pathConflicts";
import { attachConflicts, previewItems, previewSourceOnly, type CopyPreview, type PreviewItem } from "../compare/copyPreview";
import { autoSummary, composeNote, parseReason } from "../changeSummary";
import { discardBatchSnapshots, snapshotBeforeChange } from "../presetSync";
import { actorName } from "../auth";
import type { ConfigRow } from "../compare/types";

// Route: banding seluruh config satu tenant di env A dengan satu tenant di env B (baca saja),
// pratinjau salin dan cek path (baca saja), Export SQL (hanya membuat teks),
// Salin (menulis ke env X-Target-Env), dan riwayat batch.

export const router = express.Router();


/** Nama database layanan aktif di env tujuan (header Export SQL); production-manual → null */
async function serviceDbName(req: express.Request, env: string): Promise<string | null> {
  if (env === PRODUCTION_MANUAL) return null;
  return (await serviceAvailability(env)).find((s) => s.key === req.targetService!.key)?.dbName ?? null;
}

/** Pesan bila layanan aktif tidak tersedia di salah satu env; dikirim sebagai 409 */
async function serviceEnvError(req: express.Request, envs: string[]): Promise<string | null> {
  return assertServiceInEnvs(req.targetService!.key, envs);
}

/** Buang domain yang tidak dimiliki layanan aktif (mis. workflow di Auth). Kosong → null */
function supportedDomains<T>(req: express.Request, items: T[], nameOf: (t: T) => ConfigDomain): T[] | null {
  const kept = items.filter((t) => domainSpecFor(req.targetService!.key, nameOf(t)) !== null);
  return kept.length ? kept : null;
}

const noDomainError = (req: express.Request) => `Layanan ${req.targetService!.label} tidak punya domain yang diminta.`;

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

    const envErr = await serviceEnvError(req, [leftEnv, rightEnv]);
    if (envErr) return res.status(409).json({ code: "SERVICE_UNAVAILABLE", error: envErr });
    const D = domainOf(req);
    const loaded = await loadSides(
      async () => fetchTenantRows(poolFor(leftEnv, req.targetService!.key), D, leftTenant),
      async () => fetchTenantRows(poolFor(rightEnv, req.targetService!.key), D, rightTenant),
      { kiri: lp.label, kanan: rp.label }
    );
    if (!loaded.ok) return res.status(502).json({ error: loaded.error, side: loaded.side });
    res.json({ data: buildCompareEntries(loaded.left, loaded.right) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Pratinjau salin dan cek path langsung (baca saja; tidak pernah menulis ke DB mana pun) ----

/** Env tujuan khusus: production diisi manual lewat Export SQL, tidak bisa dibaca dari sini. */
const PRODUCTION_MANUAL = "production-manual";
const PRODUCTION_MANUAL_LABEL = "Production (isi manual)";

const queryText = (q: Record<string, unknown>, k: string) => (typeof q[k] === "string" ? (q[k] as string).trim() : "");

export interface PreviewQuery {
  sourceEnv: string;
  sourceTenantId: string;
  targetEnv: string;
  targetTenantId: string;
  domains: ConfigDomain[];
}

export function parsePreviewQuery(q: Record<string, unknown>): { ok: true; value: PreviewQuery } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const sourceEnv = queryText(q, "sourceEnv"), sourceTenantId = queryText(q, "sourceTenantId");
  const targetEnv = queryText(q, "targetEnv"), targetTenantId = queryText(q, "targetTenantId");
  if (!sourceEnv || !sourceTenantId || !targetEnv || !targetTenantId) {
    return fail("Parameter sourceEnv, sourceTenantId, targetEnv, dan targetTenantId wajib diisi");
  }
  if (targetTenantId === "GLOBAL_DEFAULT") return fail("GLOBAL_DEFAULT tidak bisa menjadi tujuan salin");
  const names = queryText(q, "domains").split(",").map((d) => d.trim()).filter(Boolean);
  if (names.length === 0) return fail("Parameter domains wajib diisi (pisahkan dengan koma)");
  const domains: ConfigDomain[] = [];
  for (const name of names) {
    if (!isConfigDomain(name)) return fail(`Domain '${name}' tidak dikenal`);
    if (!domains.includes(name as ConfigDomain)) domains.push(name as ConfigDomain);
  }
  return { ok: true, value: { sourceEnv, sourceTenantId, targetEnv, targetTenantId, domains } };
}

export interface PathCheckQuery { targetEnv: string; targetTenantId: string; path: string }

export function parsePathCheckQuery(q: Record<string, unknown>): { ok: true; value: PathCheckQuery } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const targetEnv = queryText(q, "targetEnv"), targetTenantId = queryText(q, "targetTenantId"), path = queryText(q, "path");
  if (!targetEnv || !targetTenantId || !path) return fail("Parameter targetEnv, targetTenantId, dan path wajib diisi");
  if (targetEnv === PRODUCTION_MANUAL) return fail(`Path tidak bisa dicek untuk ${PRODUCTION_MANUAL_LABEL}`);
  if (targetTenantId === "GLOBAL_DEFAULT") return fail("GLOBAL_DEFAULT tidak bisa menjadi tujuan salin");
  return { ok: true, value: { targetEnv, targetTenantId, path } };
}

// Status tiap config bila disalin, ringkasan otomatis, path akhir, dan path yang bentrok dengan tenant lain di tujuan.
router.get("/api/compare/copy-preview", async (req, res) => {
  try {
    const parsed = parsePreviewQuery(req.query);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { sourceEnv, sourceTenantId, targetEnv, targetTenantId } = parsed.value;
    const domains = supportedDomains(req, parsed.value.domains, (d) => d);
    if (!domains) return res.status(400).json({ error: noDomainError(req) });
    const envErr = await serviceEnvError(req, [sourceEnv, targetEnv]);
    if (envErr) return res.status(409).json({ code: "SERVICE_UNAVAILABLE", error: envErr });
    const sp = findProfile(sourceEnv);
    if (!sp) return res.status(400).json({ error: `Env '${sourceEnv}' tidak dikenal` });
    const targetReadable = targetEnv !== PRODUCTION_MANUAL;
    const tp = targetReadable ? findProfile(targetEnv) : undefined;
    if (targetReadable && !tp) return res.status(400).json({ error: `Env '${targetEnv}' tidak dikenal` });

    let targetTenantCode: string | null = null;
    if (targetReadable) {
      const tm = await fetchTenantMeta(targetEnv, targetTenantId);
      if (!tm) return res.status(400).json({ error: `Tenant tujuan belum terdaftar di env '${targetEnv}'` });
      targetTenantCode = tm.code;
    }

    const labels = { kiri: sp.label, kanan: tp?.label ?? PRODUCTION_MANUAL_LABEL };
    const out: CopyPreview["domains"] = [];
    for (const domain of domains) {
      const D = domainSpecFor(req.targetService!.key, domain)!;
      const loaded = await loadSides(
        async () => fetchTenantRows(poolFor(sourceEnv, req.targetService!.key), D, sourceTenantId),
        async () => (targetReadable ? fetchTenantRows(poolFor(targetEnv, req.targetService!.key), D, targetTenantId) : []),
        labels
      );
      if (!loaded.ok) return res.status(502).json({ error: loaded.error, side: loaded.side });

      let items: PreviewItem[];
      if (!targetReadable) {
        items = previewSourceOnly(loaded.left, D.hasPath);
      } else {
        items = previewItems(buildCompareEntries(loaded.left, loaded.right).entries, D.hasPath);
        // Path hanya ada di tenant_config; workflow_pipeline tidak punya kolom path, jadi tanpa SQL path.
        if (D.hasPath && targetTenantCode !== null) {
          const db = poolFor(targetEnv, req.targetService!.key);
          const paths = items.filter((i) => (i.status === "baru" || i.status === "timpa") && i.path !== null).map((i) => i.path as string);
          const conflicts = await findPathConflicts(db, D.table, paths, targetTenantId);
          if (conflicts.size) {
            const taken = await takenPathsWithPrefix(db, D.table, targetTenantId, tenantCodeSlug(targetTenantCode));
            items = attachConflicts(items, conflicts, targetTenantCode, taken);
          }
        }
      }
      out.push({ domain, items });
    }
    const data: CopyPreview = { targetReadable, targetTenantCode, domains: out };
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Apakah path ini masih bebas di tujuan (tidak dipakai tenant lain)? Hanya tenant_config yang punya path.
router.get("/api/compare/path-check", async (req, res) => {
  try {
    const parsed = parsePathCheckQuery(req.query);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { targetEnv, targetTenantId, path } = parsed.value;
    if (!findProfile(targetEnv)) return res.status(400).json({ error: `Env '${targetEnv}' tidak dikenal` });
    const envErr = await serviceEnvError(req, [targetEnv]);
    if (envErr) return res.status(409).json({ code: "SERVICE_UNAVAILABLE", error: envErr });
    const conflicts = await findPathConflicts(poolFor(targetEnv, req.targetService!.key), domainSpecFor(req.targetService!.key, "tenant_config")!.table, [path], targetTenantId);
    const owner = conflicts.get(path);
    res.json({ data: owner ? { available: false, ownerTenantId: owner.tenantId, ownerConfigType: owner.configType } : { available: true } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Aturan body yang sama untuk Salin dan Export SQL ----

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const pathConflictError = (paths: string[]) => `Path sudah dipakai tenant lain di tujuan: ${paths.join(", ")}`;

/** Satu entri `domains` yang lolos tahap 1: domain dikenal, tidak dobel, `pathOverrides` sah (di-trim). */
interface DomainStage { domain: ConfigDomain; raw: Record<string, unknown>; pathOverrides: Record<string, string> }

function parseDomainStage(domains: unknown): { ok: true; stage: DomainStage[] } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!Array.isArray(domains) || domains.length === 0) return fail("domains wajib berisi minimal satu domain");
  const seen = new Set<string>();
  const stage: DomainStage[] = [];
  for (const d of domains) {
    const name = isPlainObject(d) ? d.domain : undefined;
    if (typeof name !== "string" || !isConfigDomain(name)) return fail(`Domain '${String(name)}' tidak dikenal`);
    if (seen.has(name)) return fail(`Domain '${name}' disebut dua kali`);
    seen.add(name);
    const raw = d as Record<string, unknown>;
    const po = raw.pathOverrides;
    const pathOverrides: Record<string, string> = {};
    if (po !== undefined && po !== null) {
      if (!isPlainObject(po)) return fail("pathOverrides wajib berupa objek { config_type: path }");
      if (name === "workflow_pipeline" && Object.keys(po).length > 0) return fail("pathOverrides hanya untuk tenant_config");
      for (const [k, v] of Object.entries(po)) {
        if (typeof v !== "string") return fail(`pathOverrides.${k} harus teks`);
        pathOverrides[k] = v.trim();
      }
    }
    stage.push({ domain: name as ConfigDomain, raw, pathOverrides });
  }
  return { ok: true, stage };
}

// ---- Export SQL (hanya membuat teks SQL + mencatat batch di audit DB; tidak menulis ke DB target) ----

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNAPSHOT_WARNING = "Isi lama di tujuan tidak bisa dicadangkan otomatis.";

export interface ExportDomainBody {
  domain: ConfigDomain;
  configTypes: string[];
  /** config_type → path tujuan pengganti (hanya tenant_config) */
  pathOverrides: Record<string, string>;
}

export interface ExportBody {
  sourceEnv: string;
  sourceTenantId: string;
  mode: "timpa" | "lewati";
  reason: string;
  target: { kind: "profile"; env: string; tenantId: string } | { kind: "manual"; tenantId: string; groupId?: string };
  domains: ExportDomainBody[];
}

export function parseExportBody(body: any): { ok: true; value: ExportBody } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (!isPlainObject(body)) return fail("Body permintaan tidak valid");
  const sourceEnv = str(body.sourceEnv), sourceTenantId = str(body.sourceTenantId);
  if (!sourceEnv || !sourceTenantId) return fail("sourceEnv dan sourceTenantId wajib diisi");

  const staged = parseDomainStage(body.domains);
  if (!staged.ok) return fail(staged.error);
  const domains: ExportDomainBody[] = [];
  for (const { domain, raw, pathOverrides } of staged.stage) {
    const types = raw.configTypes;
    if (!Array.isArray(types) || types.length === 0) return fail("Pilih minimal satu config");
    if (!types.every((t: unknown) => typeof t === "string" && t.trim())) return fail("configTypes harus berisi teks");
    domains.push({ domain, configTypes: Array.from(new Set<string>(types.map((t: string) => t.trim()))), pathOverrides });
  }

  if (body.mode !== "timpa" && body.mode !== "lewati") return fail("mode harus 'timpa' atau 'lewati'");
  const mode: "timpa" | "lewati" = body.mode;
  const reason = parseReason(body.reason);
  if (!reason.ok) return fail(reason.error);

  const t = body.target;
  if (!isPlainObject(t)) return fail("target wajib diisi");
  if (t.kind === "profile") {
    const env = str(t.env), tenantId = str(t.tenantId);
    if (!env || !tenantId) return fail("target.env dan target.tenantId wajib diisi");
    return { ok: true, value: { sourceEnv, sourceTenantId, mode, reason: reason.value, target: { kind: "profile", env, tenantId }, domains } };
  }
  if (t.kind === "manual") {
    const tenantId = str(t.tenantId);
    if (tenantId !== "GLOBAL_DEFAULT" && !UUID_RE.test(tenantId)) return fail("Tenant ID tujuan harus berupa UUID atau GLOBAL_DEFAULT");
    const groupId = str(t.groupId);
    if (groupId && !UUID_RE.test(groupId)) return fail("Group ID tujuan harus berupa UUID");
    return {
      ok: true,
      value: { sourceEnv, sourceTenantId, mode, reason: reason.value, target: { kind: "manual", tenantId, ...(groupId ? { groupId } : {}) }, domains },
    };
  }
  return fail("target.kind harus 'profile' atau 'manual'");
}

router.post("/api/compare/export-sql", async (req, res) => {
  try {
    const parsed = parseExportBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { sourceEnv, sourceTenantId, mode, reason, target } = parsed.value;
    const domains = supportedDomains(req, parsed.value.domains, (d) => d.domain);
    if (!domains) return res.status(400).json({ error: noDomainError(req) });
    const envErr = await serviceEnvError(req, [sourceEnv, target.kind === "profile" ? target.env : PRODUCTION_MANUAL]);
    if (envErr) return res.status(409).json({ code: "SERVICE_UNAVAILABLE", error: envErr });
    const sp = findProfile(sourceEnv);
    if (!sp) return res.status(400).json({ error: `Env '${sourceEnv}' tidak dikenal` });

    const sourceMeta = await fetchTenantMeta(sourceEnv, sourceTenantId);
    if (!sourceMeta) return res.status(400).json({ error: `Tenant sumber belum terdaftar di env '${sourceEnv}'` });

    // Isi sumber tiap domain dibaca ulang saat request.
    const sources: Array<{ d: ExportDomainBody; D: DomainSpec; rowOf: Map<string, ConfigRow> }> = [];
    for (const d of domains) {
      const D = domainSpecFor(req.targetService!.key, d.domain)!;
      const srcRows = await fetchTenantRows(poolFor(sourceEnv, req.targetService!.key), D, sourceTenantId, d.configTypes);
      const byType = new Map<string, ConfigRow[]>();
      for (const r of srcRows) byType.set(r.config_type, [...(byType.get(r.config_type) ?? []), r]);
      const missing = d.configTypes.filter((c) => !byType.has(c));
      if (missing.length) return res.status(400).json({ error: `Config tidak ada di sumber: ${missing.join(", ")}` });
      const dupes = d.configTypes.filter((c) => (byType.get(c)?.length ?? 0) > 1);
      if (dupes.length) return res.status(400).json({ error: `Config berstatus ganda di sumber: ${dupes.join(", ")}` });
      sources.push({ d, D, rowOf: new Map(d.configTypes.map((c) => [c, byType.get(c)![0]])) });
    }

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
    // Tujuan global = NULL di SQL (tidak pernah literal 'GLOBAL_DEFAULT').
    const tenantIdForSql = isGlobal ? null : target.tenantId;
    const groupId = resolveGroupId(tenantIdForSql, groupInput);

    // Item per tabel: path akhir (override menang; hanya tenant_config) dan is_default (hanya diteruskan ke tujuan global).
    const sections: ExportSection[] = sources.map(({ d, D, rowOf }) => ({
      domain: { table: D.table, typeCol: D.typeCol, hasPath: D.hasPath },
      items: d.configTypes.map((c) => exportItemOf(rowOf.get(c)!, {
        hasPath: D.hasPath,
        override: Object.prototype.hasOwnProperty.call(d.pathOverrides, c) ? d.pathOverrides[c] : undefined,
        toGlobal: isGlobal,
      })),
    }));

    // ATS mencari config lewat path tanpa filter tenant: path akhir harus unik dalam pilihan dan tidak dipakai tenant lain
    // di tujuan. Tujuan profil dicek sekarang; file SQL tetap membawa penjaganya karena DB tujuan bisa berubah sebelum dijalankan.
    for (const s of sections.filter((x) => x.domain.hasPath)) {
      const items = s.items.map((it) => ({ configType: it.configType, path: it.path as string }));
      const dupes = duplicateFinalPaths(items);
      if (dupes.length) return res.status(400).json({ error: `Path ganda dalam pilihan: ${dupes.join(", ")}` });
      if (target.kind === "profile" && tenantIdForSql !== null) {
        const conflicts = await findPathConflicts(poolFor(target.env, req.targetService!.key), s.domain.table, items.map((i) => i.path), tenantIdForSql);
        if (conflicts.size) {
          const paths = [...conflicts.keys()].sort();
          return res.status(409).json({ code: "PATH_CONFLICT", error: pathConflictError(paths), paths });
        }
      }
    }

    // before_snapshot: hanya baca; gagal tidak menggagalkan export. Kunci `type` (satu domain) atau `domain:type` (dua domain).
    const multi = domains.length > 1;
    let beforeSnapshot: Record<string, { id: string; value: any; updated_at: string } | null> | null = null;
    let warning: string | null = null;
    if (snapshotEnv) {
      try {
        const snap: Record<string, { id: string; value: any; updated_at: string } | null> = {};
        for (const { d, D } of sources) {
          const tr = await fetchTenantRows(poolFor(snapshotEnv, req.targetService!.key), D, target.tenantId, d.configTypes);
          for (const c of d.configTypes) {
            const row = tr.find((r) => r.config_type === c);
            snap[typeKey(multi, d.domain, c)] = row ? { id: row.id, value: row.value, updated_at: row.version_token } : null;
          }
        }
        beforeSnapshot = snap;
      } catch {
        beforeSnapshot = null;
      }
    }
    if (!beforeSnapshot) warning = SNAPSHOT_WARNING;

    const now = new Date();
    const author = actorName(req);
    let sql: string;
    try {
      sql = buildExportSql({
        sections,
        mode,
        service: { label: req.targetService!.label, dbName: await serviceDbName(req, target.kind === "profile" ? target.env : PRODUCTION_MANUAL) },
        source: { env: sourceEnv, tenantCode: sourceMeta.code },
        target: { env: targetEnvLabel, tenantId: tenantIdForSql, groupId: groupInput, tenantCode: targetTenantCode },
        author,
        createdAt: now,
        reason,
      });
    } catch (e: any) {
      // Penjaga path menolak path bertanda `$$` (akan menutup badan DO lebih awal): masalah input, bukan galat server.
      return res.status(400).json({ error: e?.message ?? String(e) });
    }
    const fileName = exportFileName(targetTenantCode, sections.length > 1 ? "semua" : sections[0].domain.table, now);

    const shape = exportBatchShape(domains);
    const batchId = await createBatch({
        targetService: req.targetService!.key,
      kind: "export_sql",
      domain: shape.domain,
      sourceEnv,
      sourceTenantId,
      sourceTenantCode: sourceMeta.code,
      targetEnv: batchTargetEnv,
      targetTenantId: target.tenantId,
      targetGroupId: groupId,
      targetTenantCode,
      mode,
      configTypes: shape.configTypes,
      counts: shape.counts,
      status: "diekspor",
      author,
      note: reason,
      sqlText: sql,
      beforeSnapshot,
    });

    res.json({ data: { sql, fileName, batchId, beforeSnapshot: beforeSnapshot ? "tersimpan" : "tidak_tersedia", warning } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Salin: tulis config tenant sumber ke tenant tujuan di env X-Target-Env (cadangkan dulu), satu atau dua domain ----

export interface CopyDomainBody {
  domain: ConfigDomain;
  /** version_token (updated_at::text) tiap config tujuan saat dibandingkan; null = belum ada di tujuan */
  expectedTargetVersions: Record<string, string | null>;
  /** tipe config yang dipilih user sebagai "dibuat" / "ditimpa" */
  confirmedCreate: string[];
  confirmedOverwrite: string[];
  /** config_type → path tujuan pengganti (hanya tenant_config) */
  pathOverrides: Record<string, string>;
}

export interface CopyBody {
  sourceEnv: string;
  sourceTenantId: string;
  targetTenantId: string;
  reason: string;
  domains: CopyDomainBody[];
}

export function parseCopyBody(body: any): { ok: true; value: CopyBody } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (!isPlainObject(body)) return fail("Body permintaan tidak valid");
  const sourceEnv = str(body.sourceEnv), sourceTenantId = str(body.sourceTenantId), targetTenantId = str(body.targetTenantId);
  if (!sourceEnv || !sourceTenantId || !targetTenantId) return fail("sourceEnv, sourceTenantId, dan targetTenantId wajib diisi");
  if (targetTenantId === "GLOBAL_DEFAULT") return fail("GLOBAL_DEFAULT tidak bisa menjadi tujuan salin");

  // Tahap 1: domain dikenal, tidak dobel, pathOverrides.
  const staged = parseDomainStage(body.domains);
  if (!staged.ok) return fail(staged.error);

  const reason = parseReason(body.reason);
  if (!reason.ok) return fail(reason.error);

  // Tahap 2: versi tujuan yang diharapkan dan daftar yang dikonfirmasi, per domain.
  const strList = (name: string, v: unknown): string[] | string => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `${name} wajib berupa daftar teks`;
    return v as string[];
  };
  const domains: CopyDomainBody[] = [];
  for (const { domain, raw, pathOverrides } of staged.stage) {
    const ev = raw.expectedTargetVersions;
    if (!isPlainObject(ev)) return fail("expectedTargetVersions wajib berupa objek { config_type: versi | null }");
    const expectedTargetVersions: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(ev)) {
      if (v !== null && typeof v !== "string") return fail(`expectedTargetVersions.${k} harus teks atau null`);
      expectedTargetVersions[k] = v;
    }
    const confirmedCreate = strList("confirmedCreate", raw.confirmedCreate);
    if (typeof confirmedCreate === "string") return fail(confirmedCreate);
    const confirmedOverwrite = strList("confirmedOverwrite", raw.confirmedOverwrite);
    if (typeof confirmedOverwrite === "string") return fail(confirmedOverwrite);
    domains.push({ domain, expectedTargetVersions, confirmedCreate, confirmedOverwrite, pathOverrides });
  }
  return { ok: true, value: { sourceEnv, sourceTenantId, targetTenantId, reason: reason.value, domains } };
}

// GLOBAL_DEFAULT boleh belum terdaftar di tenant_metadata; kodenya "GLOBAL_DEFAULT".
async function tenantMetaOrGlobal(env: string, tenantId: string) {
  const m = await fetchTenantMeta(env, tenantId);
  if (m || tenantId !== "GLOBAL_DEFAULT") return m;
  return { tenantId, groupId: null, name: "GLOBAL_DEFAULT", code: "GLOBAL_DEFAULT", baseCode: "GLOBAL_DEFAULT" };
}

const PLAN_CHANGED_ERROR = "Rencana salin berubah sejak dikonfirmasi (sumber atau tujuan berubah). Muat ulang perbandingan.";
const TARGET_CHANGED_ERROR = "Config di tujuan berubah sejak dibandingkan. Muat ulang perbandingan.";

router.post("/api/compare/copy", async (req, res) => {
  let batchId: string | null = null;
  try {
    // Penjaga tulis paling awal: read-only → 403, dilindungi tanpa X-Confirm-Env yang cocok → 428.
    if (!assertWritable(req, res)) return;
    const targetEnv = req.targetEnv, targetDb = req.targetDb;
    if (!targetEnv || !targetDb) return res.status(400).json({ error: "Env tujuan (X-Target-Env) tidak diketahui" });

    const parsed = parseCopyBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { sourceEnv, sourceTenantId, targetTenantId, reason } = parsed.value;
    const domains = supportedDomains(req, parsed.value.domains, (d) => d.domain);
    if (!domains) return res.status(400).json({ error: noDomainError(req) });
    if (!findProfile(sourceEnv)) return res.status(400).json({ error: `Env '${sourceEnv}' tidak dikenal` });
    const envErr = await serviceEnvError(req, [sourceEnv]);
    if (envErr) return res.status(409).json({ code: "SERVICE_UNAVAILABLE", error: envErr });
    if (sourceEnv === targetEnv.name && sourceTenantId === targetTenantId) {
      return res.status(400).json({ error: "Sumber dan tujuan sama (env dan tenant). Pilih tujuan lain." });
    }

    const targetMeta = await tenantMetaOrGlobal(targetEnv.name, targetTenantId);
    if (!targetMeta) return res.status(400).json({ error: `Tenant tujuan belum terdaftar di env '${targetEnv.name}'` });
    const sourceMeta = await tenantMetaOrGlobal(sourceEnv, sourceTenantId);
    if (!sourceMeta) return res.status(400).json({ error: `Tenant sumber belum terdaftar di env '${sourceEnv}'` });

    // Isi sumber dan tujuan tiap domain dibaca ulang saat Salin ditekan (tabel menurut domain di body, bukan header).
    // Salah satu domain berubah atau tidak cocok → batal seluruhnya, belum ada batch/cadangan yang dibuat.
    const parts: CopyPart[] = [];
    // `domain:config_type` → path sumber, untuk baris baru yang path akhirnya berasal dari override
    const overriddenFrom = new Map<string, string | null>();
    for (const d of domains) {
      const D = domainSpecFor(req.targetService!.key, d.domain)!;
      const [srcRows, tgtRows] = await Promise.all([
        fetchTenantRows(poolFor(sourceEnv, req.targetService!.key), D, sourceTenantId),
        fetchTenantRows(targetDb, D, targetTenantId),
      ]);
      const fresh = planCopy(buildCompareEntries(srcRows, tgtRows).entries);
      // Yang dikonfirmasi user tidak lagi ada di kelompok yang sama pada rencana segar (sumber/tujuan berubah).
      const mismatch = selectionMismatch(fresh, d.confirmedCreate, d.confirmedOverwrite);
      if (mismatch.length) return res.status(409).json({ code: "TARGET_CHANGED", error: PLAN_CHANGED_ERROR, configTypes: mismatch });
      const selected = selectPlan(fresh, d.confirmedCreate, d.confirmedOverwrite);
      // Versi tujuan berbeda dari yang dilihat user, atau tipe terpilih tidak ada di expected.
      const stale = staleConfigTypes(selected, d.expectedTargetVersions, tgtRows);
      if (stale.length) return res.status(409).json({ code: "TARGET_CHANGED", error: TARGET_CHANGED_ERROR, configTypes: stale });
      // writeCopyTxMulti hanya memakai finalPath(source): override harus sudah menjadi `path` baris.
      const plan = applyPathOverrides(selected, d.pathOverrides);
      if (D.hasPath) {
        for (const [type, from] of overriddenSourcePaths(selected, d.pathOverrides)) overriddenFrom.set(`${d.domain}:${type}`, from);
      }
      parts.push({ domain: d.domain, table: { table: D.table, typeCol: D.typeCol, hasPath: D.hasPath }, plan });
    }

    if (parts.reduce((n, p) => n + p.plan.create.length + p.plan.overwrite.length, 0) === 0) {
      return res.status(400).json({ error: "Tidak ada config yang dipilih untuk disalin." });
    }

    // Path hanya ada di tenant_config. ATS mencari config lewat path tanpa filter tenant: path akhir harus unik
    // dalam pilihan dan tidak boleh dipakai tenant lain di tujuan. (Dicek lagi di dalam transaksi.)
    for (const part of parts.filter((p) => p.table.hasPath)) {
      const items = [...part.plan.create, ...part.plan.overwrite.map((o) => o.source)]
        .map((r) => ({ configType: r.config_type, path: finalPath(r) }));
      const dupes = duplicateFinalPaths(items);
      if (dupes.length) return res.status(400).json({ error: `Path ganda dalam pilihan: ${dupes.join(", ")}` });
      const conflicts = await findPathConflicts(targetDb, part.table.table, items.map((i) => i.path), targetTenantId);
      if (conflicts.size) {
        const paths = [...conflicts.keys()].sort();
        return res.status(409).json({ code: "PATH_CONFLICT", error: pathConflictError(paths), paths });
      }
    }

    const targetGroupId = resolveGroupId(targetTenantId, targetMeta.groupId);
    const author = actorName(req);
    const from = `${sourceEnv} · ${sourceMeta.code}`;
    const shape = batchShape(parts);

    const deps: CopyDeps = {
      createBatch: async () => {
        batchId = await createBatch({
        targetService: req.targetService!.key,
          kind: "salin",
          domain: shape.domain,
          sourceEnv,
          sourceTenantId,
          sourceTenantCode: sourceMeta.code,
          targetEnv: targetEnv.name,
          targetTenantId,
          targetGroupId,
          targetTenantCode: targetMeta.code,
          mode: "timpa",
          configTypes: shape.configTypes,
          counts: shape.counts,
          status: "menunggu",
          author,
          note: reason,
        });
        return batchId;
      },
      backupOld: async (o, part, id) => {
        const pathChange = part.table.hasPath ? { from: o.target.path, to: o.source.path } : undefined;
        const note = composeNote(reason, `Sebelum disalin dari ${from}`, autoSummary(o.target.value, o.source.value, pathChange));
        await snapshotBeforeChange(o.target, note, author, { env: targetEnv.name, service: req.targetService!.key }, id);
      },
      discardBatchBackups: discardBatchSnapshots,
      writeTarget: (ps) => writeCopyTxMulti(() => targetDb.connect(), ps, { tenantId: targetTenantId, groupId: targetGroupId }),
      recordCreated: async (row, id) => {
        const key = `${row.domain}:${row.config_type}`;
        const pathPart = overriddenFrom.has(key) ? `path: ${overriddenFrom.get(key) ?? "(kosong)"} → ${row.path}` : null;
        const note = composeNote(reason, `Disalin dari ${from}`, "Config baru", pathPart);
        await snapshotBeforeChange(row, note, author, { env: targetEnv.name, service: req.targetService!.key }, id);
      },
      finishBatch,
    };

    const result = await runCopy(parts, deps);
    res.json({
      data: {
        batchId: result.batchId,
        domains: parts.map(({ domain, plan }) => ({
          domain,
          created: plan.create.map((r) => r.config_type),
          overwritten: plan.overwrite.map((o) => o.source.config_type),
          skipped: { same: plan.same, targetOnly: plan.targetOnly, duplicates: plan.duplicates, unselected: plan.unselected },
        })),
        warnings: result.warnings,
      },
    });
  } catch (err: any) {
    const body: Record<string, unknown> = { error: err?.message ?? String(err), batchId };
    // Path bentrok terdeteksi di dalam transaksi (sudah di-ROLLBACK, tidak ada yang ditulis): UI memuat ulang pratinjau.
    if (err instanceof PathConflictError) return res.status(409).json({ ...body, code: err.code, paths: err.paths });
    // Tujuan berubah di tengah tulis (sudah di-ROLLBACK): UI bisa menawarkan muat ulang.
    // Constraint DB tujuan (FK tenant Organization, unique index workflow HRIS): transaksi sudah di-ROLLBACK.
    const pgMsg = pgErrorMessage(err, { serviceLabel: req.targetService?.label ?? "ATS" });
    if (pgMsg) return res.status(409).json({ ...body, code: "DB_CONSTRAINT", error: pgMsg });
    if (err instanceof TargetChangedError) Object.assign(body, { code: err.code, configTypes: [err.configType] });
    // COMMIT mungkin sudah masuk: cadangan isi lama tetap disimpan, user perlu memeriksa tujuan.
    if (isCommitUncertain(err)) body.commitUncertain = true;
    res.status(500).json(body);
  }
});

// ---- Riwayat batch Salin / Export SQL ----

router.get("/api/compare/batches", async (req, res) => {
  try {
    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string).trim() : "") || undefined;
    const limit = q("limit");
    const data = await listBatches({
      targetService: req.targetService!.key,
      sourceEnv: q("sourceEnv"),
      sourceTenantId: q("sourceTenantId"),
      targetEnv: q("targetEnv"),
      targetTenantId: q("targetTenantId"),
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/compare/batches/:id", async (req, res) => {
  try {
    const data = await getBatch(req.params.id);
    if (!data) return res.status(404).json({ error: "Batch tidak ditemukan" });
    res.json({ data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
