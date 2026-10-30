import type { PathStatus, PreviewItem } from "../types";

// Aturan path yang dipakai bersama popup Salin config (useCopyDialog) dan Export SQL (ExportSqlDialog).
// ATS mencari config lewat path tanpa filter tenant, jadi path tujuan harus unik. Fungsi di sini murni (tanpa React, tanpa jaringan);
// cek path langsung ke server dilakukan komponen PathOverrideField.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path pengganti satu config sudah beres?
 * Bentrok: wajib punya path pengganti yang tersedia. Bukan bentrok: override (bila diisi) harus tersedia.
 */
export function isPathOk(item: PreviewItem, override: string, status: PathStatus): boolean {
  const o = override.trim();
  return item.pathConflict ? o !== "" && status === "tersedia" : o === "" || status === "tersedia";
}

/**
 * Path pengganti yang dikirim ke server: di-trim, dan tidak dikirim bila kosong atau sama dengan path sumber.
 * Hanya berlaku untuk config tenant_config.
 */
export function overrideToSend(item: PreviewItem, override: string | undefined): string | null {
  const o = (override ?? "").trim();
  return o && o !== item.path ? o : null;
}

/**
 * Path pengganti setelah pratinjau (dimuat ulang). `entries` = semua item pratinjau dengan kuncinya; `prev` = path pengganti
 * sebelumnya menurut kunci yang sama.
 * - `takenPaths` null: pratinjau pertama; baris bentrok mendapat saran awal dan sisanya tanpa override.
 * - `takenPaths` berisi daftar (setelah 409 PATH_CONFLICT atau TARGET_CHANGED): override lama dipertahankan, kecuali path
 *   yang baru ketahuan dipakai tenant lain pada baris yang kini bentrok; baris itu mendapat saran baru.
 */
export function mergeOverrides(
  prev: Record<string, string>,
  entries: Array<{ key: string; item: PreviewItem }>,
  takenPaths: string[] | null
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const { key, item } of entries) {
    const old = takenPaths ? prev[key] : undefined;
    const taken = old !== undefined && takenPaths!.includes(old.trim());
    if (old !== undefined && !(taken && item.pathConflict)) next[key] = old;
    else if (item.pathConflict) next[key] = item.pathConflict.suggestion;
  }
  return next;
}

/** Tandai (di tempat) baris yang path akhirnya sama dengan baris lain dalam `rows`; baris tanpa path diabaikan. */
export function markDuplicatePaths<T extends { path: string | null; dup: boolean }>(rows: T[]): void {
  const byPath = new Map<string, T[]>();
  for (const r of rows) if (r.path) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
  for (const g of byPath.values()) if (g.length > 1) g.forEach((r) => { r.dup = true; });
}

/** Path ganda yang sudah ditandai `markDuplicatePaths`: unik dan terurut. */
export function duplicatePathList(rows: Array<{ path: string | null; dup: boolean }>): string[] {
  return [...new Set(rows.filter((r) => r.dup).map((r) => r.path as string))].sort();
}

/**
 * Kolom path pengganti ditampilkan untuk satu baris: baris bentrok, baris yang sudah punya override (supaya kolom tidak
 * hilang saat user mengetik), baris dengan path ganda, dan baris yang selalu bisa diedit (`alwaysEditable`: Production isi
 * manual, tujuan tidak bisa dibaca sehingga tidak ada bentrok dari server dan SQL yang memeriksa sendiri).
 */
export function showPathField(o: { item: PreviewItem; override: string | undefined; dup: boolean; alwaysEditable: boolean }): boolean {
  return o.item.pathConflict !== null || o.override !== undefined || o.dup || o.alwaysEditable;
}

/** Alasan tombol tertahan karena path pengganti belum beres. `statuses` = status cek path baris yang belum beres (tidak kosong). */
export function pendingPathReason(statuses: PathStatus[]): string {
  if (statuses.includes("gagal")) return "Cek path gagal; coba lagi.";
  return statuses.includes("memeriksa") ? "Path pengganti masih diperiksa." : "Path pengganti sudah dipakai atau kosong; ubah path-nya.";
}
