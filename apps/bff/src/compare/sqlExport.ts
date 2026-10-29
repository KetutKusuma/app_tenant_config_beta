import { esc } from "../db.js";

export interface ExportTable { table: string; typeCol: string; hasPath: boolean }
export interface ExportItem { configType: string; path: string | null; value: any; isDefault: boolean }
export interface ExportSqlInput {
  domain: ExportTable; mode: "timpa" | "lewati";
  source: { env: string; tenantCode: string };
  target: { env: string; tenantId: string | null; groupId: string | null; tenantCode: string };
  author: string; createdAt: Date; items: ExportItem[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Tenant kosong (null) = GLOBAL_DEFAULT; group mengikuti tenant bila kosong.
export function resolveGroupId(tenantId: string | null, groupId: string | null | undefined): string | null {
  if (tenantId === null) return null;
  return groupId || tenantId;
}

export function defaultPath(configType: string): string {
  return configType.toLowerCase().replace(/_/g, "-");
}

export function exportFileName(tenantCode: string, table: string, date: Date): string {
  return `${tenantCode}_${table.replace(/^public\./, "")}_${ymd(date)}.sql`;
}

function itemSql(input: ExportSqlInput, item: ExportItem): string {
  const { domain, mode, target } = input;
  const { table, typeCol, hasPath } = domain;
  const tenantCond = target.tenantId === null ? "tenant_id IS NULL" : `tenant_id = ${esc(target.tenantId)}`;
  const where = `${tenantCond} AND ${typeCol} = ${esc(item.configType)} AND deleted_at IS NULL`;
  const json = esc(JSON.stringify(item.value)) + "::jsonb";
  const path = esc(item.path || defaultPath(item.configType));
  const out: string[] = [];

  if (mode === "timpa") {
    out.push(`UPDATE ${table}\nSET value = ${json},${hasPath ? ` path = ${path},` : ""} updated_at = NOW()\nWHERE ${where};`);
  }
  const cols = ["id", "tenant_id", "group_id", typeCol, ...(hasPath ? ["path"] : []), "value", "is_default", "created_at", "updated_at"];
  const vals = ["gen_random_uuid()", esc(target.tenantId), esc(target.groupId), esc(item.configType), ...(hasPath ? [path] : []), json, esc(item.isDefault), "NOW()", "NOW()"];
  out.push(`INSERT INTO ${table} (${cols.join(", ")})\nSELECT ${vals.join(", ")}\nWHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${where});`);
  return out.join("\n");
}

export function buildExportSql(input: ExportSqlInput): string {
  const { domain, mode, source, target, author, createdAt, items } = input;
  const n = items.length;
  const stamp = `${ymd(createdAt)} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`;
  const header = [
    "-- Tenant Studio · Export SQL",
    "-- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.",
    `-- Tabel   : ${domain.table}`,
    `-- Sumber  : ${source.env} · ${source.tenantCode}`,
    `-- Tujuan  : ${target.env} · ${target.tenantCode} · tenant_id ${target.tenantId ?? "NULL"} · group_id ${target.groupId ?? "NULL"}`,
    `-- Dibuat  : ${stamp} oleh ${author} · ${n} config · jika sudah ada: ${mode}`,
  ].join("\n");
  const blocks = items.map((it, i) => `-- [${i + 1}/${n}] ${it.configType}\n${itemSql(input, it)}`);
  return `${header}\n\nBEGIN;\n\n${blocks.join("\n\n")}${n ? "\n\n" : ""}COMMIT;\n`;
}
