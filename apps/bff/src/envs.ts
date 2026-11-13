import type express from "express";
import { Pool, type PoolConfig } from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { SERVICES, SERVICE_KEYS, isServiceKey, type ServiceKey } from "./services";

// ============================================================================
// Target Environment Profiles: setiap file envs/<nama>.env = 1 koneksi ats_db.
// Tambah file baru -> profil muncul otomatis (dipindai ulang saat diminta, tanpa restart).
// Pilihan profil per request lewat header X-Target-Env (disimpan per user di preferences).
// ============================================================================

export const ENVS_DIR = path.resolve(__dirname, "../../../envs");
const NAME_RE = /^[a-z0-9_-]+$/;
const FILE_RE = /^([a-z0-9_-]+)\.env$/;
/** Profil cadangan bila folder envs/ kosong: perilaku lama (DB_* / TARGET_DB_URL / AUDIT_DB_URL di .env) */
const LEGACY_NAME = "default";

export interface TargetEnvProfile {
  name: string;
  label: string;
  color: string;
  /** true = semua operasi tulis ke ats_db ditolak (lihat assertWritable) */
  readonly: boolean;
  /** true = operasi tulis wajib konfirmasi ketik nama profil (header X-Confirm-Env) */
  protected: boolean;
  /** Akhiran client_code tenant di env ini (mis. "_PROD": IDM_PROD). Kode dasar (IDM) menghubungkan tenant antar env */
  tenantCodeSuffix: string;
  hostMasked: string;
  source: string;
}

interface LoadedProfile extends TargetEnvProfile {
  mtimeMs: number;
  poolConfig: PoolConfig;
  /** Konfigurasi pool per layanan (ats = poolConfig). Layanan tanpa entri = tidak dikonfigurasi di env ini */
  servicePools: Partial<Record<ServiceKey, PoolConfig>>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      targetEnv?: TargetEnvProfile;
      targetDb?: Pool;
    }
  }
}

const truthy = (v: string | undefined) => v === "true" || v === "1" || v === "yes";

// Sembunyikan host asli: tampilkan awal & domain saja (ep-***.neon.tech)
function maskHost(host: string | undefined): string {
  if (!host) return "-";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `${host.split(".")[0]}.***.***.***`;
  const parts = host.split(".");
  if (parts.length <= 2) return host.length > 4 ? `${host.slice(0, 2)}***` : "***";
  return `${parts[0].slice(0, 3)}***.${parts.slice(-2).join(".")}`;
}

function poolConfigFrom(vars: Record<string, string | undefined>): { config: PoolConfig; host?: string } {
  if (vars.DB_HOST) {
    const ssl = vars.DB_SSL === "true" || vars.DB_SSL === "require";
    return {
      host: vars.DB_HOST,
      config: {
        host: vars.DB_HOST,
        port: vars.DB_PORT ? parseInt(vars.DB_PORT, 10) : 5432,
        user: vars.DB_USERNAME,
        password: vars.DB_PASSWORD,
        database: vars.DB_DATABASE || vars.DB_NAME || "ats_db",
        ssl: ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 5000
      }
    };
  }
  const url = vars.TARGET_DB_URL || vars.DATABASE_URL;
  if (!url) throw new Error("butuh DB_HOST (+ DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME) atau TARGET_DB_URL");
  let host: string | undefined;
  try {
    host = new URL(url).hostname;
  } catch {
    /* url tidak standar: host tidak ditampilkan */
  }
  return { host, config: { connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 } };
}

/**
 * Konfigurasi pool untuk satu layanan dari isi file profil env. ats = perilaku lama (DB_NAME / TARGET_DB_URL).
 * Layanan lain: DB_HOST -> database DB_NAME_<LAYANAN> atau nama default layanan; TARGET_DB_URL -> hanya bila
 * TARGET_DB_URL_<LAYANAN> diisi. null = layanan tidak dikonfigurasi di env ini.
 */
export function servicePoolConfig(vars: Record<string, string | undefined>, service: ServiceKey): PoolConfig | null {
  if (service === "ats") return poolConfigFrom(vars).config;
  const suffix = service.toUpperCase();
  if (vars.DB_HOST) {
    const { config } = poolConfigFrom(vars);
    return { ...config, database: vars[`DB_NAME_${suffix}`] || SERVICES[service].defaultDbName };
  }
  const url = vars[`TARGET_DB_URL_${suffix}`];
  if (!url) return null;
  return { connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 };
}

