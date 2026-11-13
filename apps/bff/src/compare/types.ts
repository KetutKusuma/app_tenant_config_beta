export interface ConfigRow { id: string; tenant_id: string | null; group_id: string | null; config_type: string; path: string | null; value: any; is_default: boolean; version_token: string;
  /** Kolom ekstra tabel layanan (type, is_active) bila ada; disalin apa adanya saat Salin/Export */
  extra?: Record<string, unknown> }
export type CompareStatus = "sama" | "beda" | "hanya_kiri" | "hanya_kanan" | "ganda";
export interface CompareEntry { configType: string; status: CompareStatus; changeCount: number; left: ConfigRow | null; right: ConfigRow | null }
export interface CompareSummary { total: number; sama: number; beda: number; hanyaKiri: number; hanyaKanan: number; ganda: number }
export type Side = "kiri" | "kanan";
