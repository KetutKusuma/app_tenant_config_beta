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
export function resolveGroupId(tenantId: string | null | undefined, groupId: string | null | undefined): string | null {
  if (tenantId === null || tenantId === undefined) return null;
  const g = (groupId ?? "").trim();
  return g || tenantId;
}

// Tenant kosong / "GLOBAL_DEFAULT" = global (NULL), jangan pernah jadi "= NULL".
function normTenantId(id: string | null | undefined): string | null {
  if (id === null || id === undefined || id === "" || id === "GLOBAL_DEFAULT") return null;
  return id;
}

// Nilai di baris komentar "--" tidak boleh memuat baris baru.
const oneLine = (s: unknown) => String(s).replace(/[\r\n]+/g, " ");

export function defaultPath(configType: string): string {
  return configType.toLowerCase().replace(/_/g, "-");
}

export function exportFileName(tenantCode: string, table: string, date: Date): string {
  return `${tenantCode.replace(/[^A-Za-z0-9_-]/g, "_")}_${table.replace(/^public\./, "")}_${ymd(date)}.sql`;
}

function itemSql(input: ExportSqlInput, item: ExportItem, tenantId: string | null, groupId: string | null): string {
  const { domain, mode } = input;
  const { table, typeCol, hasPath } = domain;
  const tenantCond = tenantId === null ? "tenant_id IS NULL" : `tenant_id = ${esc(tenantId)}`;
  const where = `${tenantCond} AND ${typeCol} = ${esc(item.configType)} AND deleted_at IS NULL`;
  const json = esc(JSON.stringify(item.value)) + "::jsonb";
  const path = esc(item.path || defaultPath(item.configType));
  const out: string[] = [];

  if (mode === "timpa") {
    out.push(`UPDATE ${table}\nSET value = ${json},${hasPath ? ` path = ${path},` : ""} updated_at = NOW()\nWHERE ${where};`);
  }
  const cols = ["id", "tenant_id", "group_id", typeCol, ...(hasPath ? ["path"] : []), "value", "is_default", "created_at", "updated_at"];
  const vals = ["gen_random_uuid()", esc(tenantId), esc(groupId), esc(item.configType), ...(hasPath ? [path] : []), json, esc(item.isDefault), "NOW()", "NOW()"];
  out.push(`INSERT INTO ${table} (${cols.join(", ")})\nSELECT ${vals.join(", ")}\nWHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${where});`);
  return out.join("\n");
}

export function buildExportSql(input: ExportSqlInput): string {
  const { domain, mode, source, target, author, createdAt, items } = input;
  const tenantId = normTenantId(target.tenantId);
  const groupId = resolveGroupId(tenantId, target.groupId);
  const n = items.length;
  const stamp = `${ymd(createdAt)} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`;
  const header = [
    "-- Tenant Studio · Export SQL",
    "-- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.",
    `-- Tabel   : ${oneLine(domain.table)}`,
    `-- Sumber  : ${oneLine(source.env)} · ${oneLine(source.tenantCode)}`,
    `-- Tujuan  : ${oneLine(target.env)} · ${oneLine(target.tenantCode)} · tenant_id ${oneLine(tenantId ?? "NULL")} · group_id ${oneLine(groupId ?? "NULL")}`,
    `-- Dibuat  : ${stamp} oleh ${oneLine(author)} · ${n} config · jika sudah ada: ${oneLine(mode)}`,
  ].join("\n");
  const blocks = items.map((it, i) => `-- [${i + 1}/${n}] ${oneLine(it.configType)}\n${itemSql(input, it, tenantId, groupId)}`);
  return `${header}\n\nBEGIN;\nSET LOCAL standard_conforming_strings = on;\n\n${blocks.join("\n\n")}${n ? "\n\n" : ""}COMMIT;\n`;
}