function servicePoolsFrom(vars: Record<string, string | undefined>): Partial<Record<ServiceKey, PoolConfig>> {
  const out: Partial<Record<ServiceKey, PoolConfig>> = {};
  for (const key of SERVICE_KEYS) {
    const c = servicePoolConfig(vars, key);
    if (c) out[key] = c;
  }
  return out;
}

const profileCache = new Map<string, LoadedProfile>();
const pools = new Map<string, { pool: Pool; mtimeMs: number }>();
const loadErrors = new Map<string, string>();

function loadProfiles(): Map<string, LoadedProfile> {
  const result = new Map<string, LoadedProfile>();
  loadErrors.clear();
  const files = fs.existsSync(ENVS_DIR) ? fs.readdirSync(ENVS_DIR) : [];
  for (const file of files) {
    const m = FILE_RE.exec(file);
    if (!m) continue;
    const name = m[1];
    const full = path.join(ENVS_DIR, file);
    const mtimeMs = fs.statSync(full).mtimeMs;
    const cached = profileCache.get(name);
    if (cached && cached.mtimeMs === mtimeMs) {
      result.set(name, cached);
      continue;
    }
    try {
      const vars = dotenv.parse(fs.readFileSync(full));
      const { config, host } = poolConfigFrom(vars);
      result.set(name, {
        name,
        label: vars.STUDIO_ENV_LABEL || name,
        color: vars.STUDIO_ENV_COLOR || "slate",
        readonly: truthy(vars.STUDIO_ENV_READONLY),
        protected: truthy(vars.STUDIO_ENV_PROTECTED),
        tenantCodeSuffix: (vars.STUDIO_TENANT_CODE_SUFFIX || "").trim().toUpperCase(),
        hostMasked: maskHost(host),
        source: `envs/${file}`,
        mtimeMs,
        poolConfig: config,
        servicePools: servicePoolsFrom(vars)
      });
    } catch (err: any) {
      loadErrors.set(name, `envs/${file}: ${err.message}`);
    }
  }

  if (result.size === 0) {
    const legacyVars = {
      ...process.env,
      TARGET_DB_URL: process.env.TARGET_DB_URL || process.env.AUDIT_DB_URL
    };
    const { config, host } = poolConfigFrom(legacyVars);
    result.set(LEGACY_NAME, {
      name: LEGACY_NAME,
      label: "Default (.env)",
      color: "slate",
      readonly: false,
      protected: false,
      tenantCodeSuffix: "",
      hostMasked: maskHost(host),
      source: ".env",
      mtimeMs: 0,
      poolConfig: config,
      servicePools: servicePoolsFrom(legacyVars)
    });
  }

  profileCache.clear();
  result.forEach((p, k) => profileCache.set(k, p));
  // Tutup pool milik profil yang filenya dihapus
  for (const [key, entry] of pools) {
    if (!result.has(key.split(":")[0])) {
      entry.pool.end().catch(() => {});
      pools.delete(key);
    }
  }
  return result;
}

export function listProfiles(): { profiles: TargetEnvProfile[]; errors: string[]; defaultEnv: string } {
  const profiles = [...loadProfiles().values()].map(({ mtimeMs: _m, poolConfig: _c, servicePools: _s, ...p }) => p);
  return { profiles, errors: [...loadErrors.values()], defaultEnv: defaultEnvName() };
}

/** Kode dasar tenant: client_code tanpa akhiran env (IDM_PROD -> IDM), dipakai untuk mencocokkan tenant antar env */
export function baseTenantCode(code: string, suffix: string): string {
  const upper = (code || "").toUpperCase();
  return suffix && upper.endsWith(suffix) && upper.length > suffix.length ? upper.slice(0, -suffix.length) : upper;
}

export function defaultEnvName(): string {
  const all = profileCache.size ? profileCache : loadProfiles();
  const wanted = process.env.STUDIO_DEFAULT_TARGET_ENV;
  if (wanted && all.has(wanted)) return wanted;
  return [...all.keys()].sort()[0];
}

