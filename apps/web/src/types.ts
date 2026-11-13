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
  batch_id?: string | null;
  batch_kind?: "salin" | "export_sql" | null;
  batch_source_env?: string | null;
  batch_source_tenant_code?: string | null;
}

/** Hitungan batch: angka datar (salin: dibuat, ditimpa, …; export: total), plus `perDomain` bila batch dua domain */
export type BatchCounts = Record<string, number | Record<string, Record<string, number>>>;

export interface ChangeBatch {
  id: string;
  kind: "salin" | "export_sql";
  /** "semua" = satu batch dua domain; `config_types`-nya berawalan `domain:` */
  domain: ConfigDomain | "semua";
  source_env: string;
  source_tenant_id: string;
  source_tenant_code: string | null;
  target_env: string;
  target_tenant_id: string | null;
  target_group_id: string | null;
  target_tenant_code: string | null;
  mode: string | null;
  config_types: string[];
  counts: BatchCounts | null;
  status: "menunggu" | "berhasil" | "gagal" | "diekspor";
  error: string | null;
  /** alasan yang diisi user (+ bagian otomatis); null untuk batch lama */
  note: string | null;
  sql_text?: string | null;
  before_snapshot?: unknown;
  author_name: string | null;
  created_at: string;
  finished_at: string | null;
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
  /** Layanan (ats_db, hris_db, ...) yang tersedia di env ini */
  services?: ServiceInfo[];
}

// Layanan backend yang config-nya dikelola Studio; dipilih lewat header X-Target-Service
export type ServiceKey = "ats" | "hris" | "organization" | "auth" | "communication";
export interface ServiceInfo {
  key: ServiceKey;
  label: string;
  dbName: string | null;
  available: boolean;
  /** Gagal koneksi sementara (bukan tidak dikonfigurasi) */
  unreachable?: boolean;
  hasWorkflow: boolean;
  reason?: string;
}
export const SERVICE_LABEL: Record<ServiceKey, string> = {
  ats: "ATS", hris: "HRIS", organization: "Organization", auth: "Auth", communication: "Communication"
};
/** Nama database bawaan tiap layanan (dipakai bila daftar env belum termuat) */
export const SERVICE_DEFAULT_DB: Record<ServiceKey, string> = {
  ats: "ats_db", hris: "hris_db", organization: "organization_db", auth: "auth_db", communication: "communication_db"
};
/** Warna khas tiap layanan agar database aktif mudah dikenali (badge, titik, teks) */
export const SERVICE_TONE: Record<ServiceKey, { badge: string; dot: string; text: string }> = {
  ats: { badge: "bg-sky-500/15 text-sky-200 ring-sky-500/40", dot: "bg-sky-400", text: "text-sky-300" },
  hris: { badge: "bg-amber-500/15 text-amber-200 ring-amber-500/40", dot: "bg-amber-400", text: "text-amber-300" },
  organization: { badge: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/40", dot: "bg-emerald-400", text: "text-emerald-300" },
  auth: { badge: "bg-violet-500/15 text-violet-200 ring-violet-500/40", dot: "bg-violet-400", text: "text-violet-300" },
  communication: { badge: "bg-rose-500/15 text-rose-200 ring-rose-500/40", dot: "bg-rose-400", text: "text-rose-300" }
};
export const isServiceKey = (x: unknown): x is ServiceKey =>
  typeof x === "string" && Object.prototype.hasOwnProperty.call(SERVICE_LABEL, x);
export const serviceInEnv = (env: TargetEnvInfo | undefined, key: ServiceKey): ServiceInfo | undefined =>
  env?.services?.find((s) => s.key === key);
/** Props <option> env di dialog Salin/Export/Bandingkan: disabled bila layanan aktif tidak ada di env itu */
export const envOptionProps = (env: TargetEnvInfo, key: ServiceKey): { disabled: boolean; label: string } => {
  const s = serviceInEnv(env, key);
  const ok = !env.services || !!s?.available || !!s?.unreachable;
  return { disabled: !ok, label: ok ? env.label : `${env.label} (Layanan ${SERVICE_LABEL[key]} tidak tersedia)` };
};

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

export interface ExportSqlResult {
  sql: string;
  fileName: string;
  batchId: string;
  beforeSnapshot: "tersimpan" | "tidak_tersedia";
  warning: string | null;
}

// ---- Popup "Salin config" (cermin respons GET /api/compare/copy-preview di BFF) ----
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
  /** null bila tujuan production-manual */
  targetTenantCode: string | null;
  domains: Array<{ domain: ConfigDomain; items: PreviewItem[] }>;
}

/** Entri env tujuan khusus: production diisi manual (tidak bisa dibaca), hasilnya file SQL */
export const MANUAL_ENV = "production-manual";

export interface CopyDialogRequest {
  source: { env: string; tenantId: string };
  domains: ConfigDomain[];
  preselect: Array<{ domain: ConfigDomain; configType: string }> | "all";
  target?: { env: string; tenantId: string };
  lockTarget?: boolean;
}
export interface CopyDialogDone { target: { env: string; tenantId: string }; wrote: boolean }

/** Status cek path langsung (GET /api/compare/path-check) untuk satu kolom path pengganti; "gagal" = cek tidak berhasil (belum terverifikasi) */
export type PathStatus = "memeriksa" | "tersedia" | "dipakai" | "gagal";

/** Respons sukses POST /api/compare/copy (bentuk multi-domain) */
export interface CopyBatchResult {
  batchId: string;
  domains: Array<{
    domain: ConfigDomain;
    created: string[];
    overwritten: string[];
    skipped: { same: string[]; targetOnly: string[]; duplicates: string[]; unselected: string[] };
  }>;
  warnings: string[];
}
