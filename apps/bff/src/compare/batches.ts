import { auditDb, esc } from "../db";

// Akses data tenant_studio.config_change_batches: satu baris per Salin atau Export SQL.

export type BatchKind = "salin" | "export_sql";
export type BatchStatus = "menunggu" | "berhasil" | "gagal" | "diekspor";

export interface NewBatch {
  kind: BatchKind;
  domain: string;
  sourceEnv: string;
  sourceTenantId: string;
  sourceTenantCode: string;
  targetEnv: string;
  targetTenantId: string;
  targetGroupId: string | null;
  targetTenantCode: string;
  mode: "timpa" | "lewati";
  configTypes: string[];
  counts: Record<string, number>;
  status: BatchStatus;
  author: string;
  sqlText?: string;
  beforeSnapshot?: any | null;
}

function jsonSql(v: any): string {
  return v === null || v === undefined ? "NULL" : `${esc(JSON.stringify(v))}::jsonb`;
}

export async function createBatch(b: NewBatch): Promise<string> {
  const types = b.configTypes.length ? "ARRAY[" + b.configTypes.map((t) => esc(t)).join(",") + "]::text[]" : "'{}'::text[]";
  const r = await auditDb.query(`
    INSERT INTO tenant_studio.config_change_batches
    (kind, domain, source_env, source_tenant_id, source_tenant_code, target_env, target_tenant_id, target_group_id,
     target_tenant_code, mode, config_types, counts, status, sql_text, before_snapshot, author_name)
    VALUES (
      ${esc(b.kind)}, ${esc(b.domain)}, ${esc(b.sourceEnv)}, ${esc(b.sourceTenantId)}, ${esc(b.sourceTenantCode)},
      ${esc(b.targetEnv)}, ${esc(b.targetTenantId)}, ${esc(b.targetGroupId)}, ${esc(b.targetTenantCode)},
      ${esc(b.mode)}, ${types}, ${jsonSql(b.counts)}, ${esc(b.status)}, ${esc(b.sqlText ?? null)},
      ${jsonSql(b.beforeSnapshot)}, ${esc(b.author)}
    )
    RETURNING id;
  `);
  return String(r.rows[0].id);
}

export async function finishBatch(id: string, status: "berhasil" | "gagal", error?: string): Promise<void> {
  await auditDb.query(`
    UPDATE tenant_studio.config_change_batches
    SET status = ${esc(status)}, error = ${esc(error ?? null)}, finished_at = now()
    WHERE id = ${esc(id)};
  `);
}

export interface BatchFilter {
  sourceEnv?: string;
  sourceTenantId?: string;
  targetEnv?: string;
  targetTenantId?: string;
  limit?: number;
}

// Tanpa sql_text dan before_snapshot (besar); ambil lewat getBatch.
const LIST_COLUMNS = `id, kind, domain, source_env, source_tenant_id, source_tenant_code, target_env, target_tenant_id,
  target_group_id, target_tenant_code, mode, config_types, counts, status, error, author_name, created_at, finished_at`;

export async function listBatches(f: BatchFilter): Promise<any[]> {
  const where: string[] = [];
  if (f.sourceEnv) where.push(`source_env = ${esc(f.sourceEnv)}`);
  if (f.sourceTenantId) where.push(`source_tenant_id = ${esc(f.sourceTenantId)}`);
  if (f.targetEnv) where.push(`target_env = ${esc(f.targetEnv)}`);
  if (f.targetTenantId) where.push(`target_tenant_id = ${esc(f.targetTenantId)}`);
  const n = Number(f.limit);
  const limit = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 200) : 50;
  const r = await auditDb.query(`
    SELECT ${LIST_COLUMNS} FROM tenant_studio.config_change_batches
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC
    LIMIT ${limit};
  `);
  return r.rows;
}

export async function getBatch(id: string): Promise<any | null> {
  // id bukan uuid valid akan membuat cast gagal; perlakukan sebagai tidak ditemukan
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const r = await auditDb.query(`SELECT * FROM tenant_studio.config_change_batches WHERE id = ${esc(id)};`);
  return r.rows[0] ?? null;
}