/** Pool untuk profil + layanan (kunci `<env>:<layanan>`); dibuat saat pertama dipakai, dibuat ulang bila file profilnya berubah */
export function poolFor(name: string, service: ServiceKey = "ats"): Pool {
  const profile = profileCache.get(name) || loadProfiles().get(name);
  if (!profile) throw new Error(`Target env '${name}' tidak ditemukan`);
  const config = profile.servicePools[service];
  if (!config) throw new Error(`Layanan '${SERVICES[service].label}' tidak dikonfigurasi di env '${name}'`);
  const key = `${name}:${service}`;
  const existing = pools.get(key);
  if (existing && existing.mtimeMs === profile.mtimeMs) return existing.pool;
  if (existing) existing.pool.end().catch(() => {});
  const pool = new Pool(config);
  pool.on("error", (err) => console.error(`Target DB Pool Error [${key}]:`, err.message));
  pools.set(key, { pool, mtimeMs: profile.mtimeMs });
  return pool;
}

export interface ServiceAvailability {
  key: ServiceKey;
  label: string;
  dbName: string | null;
  available: boolean;
  /** true: gagal koneksi (VPN putus, timeout) — sementara; request tetap diteruskan agar route melapor sendiri */
  unreachable?: boolean;
  hasWorkflow: boolean;
  reason?: string;
}

interface AvailabilityDeps {
  configs: (env: string) => Partial<Record<ServiceKey, PoolConfig>>;
  ping: (env: string, service: ServiceKey) => Promise<{ ok: boolean; unreachable?: boolean; reason?: string }>;
}

