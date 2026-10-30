import { autoSummary } from "../changeSummary";
import type { ConfigDomain } from "../domain";
import { finalPath, suggestPath, type PathOwner } from "./pathConflicts";
import type { CompareEntry, CompareStatus, ConfigRow } from "./types";

/**
 * Pratinjau salin (hanya baca): per config, apa yang akan terjadi bila disalin ke tujuan.
 * Fungsi di sini murni; pembacaan DB dan perakitan respons ada di routes/compare.ts.
 */

export type PreviewStatus = "baru" | "timpa" | "sama" | "ganda" | "hanya_tujuan" | "tidak_dibaca";

export interface PreviewPathConflict { ownerTenantId: string | null; ownerConfigType: string; suggestion: string }

export interface PreviewItem {
  configType: string;
  status: PreviewStatus;
  /** version_token config di tujuan; null bila belum ada atau tujuan tidak dibaca */
  targetVersion: string | null;
  autoSummary: string | null;
  /** path akhir; null untuk domain tanpa kolom path */
  path: string | null;
  pathConflict: PreviewPathConflict | null;
}

export interface CopyPreview {
  targetReadable: boolean;
  /** kode tenant tujuan menurut tenant_metadata; null bila tujuan production-manual */
  targetTenantCode: string | null;
  domains: Array<{ domain: ConfigDomain; items: PreviewItem[] }>;
}

const STATUS: Record<CompareStatus, PreviewStatus> = {
  hanya_kiri: "baru",
  beda: "timpa",
  sama: "sama",
  ganda: "ganda",
  hanya_kanan: "hanya_tujuan",
};

/** `entries` = hasil buildCompareEntries(sumber, tujuan): kiri = sumber, kanan = tujuan. */
export function previewItems(entries: CompareEntry[], hasPath: boolean): PreviewItem[] {
  return entries.map((e) => {
    const status = STATUS[e.status];
    let summary: string | null = null;
    if (status === "baru") summary = "Config baru";
    else if (status === "timpa" && e.left && e.right) {
      summary = autoSummary(e.right.value, e.left.value, hasPath ? { from: e.right.path, to: finalPath(e.left) } : undefined);
    }
    const shown = e.left ?? e.right;
    return {
      configType: e.configType,
      status,
      targetVersion: e.right?.version_token ?? null,
      autoSummary: summary,
      path: hasPath && shown ? finalPath(shown) : null,
      pathConflict: null,
    };
  });
}

/** Tujuan tidak bisa dibaca (production isi manual): hanya isi sumber; tipe berbaris ganda tetap ditandai. */
export function previewSourceOnly(rows: ConfigRow[], hasPath: boolean): PreviewItem[] {
  const byType = new Map<string, ConfigRow[]>();
  for (const r of rows) {
    const list = byType.get(r.config_type);
    if (list) list.push(r);
    else byType.set(r.config_type, [r]);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([configType, list]) => ({
      configType,
      status: list.length > 1 ? ("ganda" as const) : ("tidak_dibaca" as const),
      targetVersion: null,
      autoSummary: null,
      path: hasPath ? finalPath(list[0]) : null,
      pathConflict: null,
    }));
}

/**
 * Item baru/timpa yang path-nya dipakai tenant lain mendapat `pathConflict` beserta saran path bebas.
 * `taken` = path tenant lain dengan awalan slug tujuan (takenPathsWithPrefix); path bentrok dan saran
 * item sebelumnya ditambahkan di sini supaya saran tidak saling bentrok. `taken` tidak diubah.
 */
export function attachConflicts(
  items: PreviewItem[],
  conflicts: Map<string, PathOwner>,
  tenantCode: string,
  taken: Set<string>,
): PreviewItem[] {
  const used = new Set<string>([...taken, ...conflicts.keys()]);
  return items.map((it) => {
    if ((it.status !== "baru" && it.status !== "timpa") || it.path === null) return it;
    const owner = conflicts.get(it.path);
    if (!owner) return it;
    const suggestion = suggestPath(it.path, tenantCode, used);
    used.add(suggestion);
    return { ...it, pathConflict: { ownerTenantId: owner.tenantId, ownerConfigType: owner.configType, suggestion } };
  });
}
