import { extraInsert } from "../configRows";
import { randomUUID } from "crypto";
import { esc } from "../db";
import type { ConfigDomain } from "../domain";
import { finalPath, findPathConflicts } from "./pathConflicts";
import type { CompareEntry, ConfigRow } from "./types";

export interface CopyPlan {
  create: ConfigRow[];
  overwrite: Array<{ source: ConfigRow; target: ConfigRow }>;
  same: string[];
  targetOnly: string[];
  duplicates: string[];
  /** create/overwrite yang tidak dipilih user (diisi `selectPlan`); tidak ditulis */
  unselected: string[];
}

export interface CopyTable {
  table: string; typeCol: string; hasPath: boolean;
  extraCopyCols?: string[]; extraInsertDefaults?: Record<string, string>; groupIdFromSource?: boolean;
}
/** Satu tabel yang disalin: domain + tabelnya + rencana salin untuk tabel itu. */
export interface CopyPart { domain: ConfigDomain; table: CopyTable; plan: CopyPlan }
/** Baris baru hasil salin, ditandai dari domain/tabel mana asalnya. */
export type CreatedRow = ConfigRow & { domain: ConfigDomain };

export function planCopy(entries: CompareEntry[]): CopyPlan {
  const plan: CopyPlan = { create: [], overwrite: [], same: [], targetOnly: [], duplicates: [], unselected: [] };
  for (const e of entries) {
    if (e.status === "hanya_kiri" && e.left) plan.create.push(e.left);
    else if (e.status === "beda" && e.left && e.right) plan.overwrite.push({ source: e.left, target: e.right });
    else if (e.status === "sama") plan.same.push(e.configType);
    else if (e.status === "hanya_kanan") plan.targetOnly.push(e.configType);
    else if (e.status === "ganda") plan.duplicates.push(e.configType);
  }
  return plan;
}

// Tipe yang akan ditulis tetapi tidak ada di expected = tidak pernah dilihat user saat konfirmasi → stale.
// null eksplisit = "diharapkan belum ada di tujuan".
export function staleConfigTypes(plan: CopyPlan, expected: Record<string, string | null>, currentTarget: ConfigRow[]): string[] {
  const types = [...plan.create.map((r) => r.config_type), ...plan.overwrite.map((o) => o.source.config_type)];
  const stale = new Set<string>();
  for (const type of types) {
    if (!Object.prototype.hasOwnProperty.call(expected, type)) {
      stale.add(type);
      continue;
    }
    const current = currentTarget.find((r) => r.config_type === type)?.version_token ?? null;
    if (current !== (expected[type] ?? null)) stale.add(type);
  }
  return [...stale].sort();
}

/** Hanya create/overwrite yang dikonfirmasi user yang dipertahankan; sisanya pindah ke `unselected` (terurut). */
export function selectPlan(plan: CopyPlan, confirmedCreate: string[], confirmedOverwrite: string[]): CopyPlan {
  const create = new Set(confirmedCreate), overwrite = new Set(confirmedOverwrite);
  const unselected = new Set(plan.unselected);
  const keptCreate = plan.create.filter((r) => {
    if (create.has(r.config_type)) return true;
    unselected.add(r.config_type);
    return false;
  });
  const keptOverwrite = plan.overwrite.filter((o) => {
    if (overwrite.has(o.source.config_type)) return true;
    unselected.add(o.source.config_type);
    return false;
  });
  return { ...plan, create: keptCreate, overwrite: keptOverwrite, unselected: [...unselected].sort() };
}

/**
 * Tipe yang dikonfirmasi user tetapi tidak ada di kelompok yang sama pada rencana segar (mis. sudah berubah
 * menjadi sama, hilang, atau pindah dibuat ↔ ditimpa). Memilih sebagian dari rencana segar tidak dianggap beda.
 */
export function selectionMismatch(plan: CopyPlan, confirmedCreate: string[], confirmedOverwrite: string[]): string[] {
  const create = new Set(plan.create.map((r) => r.config_type));
  const overwrite = new Set(plan.overwrite.map((o) => o.source.config_type));
  return [...new Set([
    ...confirmedCreate.filter((t) => !create.has(t)),
    ...confirmedOverwrite.filter((t) => !overwrite.has(t)),
  ])].sort();
}

