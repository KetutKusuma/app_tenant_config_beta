import type express from "express";
import { Pool, type PoolConfig } from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

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
  hostMasked: string;
  source: string;
}

interface LoadedProfile extends TargetEnvProfile {
  mtimeMs: number;
  poolConfig: PoolConfig;
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
        hostMasked: maskHost(host),
        source: `envs/${file}`,
        mtimeMs,
        poolConfig: config
      });
    } catch (err: any) {
      loadErrors.set(name, `envs/${file}: ${err.message}`);
    }
  }

  if (result.size === 0) {
    const { config, host } = poolConfigFrom({
      ...process.env,
      TARGET_DB_URL: process.env.TARGET_DB_URL || process.env.AUDIT_DB_URL
    });
    result.set(LEGACY_NAME, {
      name: LEGACY_NAME,
      label: "Default (.env)",
      color: "slate",
      readonly: false,
      protected: false,
      hostMasked: maskHost(host),
      source: ".env",
      mtimeMs: 0,
      poolConfig: config
    });
  }

  profileCache.clear();
  result.forEach((p, k) => profileCache.set(k, p));
  // Tutup pool milik profil yang filenya dihapus
  for (const [name, entry] of pools) {
    if (!result.has(name)) {
      entry.pool.end().catch(() => {});
      pools.delete(name);
    }
  }
  return result;
}

export function listProfiles(): { profiles: TargetEnvProfile[]; errors: string[]; defaultEnv: string } {
  const profiles = [...loadProfiles().values()].map(({ mtimeMs: _m, poolConfig: _c, ...p }) => p);
  return { profiles, errors: [...loadErrors.values()], defaultEnv: defaultEnvName() };
}

export function defaultEnvName(): string {
  const all = profileCache.size ? profileCache : loadProfiles();
  const wanted = process.env.STUDIO_DEFAULT_TARGET_ENV;
  if (wanted && all.has(wanted)) return wanted;
  return [...all.keys()].sort()[0];
}

/** Pool untuk profil; dibuat saat pertama dipakai, dibuat ulang bila file profilnya berubah */
export function poolFor(name: string): Pool {
  const profile = profileCache.get(name) || loadProfiles().get(name);
  if (!profile) throw new Error(`Target env '${name}' tidak ditemukan`);
  const existing = pools.get(name);
  if (existing && existing.mtimeMs === profile.mtimeMs) return existing.pool;
  if (existing) existing.pool.end().catch(() => {});
  const pool = new Pool(profile.poolConfig);
  pool.on("error", (err) => console.error(`Target DB Pool Error [${name}]:`, err.message));
  pools.set(name, { pool, mtimeMs: profile.mtimeMs });
  return pool;
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
    const { mtimeMs: _m, poolConfig: _c, ...profile } = profiles.get(requested)!;
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
