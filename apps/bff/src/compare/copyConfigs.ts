import { randomUUID } from "crypto";
import { esc } from "../db";
import { defaultPath } from "./sqlExport";
import type { CompareEntry, ConfigRow } from "./types";

export interface CopyPlan {
  create: ConfigRow[];
  overwrite: Array<{ source: ConfigRow; target: ConfigRow }>;
  same: string[];
  targetOnly: string[];
  duplicates: string[];
}

export function planCopy(entries: CompareEntry[]): CopyPlan {
  const plan: CopyPlan = { create: [], overwrite: [], same: [], targetOnly: [], duplicates: [] };
  for (const e of entries) {
    if (e.status === "hanya_kiri" && e.left) plan.create.push(e.left);
    else if (e.status === "beda" && e.left && e.right) plan.overwrite.push({ source: e.left, target: e.right });
    else if (e.status === "sama") plan.same.push(e.configType);
    else if (e.status === "hanya_kanan") plan.targetOnly.push(e.configType);
    else if (e.status === "ganda") plan.duplicates.push(e.configType);
  }
  return plan;
}

export function staleConfigTypes(plan: CopyPlan, expected: Record<string, string | null>, currentTarget: ConfigRow[]): string[] {
  const types = [...plan.create.map((r) => r.config_type), ...plan.overwrite.map((o) => o.source.config_type)];
  const stale = new Set<string>();
  for (const type of types) {
    const current = currentTarget.find((r) => r.config_type === type)?.version_token ?? null;
    if (current !== (expected[type] ?? null)) stale.add(type);
  }
  return [...stale].sort();
}

export interface CopyDeps {
  createBatch(): Promise<string>;
  backupOld(target: ConfigRow, batchId: string): Promise<void>;
  discardBatchBackups(batchId: string): Promise<void>;
  writeTarget(plan: CopyPlan): Promise<ConfigRow[]>;
  recordCreated(row: ConfigRow, batchId: string): Promise<void>;
  finishBatch(batchId: string, status: "berhasil" | "gagal", error?: string): Promise<void>;
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runCopy(plan: CopyPlan, deps: CopyDeps): Promise<{ batchId: string; warnings: string[] }> {
  const batchId = await deps.createBatch();

  const fail = async (err: unknown): Promise<never> => {
    try { await deps.discardBatchBackups(batchId); } catch (e) { console.error("discardBatchBackups gagal:", e); }
    try { await deps.finishBatch(batchId, "gagal", msgOf(err)); } catch (e) { console.error("finishBatch gagal:", e); }
    throw err;
  };

  try {
    for (const o of plan.overwrite) await deps.backupOld(o.target, batchId);
  } catch (e) {
    return fail(e);
  }

  let created: ConfigRow[];
  try {
    created = await deps.writeTarget(plan);
  } catch (e) {
    return fail(e);
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
export interface CopyTable { table: string; typeCol: string; hasPath: boolean }
/** tenantId null = GLOBAL_DEFAULT (tenant_id IS NULL di DB tujuan) */
export interface CopyTarget { tenantId: string | null; groupId: string | null }

const jsonb = (v: any) => `${esc(JSON.stringify(v))}::jsonb`;

/**
 * Semua UPDATE + INSERT dalam satu transaksi: berhasil semua atau tidak ada yang tertulis.
 * UPDATE dikunci versi (updated_at::text); INSERT dilewati bila config sudah ada. Keduanya 0 baris → throw → ROLLBACK.
 * Mengembalikan baris baru (id baru) agar versi 1-nya bisa dicatat di History.
 */
export async function writeCopyTx(
  connect: () => Promise<TxClient>,
  t: CopyTable,
  plan: CopyPlan,
  target: CopyTarget,
  newId: () => string = randomUUID
): Promise<ConfigRow[]> {
  const tenantCond = target.tenantId === null ? "tenant_id IS NULL" : `tenant_id = ${esc(target.tenantId)}`;
  const client = await connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");

    for (const { source, target: old } of plan.overwrite) {
      const pathSet = t.hasPath ? `, path = ${esc(source.path || defaultPath(source.config_type))}` : "";
      const r = await client.query(`
        UPDATE ${t.table}
        SET value = ${jsonb(source.value)}${pathSet}, updated_at = NOW()
        WHERE id = ${esc(old.id)} AND updated_at::text = ${esc(old.version_token)} AND deleted_at IS NULL;
      `);
      if (r.rowCount !== 1) {
        throw new Error(`Config ${source.config_type} di tujuan berubah saat proses salin. Tidak ada yang ditulis. Muat ulang perbandingan.`);
      }
    }

    const created: ConfigRow[] = [];
    for (const source of plan.create) {
      const id = newId();
      const path = t.hasPath ? source.path || defaultPath(source.config_type) : null;
      const isDefault = !!source.is_default;
      const cols = ["id", "tenant_id", "group_id", t.typeCol, ...(t.hasPath ? ["path"] : []), "value", "is_default", "created_at", "updated_at"];
      const vals = [esc(id), esc(target.tenantId), esc(target.groupId), esc(source.config_type), ...(t.hasPath ? [esc(path)] : []), jsonb(source.value), esc(isDefault), "NOW()", "NOW()"];
      const r = await client.query(`
        INSERT INTO ${t.table} (${cols.join(", ")})
        SELECT ${vals.join(", ")}
        WHERE NOT EXISTS (SELECT 1 FROM ${t.table} WHERE ${tenantCond} AND ${t.typeCol} = ${esc(source.config_type)} AND deleted_at IS NULL)
        RETURNING updated_at::text AS version_token;
      `);
      if (r.rowCount !== 1) {
        throw new Error(`Config ${source.config_type} sudah ada di tujuan (dibuat saat proses salin). Tidak ada yang ditulis. Muat ulang perbandingan.`);
      }
      created.push({
        id, tenant_id: target.tenantId, group_id: target.groupId, config_type: source.config_type, path,
        value: source.value, is_default: isDefault, version_token: String(r.rows[0].version_token),
      });
    }

    await client.query("COMMIT");
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
