import { extraInsert } from "../configRows";
import { esc } from "../db.js";
import type { ConfigDomain } from "../domain.js";
import { finalPath, pathGuardSql } from "./pathConflicts.js";
import type { ConfigRow } from "./types.js";

export interface ExportTable {
  table: string; typeCol: string; hasPath: boolean;
  idType?: "uuid" | "varchar"; extraCopyCols?: string[]; extraInsertDefaults?: Record<string, string>; groupIdFromSource?: boolean;
}
/** `path` sudah final (override sudah dipakai); kosong dipulihkan dari config_type oleh builder. */
export interface ExportItem {
  configType: string; path: string | null; value: any; isDefault: boolean;
  /** Kolom ekstra baris sumber (type, is_active) */
  extra?: Record<string, unknown>;
  /** group_id baris sumber; dipakai bila tabel groupIdFromSource */
  groupId?: string | null;
}
/** Satu tabel di file export: tabelnya dan config yang ditulis ke tabel itu. */
export interface ExportSection { domain: ExportTable; items: ExportItem[] }
export interface ExportSqlInput {
  sections: ExportSection[]; mode: "timpa" | "lewati";
  source: { env: string; tenantCode: string };
  target: { env: string; tenantId: string | null; groupId: string | null; tenantCode: string };
  author: string; createdAt: Date; reason: string;
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

/**
 * Item export dari baris sumber. Path akhir: override (di-trim) menang, lalu path sumber, lalu turunan config_type;
 * `null` untuk tabel tanpa kolom path. `is_default` hanya diteruskan ke tujuan global; selain itu selalu false.
 */
export function exportItemOf(row: ConfigRow, opts: { hasPath: boolean; override?: string; toGlobal: boolean }): ExportItem {
  return {
    configType: row.config_type,
    path: opts.hasPath ? finalPath(row, opts.override) : null,
    value: row.value,
    isDefault: opts.toGlobal ? !!row.is_default : false,
    ...(row.extra ? { extra: row.extra } : {}),
    ...(row.group_id !== undefined ? { groupId: row.group_id } : {}),
  };
}

const pathOf = (item: ExportItem) => item.path || defaultPath(item.configType);

/** Kunci config_type di batch dan before_snapshot: polos untuk satu domain, `domain:type` bila dua domain. */
export const typeKey = (multi: boolean, domain: ConfigDomain, configType: string) => (multi ? `${domain}:${configType}` : configType);

/** Bentuk baris batch riwayat untuk Export SQL: satu domain → kuncinya; dua domain → "semua". */
export function exportBatchShape(
  sections: Array<{ domain: ConfigDomain; configTypes: string[] }>,
): { domain: string; configTypes: string[]; counts: Record<string, unknown> } {
  const multi = sections.length > 1;
  const total = sections.reduce((n, s) => n + s.configTypes.length, 0);
  return {
    domain: multi ? "semua" : sections[0].domain,
    configTypes: sections.flatMap((s) => s.configTypes.map((t) => typeKey(multi, s.domain, t))).sort(),
    counts: multi
      ? { total, perDomain: Object.fromEntries(sections.map((s) => [s.domain, { total: s.configTypes.length }])) }
      : { total },
  };
}

export function exportFileName(tenantCode: string, table: string, date: Date): string {
  return `${tenantCode.replace(/[^A-Za-z0-9_-]/g, "_")}_${table.replace(/^public\./, "")}_${ymd(date)}.sql`;
}

function itemSql(mode: ExportSqlInput["mode"], domain: ExportTable, item: ExportItem, tenantId: string | null, groupId: string | null): string {
  const { table, typeCol, hasPath } = domain;
  const tenantCond = tenantId === null ? "tenant_id IS NULL" : `tenant_id = ${esc(tenantId)}`;
  const where = `${tenantCond} AND ${typeCol} = ${esc(item.configType)} AND deleted_at IS NULL`;
  const json = esc(JSON.stringify(item.value)) + "::jsonb";
  const path = esc(pathOf(item));
  const out: string[] = [];

  if (mode === "timpa") {
    out.push(`UPDATE ${table}\nSET value = ${json},${hasPath ? ` path = ${path},` : ""} updated_at = NOW()\nWHERE ${where};`);
  }
  const extra = extraInsert(domain, item.extra);
  const idExpr = domain.idType === "varchar" ? "gen_random_uuid()::text" : "gen_random_uuid()";
  const rowGroupId = domain.groupIdFromSource ? (item.groupId ?? null) : groupId;
  const cols = ["id", "tenant_id", "group_id", typeCol, ...(hasPath ? ["path"] : []), "value", "is_default", "created_at", "updated_at", ...extra.cols];
  const vals = [idExpr, esc(tenantId), esc(rowGroupId), esc(item.configType), ...(hasPath ? [path] : []), json, esc(item.isDefault), "NOW()", "NOW()", ...extra.vals];
  out.push(`INSERT INTO ${table} (${cols.join(", ")})\nSELECT ${vals.join(", ")}\nWHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${where});`);
  return out.join("\n");
}

export function buildExportSql(input: ExportSqlInput): string {
  const { sections, mode, source, target, author, createdAt, reason } = input;
  const tenantId = normTenantId(target.tenantId);
  const groupId = resolveGroupId(tenantId, target.groupId);
  const n = sections.reduce((sum, s) => sum + s.items.length, 0);
  const stamp = `${ymd(createdAt)} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`;
  const header = [
    "-- Tenant Studio · Export SQL",
    "-- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.",
    `-- Tabel   : ${sections.map((s) => oneLine(s.domain.table)).join(", ")}`,
    `-- Sumber  : ${oneLine(source.env)} · ${oneLine(source.tenantCode)}`,
    `-- Tujuan  : ${oneLine(target.env)} · ${oneLine(target.tenantCode)} · tenant_id ${oneLine(tenantId ?? "NULL")} · group_id ${oneLine(groupId ?? "NULL")}`,
    `-- Dibuat  : ${stamp} oleh ${oneLine(author)} · ${n} config · jika sudah ada: ${oneLine(mode)}`,
    `-- Alasan  : ${oneLine(reason)}`,
  ].join("\n");

  // Satu transaksi untuk semua tabel; nomor item berlanjut. Penjaga path hanya untuk tabel ber-path dan tenant tujuan
  // bukan NULL (ATS mencari config lewat path tanpa filter tenant, jadi path tidak boleh dipakai tenant lain).
  let i = 0;
  const chunks = sections.flatMap(({ domain, items }) => {
    const guard = domain.hasPath && tenantId !== null ? pathGuardSql(domain.table, tenantId, items.map(pathOf)) : "";
    const blocks = items.map((it) => `-- [${++i}/${n}] ${oneLine(it.configType)}\n${itemSql(mode, domain, it, tenantId, groupId)}`);
    return [`-- == ${oneLine(domain.table)} ==`, ...(guard ? [guard] : []), ...blocks];
  });
  return `${header}\n\nBEGIN;\nSET LOCAL standard_conforming_strings = on;\n\n${chunks.join("\n\n")}${chunks.length ? "\n\n" : ""}COMMIT;\n`;
}
