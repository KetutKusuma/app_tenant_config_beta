import { esc } from "./db";
import type { TableSpec } from "./services";

// Helper SQL bersama untuk tabel config semua layanan (lihat services.ts).

/**
 * Kondisi baris config yang "hidup": belum dihapus DAN punya tipe config. Baris tanpa config_type
 * (mis. baris CMS di organization_db yang memakai kolom lama `type`) dikelola modul lain dan tidak disentuh Studio.
 */
export function liveWhere(t: Pick<TableSpec, "typeCol">): string {
  return `deleted_at IS NULL AND ${t.typeCol} IS NOT NULL`;
}

/** Kolom SELECT tambahan berisi kolom ekstra (type, is_active) sebagai objek `extra`; kosong bila tidak ada */
export function extraSelect(t: Pick<TableSpec, "extraCopyCols">): string {
  const cols = t.extraCopyCols ?? [];
  if (!cols.length) return "";
  return `, jsonb_build_object(${cols.map((c) => `'${c}', ${c}`).join(", ")}) AS extra`;
}

/** Literal SQL untuk nilai kolom ekstra (boolean/angka apa adanya, sisanya di-escape) */
function extraLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return esc(String(v));
}

/**
 * Kolom + nilai ekstra untuk INSERT baris baru: nilai dari sumber (`extra`) bila ada,
 * lalu default tabel untuk kolom yang belum terisi.
 */
export function extraInsert(
  t: Partial<Pick<TableSpec, "extraCopyCols" | "extraInsertDefaults">>,
  extra: Record<string, unknown> | undefined
): { cols: string[]; vals: string[] } {
  const cols: string[] = [];
  const vals: string[] = [];
  for (const c of t.extraCopyCols ?? []) {
    if (extra && Object.prototype.hasOwnProperty.call(extra, c) && extra[c] !== null && extra[c] !== undefined) {
      cols.push(c);
      vals.push(extraLiteral(extra[c]));
    }
  }
  for (const [c, lit] of Object.entries(t.extraInsertDefaults ?? {})) {
    if (!cols.includes(c)) {
      cols.push(c);
      vals.push(lit);
    }
  }
  return { cols, vals };
}

/** Pesan Indonesia untuk error constraint Postgres saat menulis config; null bila bukan error yang dikenal */
export function pgErrorMessage(err: unknown, ctx: { serviceLabel: string }): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "23503") return `Tenant belum terdaftar di ${ctx.serviceLabel} pada env ini.`;
  if (code === "23505") return "Config ini sudah ada di tujuan.";
  return null;
}