/** `path` baris sumber (create dan overwrite.source) diganti path akhirnya; objek asli tidak diubah. */
export function applyPathOverrides(plan: CopyPlan, overrides: Record<string, string>): CopyPlan {
  const withPath = (r: ConfigRow): ConfigRow => ({
    ...r,
    path: finalPath(r, Object.prototype.hasOwnProperty.call(overrides, r.config_type) ? overrides[r.config_type] : undefined),
  });
  return {
    ...plan,
    create: plan.create.map(withPath),
    overwrite: plan.overwrite.map((o) => ({ source: withPath(o.source), target: o.target })),
  };
}

/**
 * Baris yang akan dibuat dan path akhirnya berasal dari override (bukan path sumber) → path sumbernya (null = kosong).
 * Dipakai untuk bagian "path: <sumber> → <akhir>" di catatan versi 1. Override kosong atau sama dengan path sumber diabaikan.
 * Pakai plan sebelum `applyPathOverrides`.
 */
export function overriddenSourcePaths(selected: CopyPlan, overrides: Record<string, string>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of selected.create) {
    const o = Object.prototype.hasOwnProperty.call(overrides, r.config_type) ? overrides[r.config_type].trim() : "";
    if (o && o !== r.path) out.set(r.config_type, r.path);
  }
  return out;
}

const countsOf = (plan: CopyPlan) => ({
  dibuat: plan.create.length,
  ditimpa: plan.overwrite.length,
  sama: plan.same.length,
  hanyaTujuan: plan.targetOnly.length,
  ganda: plan.duplicates.length,
  tidakDipilih: plan.unselected.length,
});

/**
 * Bentuk baris batch riwayat dari part yang akan ditulis: satu domain → kuncinya; dua domain → "semua", tipe
 * berawalan `domain:` (terurut), dan counts datar (total) ditambah `perDomain`.
 */
export function batchShape(parts: CopyPart[]): { domain: string; configTypes: string[]; counts: Record<string, unknown> } {
  const multi = parts.length > 1;
  const configTypes = parts.flatMap(({ domain, plan }) =>
    [...plan.create.map((r) => r.config_type), ...plan.overwrite.map((o) => o.source.config_type)]
      .map((t) => (multi ? `${domain}:${t}` : t)),
  ).sort();
  const per = parts.map(({ domain, plan }) => [domain, countsOf(plan)] as const);
  const total = { dibuat: 0, ditimpa: 0, sama: 0, hanyaTujuan: 0, ganda: 0, tidakDipilih: 0 };
  for (const [, c] of per) for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += c[k];
  return {
    domain: multi ? "semua" : parts[0].domain,
    configTypes,
    counts: multi ? { ...total, perDomain: Object.fromEntries(per) } : total,
  };
}