function dbNameOf(c: PoolConfig): string | null {
  if (c.database) return c.database;
  if (c.connectionString) {
    try {
      return new URL(c.connectionString).pathname.replace(/^\//, "") || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function defaultPing(env: string, service: ServiceKey): Promise<{ ok: boolean; unreachable?: boolean; reason?: string }> {
  const table = SERVICES[service].domains.tenant_config.table;
  try {
    const r = await poolFor(env, service).query("SELECT to_regclass($1) IS NOT NULL AS ok", [table]);
    return r.rows[0]?.ok ? { ok: true } : { ok: false, reason: `tabel ${table} tidak ditemukan` };
  } catch (err: any) {
    // 3D000 = database tidak ada (masalah konfigurasi, permanen); selain itu dianggap gangguan koneksi sementara
    return err?.code === "3D000" ? { ok: false, reason: err.message } : { ok: false, unreachable: true, reason: err.message };
  }
}

const defaultAvailabilityDeps: AvailabilityDeps = {
  configs: (env) => (profileCache.get(env) || loadProfiles().get(env))?.servicePools ?? {},
  ping: defaultPing
};

const availabilityCache = new Map<string, { at: number; mtimeMs: number; list: ServiceAvailability[] }>();
const AVAILABILITY_TTL_MS = 60_000;

/** Status tiap layanan di satu env: dikonfigurasi + tabel config ada. Di-cache 60 detik per env (deps bawaan saja) */
export async function serviceAvailability(env: string, deps?: AvailabilityDeps): Promise<ServiceAvailability[]> {
  const d = deps ?? defaultAvailabilityDeps;
  const mtimeMs = profileCache.get(env)?.mtimeMs ?? -1;
  if (!deps) {
    const hit = availabilityCache.get(env);
    if (hit && hit.mtimeMs === mtimeMs && Date.now() - hit.at < AVAILABILITY_TTL_MS) return hit.list;
  }
  const configs = d.configs(env);
  const list = await Promise.all(
    SERVICE_KEYS.map(async (key): Promise<ServiceAvailability> => {
      const s = SERVICES[key];
      const base = { key, label: s.label, hasWorkflow: !!s.domains.workflow_pipeline };
      const config = configs[key];
      if (!config) return { ...base, dbName: null, available: false, reason: "tidak dikonfigurasi di profil env ini" };
      const p = await d.ping(env, key);
      return { ...base, dbName: dbNameOf(config), available: p.ok, ...(p.ok ? {} : { reason: p.reason }), ...(p.unreachable ? { unreachable: true } : {}) };
    })
  );
  // Gangguan koneksi tidak di-cache: begitu VPN pulih, request berikutnya langsung normal
  if (!deps && !list.some((x) => x.unreachable)) availabilityCache.set(env, { at: Date.now(), mtimeMs, list });
  return list;
}

export async function pingProfile(name: string): Promise<{ ok: boolean; error?: string; ms?: number }> {
  const started = Date.now();
  try {
    await poolFor(name).query("SELECT 1");
    return { ok: true, ms: Date.now() - started };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Middleware /api: tentukan profil target dari header X-Target-Env, lalu preferensi user,
 * lalu default. Dipasang SETELAH middleware auth (butuh req.user).
 */
export function targetEnvMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith("/auth/") || req.path.startsWith("/envs")) return next();
    const profiles = loadProfiles();
    const requested = req.header("x-target-env") || req.user?.preferences.lastTargetEnv || defaultEnvName();
    if (!NAME_RE.test(requested) || !profiles.has(requested)) {
      return res.status(400).json({
        code: "UNKNOWN_TARGET_ENV",
        error: `Target env '${requested}' tidak dikenal. Pilih salah satu: ${[...profiles.keys()].join(", ")}`
      });
    }
    const { mtimeMs: _m, poolConfig: _c, servicePools: _s, ...profile } = profiles.get(requested)!;
    req.targetEnv = profile;
    try {
      req.targetDb = poolFor(requested);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
    next();
  };
}

/**
 * Penjaga operasi tulis ke ats_db. Return true bila boleh lanjut; bila tidak, response sudah dikirim.
 * readonly -> 403 ENV_READONLY; protected tanpa header X-Confirm-Env yang cocok -> 428 ENV_CONFIRM_REQUIRED.
 */
export function assertWritable(req: express.Request, res: express.Response): boolean {
  const env = req.targetEnv;
  if (!env) return true;
  if (env.readonly) {
    res.status(403).json({
      code: "ENV_READONLY",
      error: `Target env '${env.label}' bersifat read-only. Ubah lewat preset + review, atau pilih env lain.`
    });
    return false;
  }
  if (env.protected && req.header("x-confirm-env") !== env.name) {
    res.status(428).json({
      code: "ENV_CONFIRM_REQUIRED",
      env: env.name,
      error: `Target env '${env.label}' dilindungi. Konfirmasi dengan mengetik nama env.`
    });
    return false;
  }
  return true;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Middleware /api: tentukan layanan target (ATS, HRIS, ...) dari header X-Target-Service. Dipasang SETELAH
 * targetEnvMiddleware. Request tulis WAJIB membawa header agar tab/client lama tidak menulis ke layanan yang
 * tidak sedang tampil; request baca boleh jatuh ke preferensi user lalu ats.
 */
export function targetServiceMiddleware(deps?: {
  availability?: (env: string) => Promise<ServiceAvailability[]>;
  pool?: (env: string, service: ServiceKey) => Pool;
}): express.RequestHandler {
  const availability = deps?.availability ?? ((env: string) => serviceAvailability(env));
  const pool = deps?.pool ?? poolFor;
  return async (req, res, next) => {
    if (req.path.startsWith("/auth/") || req.path.startsWith("/envs") || req.path.startsWith("/me/")) return next();
    const env = req.targetEnv;
    if (!env) return next();
    const raw = req.header("x-target-service");
    if (raw !== undefined && !isServiceKey(raw)) {
      return res.status(400).json({
        code: "UNKNOWN_TARGET_SERVICE",
        error: `Layanan '${raw}' tidak dikenal. Pilih salah satu: ${SERVICE_KEYS.join(", ")}`
      });
    }
    if (raw === undefined && WRITE_METHODS.has(req.method)) {
      return res.status(400).json({
        code: "TARGET_SERVICE_REQUIRED",
        error: "Layanan tujuan tidak disebutkan. Muat ulang halaman Studio."
      });
    }
    const pref = req.user?.preferences.lastTargetService;
    const key: ServiceKey = raw !== undefined ? raw : isServiceKey(pref) ? pref : "ats";
    // Domain workflow diminta eksplisit untuk layanan tanpa tabel workflow: tolak, jangan diam-diam pakai tenant_config
    const domain = req.header("x-config-domain") || (req.query?.domain as string | undefined) || req.body?.domain;
    if (domain === "workflow_pipeline" && !SERVICES[key].domains.workflow_pipeline) {
      return res.status(400).json({
        code: "DOMAIN_UNAVAILABLE",
        error: `Layanan ${SERVICES[key].label} tidak punya tabel workflow.`
      });
    }
    try {
      const status = (await availability(env.name)).find((s) => s.key === key);
      if (!status?.available && !status?.unreachable) {
        return res.status(409).json({
          code: "SERVICE_UNAVAILABLE",
          error: `Layanan ${SERVICES[key].label} tidak tersedia di env ${env.label}: ${status?.reason || "tidak dikonfigurasi"}`
        });
      }
      req.targetService = SERVICES[key];
      req.targetDb = pool(env.name, key);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
    next();
  };
}
