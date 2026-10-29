import type { StudioUser } from "./components/AuthGate";

// Tipe & konstanta bersama Tenant Studio (dipakai hook di studio/ dan komponen di components/studio/)

export interface Tenant {
  tenantId: string;
  groupId: string | null;
  name: string;
  code: string;
  /** client_code tanpa akhiran env (IDM_PROD -> IDM): penghubung tenant yang sama di env berbeda */
  baseCode?: string;
  environment: string;
  tags: string[];
  notes: string;
  totalConfigs: number;
}

/** Klien yang terdaftar di env lain tetapi belum ada di env aktif (saran saat mendaftarkan tenant) */
export interface TenantSuggestion {
  baseCode: string;
  name: string;
  envs: string[];
  /** Terisi hanya untuk GLOBAL_DEFAULT (id sama di semua env) */
  tenantId: string | null;
}

export interface ConfigItem {
  id: string;
  tenant_id: string | null;
  group_id: string | null;
  config_type: string;
  path: string;
  is_default: boolean;
  updated_at: string;
}

export interface HistoryItem {
  id: string;
  version: number;
  group_id: string | null;
  config_value: any;
  change_summary: string;
  author_name: string;
  created_at: string;
}

export interface ReferenceItem {
  path: string;
  name: string;
  category: string;
}

export interface SyncRow {
  configId: string;
  configType: string;
  groupId: string | null;
  dbUpdatedAt: string | null;
  filePath: string | null;
  linkSource: "saved" | "auto" | null;
  status: "identical" | "different" | "no_file" | "file_missing" | "invalid_json";
  pullRequired?: boolean;
  duplicateType?: boolean;
  fileMtime: number | null;
}

export interface SyncApplyResult {
  success: boolean;
  direction: "push" | "pull";
  updated: number;
  created: number;
  skipped: number;
  failed: number;
  results: Array<{ configType: string; filePath: string; action: string; error?: string }>;
}

export const SYNC_STATUS_BADGE: Record<
  SyncRow["status"],
  { label: string; cls: string }
> = {
  identical: { label: "Sama", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
  different: { label: "Berbeda", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  no_file: { label: "Belum Ada File", cls: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
  file_missing: { label: "File Hilang", cls: "bg-rose-500/10 text-rose-300 border-rose-500/30" },
  invalid_json: { label: "JSON Rusak", cls: "bg-red-500/10 text-red-300 border-red-500/30" }
};

// Domain konfigurasi aktif: menentukan tabel DB yang dipakai BFF (lewat header X-Config-Domain)
export type ConfigDomain = "tenant_config" | "workflow_pipeline";
export const DOMAIN_LABEL: Record<ConfigDomain, string> = {
  tenant_config: "Tenant Config",
  workflow_pipeline: "Workflow Pipeline"
};

export interface TargetEnvInfo {
  name: string;
  label: string;
  color: string;
  readonly: boolean;
  protected: boolean;
  /** Akhiran client_code tenant di env ini, mis. "_PROD" */
  tenantCodeSuffix?: string;
  hostMasked: string;
  source: string;
  status?: { ok: boolean; error?: string; ms?: number };
}

export const ENV_DOT: Record<string, string> = {
  slate: "bg-slate-400", indigo: "bg-indigo-400", emerald: "bg-emerald-400", amber: "bg-amber-400",
  rose: "bg-rose-400", sky: "bg-sky-400", violet: "bg-violet-400", teal: "bg-teal-400"
};

export interface ConfigRow { id: string; tenant_id: string | null; group_id: string | null; config_type: string; path: string | null; value: any; is_default: boolean; version_token: string }
export type CompareStatus = "sama" | "beda" | "hanya_kiri" | "hanya_kanan" | "ganda";
export interface CompareEntry { configType: string; status: CompareStatus; changeCount: number; left: ConfigRow | null; right: ConfigRow | null }
export interface CompareSummary { total: number; sama: number; beda: number; hanyaKiri: number; hanyaKanan: number; ganda: number }
export interface CompareSide { env: string; tenantId: string }

export interface AppProps {
  user: StudioUser;
  setUser: (u: StudioUser) => void;
  onLogout: () => void;
}