export interface CopyDeps {
  createBatch(): Promise<string>;
  backupOld(o: { source: ConfigRow; target: ConfigRow }, part: CopyPart, batchId: string): Promise<void>;
  discardBatchBackups(batchId: string): Promise<void>;
  writeTarget(parts: CopyPart[]): Promise<CreatedRow[]>;
  recordCreated(row: CreatedRow, batchId: string): Promise<void>;
  finishBatch(batchId: string, status: "berhasil" | "gagal", error?: string): Promise<void>;
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const COMMIT_UNCERTAIN_MESSAGE = "Hasil COMMIT tidak pasti; periksa tujuan. Cadangan isi lama tetap disimpan.";

/** Statement COMMIT melempar: transaksi mungkin sudah tersimpan di server, jadi cadangan isi lama tidak boleh dibuang. */
export class CommitUncertainError extends Error {
  readonly commitUncertain = true as const;
  constructor(cause: unknown) {
    super(`Hasil COMMIT tidak pasti, periksa tujuan: ${msgOf(cause)}`, { cause });
    this.name = "CommitUncertainError";
  }
}
export function isCommitUncertain(e: unknown): boolean {
  return (e as { commitUncertain?: unknown } | null)?.commitUncertain === true;
}

/** UPDATE/INSERT kena 0 baris: tujuan berubah di tengah salin (transaksi di-ROLLBACK). */
export class TargetChangedError extends Error {
  readonly code = "TARGET_CHANGED" as const;
  constructor(message: string, readonly configType: string) {
    super(message);
    this.name = "TargetChangedError";
  }
}

/** Path hasil salin sudah dipakai tenant lain di DB tujuan (transaksi di-ROLLBACK, tidak ada yang ditulis). */
export class PathConflictError extends Error {
  readonly code = "PATH_CONFLICT" as const;
  constructor(message: string, readonly paths: string[]) {
    super(message);
    this.name = "PathConflictError";
  }
}

export async function runCopy(parts: CopyPart[], deps: CopyDeps): Promise<{ batchId: string; warnings: string[] }> {
  const batchId = await deps.createBatch();

  const fail = async (err: unknown): Promise<never> => {
    try { await deps.discardBatchBackups(batchId); } catch (e) { console.error("discardBatchBackups gagal:", e); }
    try { await deps.finishBatch(batchId, "gagal", msgOf(err)); } catch (e) { console.error("finishBatch gagal:", e); }
    throw err;
  };

  try {
    for (const part of parts) for (const o of part.plan.overwrite) await deps.backupOld(o, part, batchId);
  } catch (e) {
    return fail(e);
  }

  let created: CreatedRow[];
  try {
    created = await deps.writeTarget(parts);
  } catch (e) {
    if (!isCommitUncertain(e)) return fail(e);
    // COMMIT mungkin sudah masuk: cadangan isi lama TIDAK dibuang.
    try { await deps.finishBatch(batchId, "gagal", COMMIT_UNCERTAIN_MESSAGE); } catch (fe) { console.error("finishBatch gagal:", fe); }
    throw e;
  }

  const warnings: string[] = [];
  for (const row of created) {
    try {
      await deps.recordCreated(row, batchId);
    } catch (e) {
      warnings.push(`Versi 1 ${row.config_type} tidak tercatat di History: ${msgOf(e)}`);
    }
  }
  // Tujuan sudah ditulis: gagal memperbarui status batch tidak boleh membuat salin dianggap gagal.
  try {
    await deps.finishBatch(batchId, "berhasil");
  } catch (e) {
    console.error("finishBatch gagal:", e);
    warnings.push(`Status batch tidak diperbarui: ${msgOf(e)}`);
  }
  return { batchId, warnings };
}

// ---- Tulis ke DB tujuan dalam satu transaksi (dipakai sebagai CopyDeps.writeTarget) ----

export interface TxClient {
  query(sql: string): Promise<{ rowCount: number | null; rows: any[] }>;
  release(err?: Error | boolean): void;
}
/** tenantId null = GLOBAL_DEFAULT (tenant_id IS NULL di DB tujuan) */
export interface CopyTarget { tenantId: string | null; groupId: string | null }

const jsonb = (v: any) => `${esc(JSON.stringify(v))}::jsonb`;

// Urutan pengambilan advisory lock: sama untuk semua Salin, apa pun urutan `parts`, supaya dua Salin
// bersamaan ke tenant yang sama tidak saling menunggu (deadlock).
const LOCK_ORDER = ["public.tenant_configurations", "public.pipeline_workflow_configurations"];
const lockRank = (table: string) => {
  const i = LOCK_ORDER.indexOf(table);
  return i === -1 ? LOCK_ORDER.length : i;
};

/**
 * Semua UPDATE + INSERT dari semua `parts` dalam satu transaksi: berhasil semua atau tidak ada yang tertulis.
 * Advisory lock per (tabel, tenant tujuan) menyerialkan Salin ke tenant yang sama, sehingga NOT EXISTS pada INSERT
 * dan cek path melihat baris yang di-commit Salin lain. Untuk tabel ber-path, path akhir (create + overwrite)
 * dicek terhadap tenant lain di dalam transaksi (`findPathConflicts`); ada yang bentrok → PathConflictError → ROLLBACK.
 * Cek ini dilewati bila tujuan GLOBAL_DEFAULT (tenantId null): salin ke sana tidak dipakai lagi oleh jalur baru.
 * UPDATE dikunci versi (updated_at::text); INSERT dilewati bila config sudah ada. Keduanya 0 baris →
 * TargetChangedError → ROLLBACK. Error dari statement COMMIT → CommitUncertainError.
 * Baris baru selalu `is_default = false`. Mengembalikan baris baru (id baru) agar versi 1-nya bisa dicatat di History.
 */
export async function writeCopyTxMulti(
  connect: () => Promise<TxClient>,
  parts: CopyPart[],
  target: CopyTarget,
  newId: () => string = randomUUID
): Promise<CreatedRow[]> {
  const tenantCond = target.tenantId === null ? "tenant_id IS NULL" : `tenant_id = ${esc(target.tenantId)}`;
  const lockOrder = [...parts].sort((a, b) => lockRank(a.table.table) - lockRank(b.table.table) || a.table.table.localeCompare(b.table.table));
  const client = await connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    for (const { table: t } of lockOrder) {
      const lockKey = `${t.table}:${target.tenantId ?? "GLOBAL_DEFAULT"}`;
      await client.query(`SELECT pg_advisory_xact_lock(hashtext(${esc(lockKey)}));`);
    }
    // esc() hanya menggandakan kutip: pastikan backslash tidak diperlakukan sebagai escape.
    await client.query("SET LOCAL standard_conforming_strings = on;");
    await client.query("SET LOCAL lock_timeout = '5s';");

    if (target.tenantId !== null) {
      const conflicts = new Set<string>();
      for (const { table: t, plan } of lockOrder) {
        if (!t.hasPath) continue;
        const paths = [...plan.create, ...plan.overwrite.map((o) => o.source)].map((r) => finalPath(r));
        for (const path of (await findPathConflicts(client, t.table, paths, target.tenantId)).keys()) conflicts.add(path);
      }
      if (conflicts.size > 0) {
        const paths = [...conflicts].sort();
        throw new PathConflictError(`Path sudah dipakai tenant lain di tujuan: ${paths.join(", ")}. Tidak ada yang ditulis.`, paths);
      }
    }

    const created: CreatedRow[] = [];
    for (const { domain, table: t, plan } of parts) {
      for (const { source, target: old } of plan.overwrite) {
        const pathSet = t.hasPath ? `, path = ${esc(finalPath(source))}` : "";
        const r = await client.query(`
          UPDATE ${t.table}
          SET value = ${jsonb(source.value)}${pathSet}, updated_at = NOW()
          WHERE id = ${esc(old.id)} AND updated_at::text = ${esc(old.version_token)} AND deleted_at IS NULL;
        `);
        if (r.rowCount !== 1) {
          throw new TargetChangedError(`Config ${source.config_type} di tujuan berubah saat proses salin. Tidak ada yang ditulis. Muat ulang perbandingan.`, source.config_type);
        }
      }

      for (const source of plan.create) {
        const id = newId();
        const path = t.hasPath ? finalPath(source) : null;
        const groupId = t.groupIdFromSource ? source.group_id : target.groupId;
        const extra = extraInsert(t, source.extra);
        const cols = ["id", "tenant_id", "group_id", t.typeCol, ...(t.hasPath ? ["path"] : []), "value", "is_default", "created_at", "updated_at", ...extra.cols];
        const vals = [esc(id), esc(target.tenantId), esc(groupId), esc(source.config_type), ...(t.hasPath ? [esc(path)] : []), jsonb(source.value), "false", "NOW()", "NOW()", ...extra.vals];
        const r = await client.query(`
          INSERT INTO ${t.table} (${cols.join(", ")})
          SELECT ${vals.join(", ")}
          WHERE NOT EXISTS (SELECT 1 FROM ${t.table} WHERE ${tenantCond} AND ${t.typeCol} = ${esc(source.config_type)} AND deleted_at IS NULL)
          RETURNING updated_at::text AS version_token;
        `);
        if (r.rowCount !== 1) {
          throw new TargetChangedError(`Config ${source.config_type} sudah ada di tujuan (dibuat saat proses salin). Tidak ada yang ditulis. Muat ulang perbandingan.`, source.config_type);
        }
        created.push({
          id, tenant_id: target.tenantId, group_id: groupId, config_type: source.config_type, path,
          value: source.value, is_default: false, version_token: String(r.rows[0].version_token), domain,
        });
      }
    }

    try {
      await client.query("COMMIT");
    } catch (commitErr) {
      throw new CommitUncertainError(commitErr);
    }
    return created;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr) {
      // Status transaksi tidak pasti: koneksi dibuang, jangan dikembalikan ke pool.
      console.error("ROLLBACK gagal:", rbErr);
      broken = rbErr instanceof Error ? rbErr : new Error(String(rbErr));
    }
    throw err;
  } finally {
    client.release(broken);
  }
}
