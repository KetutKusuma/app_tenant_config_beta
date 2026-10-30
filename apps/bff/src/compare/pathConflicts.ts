import { esc } from "../db";
import { defaultPath } from "./sqlExport";

/**
 * ATS mencari config tenant lewat `path` TANPA filter tenant, jadi path hasil salin tidak boleh
 * sama dengan path yang sudah dipakai tenant lain di DB tujuan. Modul ini menurunkan path akhir,
 * menyarankan path yang masih bebas, mencari bentrok, dan membuat penjaga SQL untuk file export.
 */

/** Pool `pg` maupun client transaksi: cukup objek dengan `query(sql)`. */
export interface QueryDb { query(sql: string): Promise<{ rows: any[] }> }

export interface PathOwner { tenantId: string | null; configType: string }

/** Kode tenant → potongan path: huruf kecil, `_` dan spasi jadi `-`, selain `[a-z0-9-]` dibuang. */
export function tenantCodeSlug(code: string): string {
  return code.toLowerCase().replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/** Override (di-trim, tidak kosong) menang; selain itu path baris; bila kosong, turunan dari config_type. */
export function finalPath(row: { config_type: string; path: string | null }, override?: string): string {
  const o = (override ?? "").trim();
  if (o) return o;
  return row.path || defaultPath(row.config_type);
}

/**
 * Saran path bebas untuk tenant lain: `/ats/<slug>/…` bila diawali `/ats/`; selain itu `<slug>/` di depan
 * (awalan `/` dipertahankan). Bila sudah ada di `taken`, `-2`, `-3`, … ditambahkan di ujung sampai bebas.
 */
export function suggestPath(path: string, tenantCode: string, taken: Set<string>): string {
  const slug = tenantCodeSlug(tenantCode);
  let base: string;
  if (path.startsWith("/ats/")) base = `/ats/${slug}/${path.slice("/ats/".length)}`;
  else if (path.startsWith("/")) base = `/${slug}${path}`;
  else base = `${slug}/${path}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Path akhir yang dipakai lebih dari satu item, terurut. */
export function duplicateFinalPaths(items: Array<{ configType: string; path: string }>): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const it of items) {
    if (seen.has(it.path)) dup.add(it.path);
    else seen.add(it.path);
  }
  return [...dup].sort();
}

/** Baris aktif milik tenant selain tujuan (tenant global/NULL ikut dihitung). */
function otherTenantsWhere(targetTenantId: string): string {
  return `tenant_id IS DISTINCT FROM ${esc(targetTenantId)} AND deleted_at IS NULL`;
}

const inList = (paths: string[]) => [...new Set(paths)].map(esc).join(", ");

/** Path (dari `paths`) yang sudah dipakai tenant lain → pemilik pertama per path. Daftar kosong: tanpa query. */
export async function findPathConflicts(
  db: QueryDb, table: string, paths: string[], targetTenantId: string,
): Promise<Map<string, PathOwner>> {
  const out = new Map<string, PathOwner>();
  if (paths.length === 0) return out;
  const { rows } = await db.query(
    `SELECT path, tenant_id, config_type FROM ${table} WHERE path IN (${inList(paths)}) AND ${otherTenantsWhere(targetTenantId)} ORDER BY path, tenant_id NULLS LAST, config_type`,
  );
  for (const r of rows) {
    if (!out.has(r.path)) out.set(r.path, { tenantId: r.tenant_id ?? null, configType: r.config_type });
  }
  return out;
}

/** Path aktif tenant lain yang diawali `/ats/<slug>/`, `/<slug>/`, atau `<slug>/`. `slug` hanya `[a-z0-9-]`. */
export async function takenPathsWithPrefix(
  db: QueryDb, table: string, targetTenantId: string, slug: string,
): Promise<Set<string>> {
  const likes = [`/ats/${slug}/%`, `/${slug}/%`, `${slug}/%`].map((p) => `path LIKE ${esc(p)}`).join(" OR ");
  const { rows } = await db.query(
    `SELECT path FROM ${table} WHERE (${likes}) AND ${otherTenantsWhere(targetTenantId)}`,
  );
  return new Set(rows.map((r) => r.path as string));
}

/**
 * Blok `DO $$ … $$;` yang menggagalkan seluruh skrip bila salah satu path sudah dipakai tenant lain
 * di DB tujuan. Ditaruh setelah `SET LOCAL standard_conforming_strings = on;`. Daftar kosong: "".
 */
export function pathGuardSql(table: string, targetTenantId: string, paths: string[]): string {
  if (paths.length === 0) return "";
  // `$$` di dalam literal tetap menutup badan DO lebih awal, dan esc() tidak melindunginya.
  const bad = paths.find((p) => p.includes("$$"));
  if (bad !== undefined) throw new Error(`Path tidak boleh memuat "$$": ${bad}`);
  const where = `path IN (${inList(paths)}) AND ${otherTenantsWhere(targetTenantId)}`;
  return [
    "DO $$ BEGIN",
    `  IF EXISTS (SELECT 1 FROM ${table} WHERE ${where}) THEN`,
    `    RAISE EXCEPTION 'Path sudah dipakai tenant lain: %', (SELECT string_agg(DISTINCT path, ', ') FROM ${table} WHERE ${where});`,
    "  END IF;",
    "END $$;",
  ].join("\n");
}
