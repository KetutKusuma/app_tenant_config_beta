import type express from "express";
import type { Pool } from "pg";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { recordLoginEvent } from "./users/loginEvents.js";
import { deviceLabel } from "./users/device.js";

// ============================================================================
// Auth Tenant Studio: user, session (cookie httpOnly) dan preferensi per user.
// Semua tabel ada di schema tenant_studio pada audit DB (Neon), bukan di ats_db.
// ============================================================================

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "ts_session";
const SESSION_TTL_DAYS = 7;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

export interface StudioUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
  role: "admin" | "user";
  preferences: {
    presetDirTenant: string | null;
    presetDirWorkflow: string | null;
    lastDomain: string | null;
    lastTenantId: string | null;
    lastTargetEnv: string | null;
    lastTargetService: string | null;
    /** Folder preset layanan selain ATS, kunci `<layanan>:<domain>` (ATS memakai presetDirTenant/Workflow) */
    presetDirs: Record<string, string>;
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: StudioUser;
      /** id sesi yang sedang dipakai (diisi middleware untuk sesi valid) */
      sessionId?: string;
    }
  }
}

type Esc = (val: any) => string;

// Format hash: scrypt$<salt hex>$<hash hex>
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Token mentah hanya ada di cookie; DB menyimpan hash-nya
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setSessionCookie(res: express.Response, token: string | null) {
  const secure = process.env.STUDIO_COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    token
      ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
      : `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

// Pembatas percobaan login gagal (in-memory, cukup untuk tool internal 1 instance)
type LockEntry = { count: number; until: number; windowStart: number; lockNoticed?: boolean };
const failedLogins = new Map<string, LockEntry>(); // kunci `${email}|${ip}`
const failedByEmail = new Map<string, LockEntry>(); // cadangan: per email, tanpa IP (X-Forwarded-For bisa dirotasi penyerang)
const MAX_FAILED = 5;
export const MAX_FAILED_PER_EMAIL = 20;
const LOCK_MS = 15 * 60 * 1000;

export function loginLockedMs(key: string, map = failedLogins): number {
  const entry = map.get(key);
  if (!entry) return 0;
  if (entry.until && entry.until > Date.now()) return entry.until - Date.now();
  if (entry.until && entry.until <= Date.now()) map.delete(key);
  return 0;
}
export function recordFailedLogin(key: string, map = failedLogins, max = MAX_FAILED) {
  const now = Date.now();
  let entry = map.get(key);
  // Jendela hitung habis (tidak sedang terkunci) -> mulai lagi, agar peta tidak menumpuk selamanya
  if (!entry || (!entry.until && now - entry.windowStart > LOCK_MS)) entry = { count: 0, until: 0, windowStart: now };
  entry.count += 1;
  if (entry.count >= max) {
    entry.until = now + LOCK_MS;
    entry.lockNoticed = false;
  }
  map.set(key, entry);
}

/** true hanya pada panggilan pertama selama satu masa kunci aktif (untuk mencatat login_terkunci sekali) */
export function consumeLockNotice(key: string, map = failedLogins): boolean {
  const entry = map.get(key);
  if (!entry || !(entry.until > Date.now()) || entry.lockNoticed) return false;
  entry.lockNoticed = true;
  return true;
}

const failedByIp = new Map<string, LockEntry>(); // anti password-spray: semua email dari satu IP
export const MAX_FAILED_PER_IP = 30;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_LENGTH = 1024;
const SWEEP_EVERY_MS = 60 * 1000;
let lastSweep = 0;

const ipKeyOf = (email: string, ip: string) => `${email}|${ip}`;

/** Hapus entri yang kuncinya sudah lewat atau jendela hitungnya habis, agar peta tidak tumbuh tanpa batas. */
export function sweepExpiredLocks(now = Date.now()) {
  for (const map of [failedLogins, failedByEmail, failedByIp]) {
    for (const [k, e] of map) {
      if (e.until ? e.until <= now : now - e.windowStart > LOCK_MS) map.delete(k);
    }
  }
}

/** Jumlah entri di semua peta kunci (untuk uji). */
export function lockEntryCount(): number {
  return failedLogins.size + failedByEmail.size + failedByIp.size;
}

/** Sisa waktu kunci (ms): kunci email|ip, per email, ATAU per IP; yang terlama. 0 bila tidak terkunci. */
export function loginLockRemainingMs(email: string, ip: string): number {
  return Math.max(loginLockedMs(ipKeyOf(email, ip)), loginLockedMs(email, failedByEmail), loginLockedMs(ip, failedByIp));
}
/** Setiap percobaan gagal menambah ketiga hitungan. Sinkron (tanpa await) agar request paralel tidak lolos. */
export function recordFailedAttempt(email: string, ip: string) {
  const now = Date.now();
  if (now - lastSweep > SWEEP_EVERY_MS) {
    lastSweep = now;
    sweepExpiredLocks(now);
  }
  recordFailedLogin(ipKeyOf(email, ip));
  recordFailedLogin(email, failedByEmail, MAX_FAILED_PER_EMAIL);
  recordFailedLogin(ip, failedByIp, MAX_FAILED_PER_IP);
}
/** Login sukses menghapus entri email|ip dan email. Entri per-IP sengaja dipertahankan (batas spray). */
export function clearFailedAttempts(email: string, ip: string) {
  failedLogins.delete(ipKeyOf(email, ip));
  failedByEmail.delete(email);
}
/** Paling banyak satu notifikasi per request: true bila salah satu kunci yang aktif belum diberitahukan. */
export function consumeAnyLockNotice(email: string, ip: string): boolean {
  const a = consumeLockNotice(ipKeyOf(email, ip));
  const b = consumeLockNotice(email, failedByEmail);
  const c = consumeLockNotice(ip, failedByIp);
  return a || b || c;
}

const userAgentOf = (req: express.Request) => String(req.headers["user-agent"] || "").slice(0, 300);

function toStudioUser(row: any): StudioUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
    mustChangePassword: !!row.must_change_password,
    role: row.role === "admin" ? "admin" : "user",
    preferences: {
      presetDirTenant: row.preset_dir_tenant || null,
      presetDirWorkflow: row.preset_dir_workflow || null,
      lastDomain: row.last_domain || null,
      lastTenantId: row.last_tenant_id || null,
      lastTargetEnv: row.last_target_env || null,
      lastTargetService: row.last_target_service || null,
      presetDirs: row.preset_dirs && typeof row.preset_dirs === "object" ? row.preset_dirs : {}
    }
  };
}

/** Middleware: hanya admin yang boleh lanjut. Dipasang setelah middleware session (req.user sudah terisi). */
export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ code: "FORBIDDEN", error: "Hanya admin yang boleh mengakses fitur ini." });
  }
  next();
}

/** Nama yang dicatat di history (author_name) — selalu dari user login, bukan dari body request */
export interface Actor { id: string | null; name: string }

export function actor(req: express.Request, fallbackName = "Studio User", suffix = ""): Actor {
  return { id: req.user?.id ?? null, name: (req.user?.displayName ?? fallbackName) + suffix };
}

export function actorName(req: express.Request, fallback = "Studio User"): string {
  return actor(req, fallback).name;
}

/**
 * Buat tabel auth, user default (dari .env bila belum ada user), dan migrasikan
 * preset_links menjadi per-user. Idempotent: aman dijalankan setiap BFF start.
 */
export async function initAuthSchema(auditDb: Pool, esc: Esc): Promise<void> {
  await auditDb.query(`
    CREATE TABLE IF NOT EXISTS tenant_studio.studio_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      display_name text,
      is_active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT false,
      last_login_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tenant_studio.studio_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES tenant_studio.studio_users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamp NOT NULL,
      user_agent text,
      created_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_studio_sessions_user ON tenant_studio.studio_sessions (user_id);
    CREATE TABLE IF NOT EXISTS tenant_studio.studio_user_preferences (
      user_id uuid PRIMARY KEY REFERENCES tenant_studio.studio_users(id) ON DELETE CASCADE,
      preset_dir_tenant text,
      preset_dir_workflow text,
      last_domain text,
      last_tenant_id text,
      updated_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE tenant_studio.studio_user_preferences ADD COLUMN IF NOT EXISTS last_target_env text;
    ALTER TABLE tenant_studio.studio_user_preferences ADD COLUMN IF NOT EXISTS last_target_service text;
    ALTER TABLE tenant_studio.studio_user_preferences ADD COLUMN IF NOT EXISTS preset_dirs jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE tenant_studio.studio_users
      ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
        CHECK (role IN ('admin','user')),
      ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES tenant_studio.studio_users(id);
    CREATE TABLE IF NOT EXISTS tenant_studio.studio_user_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id uuid REFERENCES tenant_studio.studio_users(id),
      actor_name text NOT NULL,
      target_user_id uuid REFERENCES tenant_studio.studio_users(id),
      target_email text NOT NULL,
      action text NOT NULL,
      details jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_studio_user_events_created ON tenant_studio.studio_user_events (created_at DESC);
    ALTER TABLE tenant_studio.studio_sessions
      ADD COLUMN IF NOT EXISTS ip text,
      ADD COLUMN IF NOT EXISTS device_label text;
    CREATE TABLE IF NOT EXISTS tenant_studio.studio_login_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES tenant_studio.studio_users(id),
      email text NOT NULL,
      kind text NOT NULL,
      reason text,
      ip text,
      device_label text,
      user_agent text,
      session_id uuid,
      actor_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_studio_login_events_user ON tenant_studio.studio_login_events (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_studio_login_events_created ON tenant_studio.studio_login_events (created_at DESC);
  `);

  // User default dibuat hanya jika tabel user masih kosong
  const countRes = await auditDb.query(`SELECT count(*)::int AS n FROM tenant_studio.studio_users;`);
  if (countRes.rows[0].n === 0) {
    const email = (process.env.STUDIO_DEFAULT_EMAIL || "").trim().toLowerCase();
    const password = process.env.STUDIO_DEFAULT_PASSWORD || "";
    if (!email || !password) {
      console.warn("⚠️  Belum ada user Studio. Isi STUDIO_DEFAULT_EMAIL & STUDIO_DEFAULT_PASSWORD di .env lalu restart BFF.");
    } else {
      const hash = await hashPassword(password);
      await auditDb.query(`
        INSERT INTO tenant_studio.studio_users (email, password_hash, display_name, must_change_password, role)
        VALUES (${esc(email)}, ${esc(hash)}, ${esc(email.split("@")[0])}, true, 'admin');
      `);
      console.log(`👤 User default Studio dibuat: ${email} (wajib ganti password saat login pertama)`);
    }
  }

  // Bootstrap admin: bila belum ada admin, pakai STUDIO_DEFAULT_EMAIL, atau user aktif tertua
  await auditDb.query(`
    UPDATE tenant_studio.studio_users SET role = 'admin'
    WHERE id = COALESCE(
            (SELECT id FROM tenant_studio.studio_users WHERE email = ${esc((process.env.STUDIO_DEFAULT_EMAIL || "").trim().toLowerCase())} AND is_active),
            (SELECT id FROM tenant_studio.studio_users WHERE is_active ORDER BY created_at LIMIT 1))
      AND NOT EXISTS (SELECT 1 FROM tenant_studio.studio_users WHERE role = 'admin');
  `);

  // preset_links per user: tambah user_id, isi baris lama ke user tertua, lalu ganti primary key
  await auditDb.query(`ALTER TABLE tenant_studio.preset_links ADD COLUMN IF NOT EXISTS user_id uuid;`);
  const pk = await auditDb.query(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'tenant_studio.preset_links'::regclass AND contype = 'p';
  `);
  if (!pk.rows[0] || !String(pk.rows[0].def).includes("user_id")) {
    const owner = await auditDb.query(`SELECT id FROM tenant_studio.studio_users ORDER BY created_at ASC LIMIT 1;`);
    if (!owner.rows[0]) {
      console.warn("⚠️  Migrasi preset_links per-user ditunda: belum ada user Studio.");
      return;
    }
    await auditDb.query(`
      UPDATE tenant_studio.preset_links SET user_id = ${esc(owner.rows[0].id)} WHERE user_id IS NULL;
      ALTER TABLE tenant_studio.preset_links ALTER COLUMN user_id SET NOT NULL;
      ALTER TABLE tenant_studio.preset_links DROP CONSTRAINT IF EXISTS preset_links_pkey;
      ALTER TABLE tenant_studio.preset_links ADD PRIMARY KEY (user_id, tenant_id, config_type);
    `);
    console.log("🔗 preset_links dimigrasikan menjadi per-user.");
  }
}

async function loadUserById(auditDb: Pool, esc: Esc, userId: string): Promise<StudioUser | null> {
  const r = await auditDb.query(`
    SELECT u.id, u.email, u.display_name, u.must_change_password, u.role,
           p.preset_dir_tenant, p.preset_dir_workflow, p.last_domain, p.last_tenant_id, p.last_target_env,
           p.last_target_service, p.preset_dirs
    FROM tenant_studio.studio_users u
    LEFT JOIN tenant_studio.studio_user_preferences p ON p.user_id = u.id
    WHERE u.id = ${esc(userId)} AND u.is_active = true;
  `);
  return r.rows[0] ? toStudioUser(r.rows[0]) : null;
}

/** Daftarkan endpoint /api/auth/* + middleware yang mewajibkan login untuk /api lainnya */
export function registerAuth(app: express.Express, auditDb: Pool, esc: Esc) {
  app.post("/api/auth/login", async (req, res) => {
    try {
      const rawEmail = req.body?.email;
      const rawPassword = req.body?.password;
      // Input tidak wajar ditolak sebelum menyentuh peta kunci, DB, atau event (cegah memori membengkak)
      const bad =
        (rawEmail != null && typeof rawEmail !== "string") ||
        (rawPassword != null && typeof rawPassword !== "string") ||
        (rawEmail ?? "").length > MAX_EMAIL_LENGTH ||
        (rawPassword ?? "").length > MAX_PASSWORD_LENGTH;
      if (bad) return res.status(401).json({ error: "Email atau password salah." });
      const email = String(rawEmail || "").trim().toLowerCase();
      const password = String(rawPassword || "");
      const lockIp = req.ip ?? "unknown";
      const ua = userAgentOf(req);
      const ip = req.ip ?? null;
      const lockedMs = loginLockRemainingMs(email, lockIp);
      if (lockedMs > 0) {
        if (consumeAnyLockNotice(email, lockIp)) {
          const known = await auditDb.query(`SELECT id FROM tenant_studio.studio_users WHERE email = ${esc(email)};`);
          await recordLoginEvent(auditDb, { userId: known.rows[0]?.id ?? null, email, kind: "login_terkunci", ip, userAgent: ua });
        }
        return res.status(429).json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(lockedMs / 60000)} menit.` });
      }
      if (!email || !password) {
        return res.status(400).json({ error: "Email dan password wajib diisi." });
      }

      const r = await auditDb.query(`
        SELECT id, password_hash, is_active FROM tenant_studio.studio_users
        WHERE email = ${esc(email)};
      `);
      const row = r.rows[0];
      const passwordOk = row ? await verifyPassword(password, row.password_hash) : false;
      if (!row || !row.is_active || !passwordOk) {
        const reason = !row ? "tidak_terdaftar" : !row.is_active ? "nonaktif" : "password_salah";
        recordFailedAttempt(email, lockIp); // sinkron, sebelum await apa pun
        await recordLoginEvent(auditDb, { userId: row?.id ?? null, email, kind: "login_gagal", reason, ip, userAgent: ua });
        return res.status(401).json({ error: "Email atau password salah." });
      }
      clearFailedAttempts(email, lockIp);

      const token = randomBytes(32).toString("base64url");
      const ins = await auditDb.query(`
        INSERT INTO tenant_studio.studio_sessions (user_id, token_hash, expires_at, user_agent, ip, device_label)
        VALUES (${esc(row.id)}, ${esc(hashToken(token))}, NOW() + INTERVAL '${SESSION_TTL_DAYS} days', ${esc(ua)}, ${esc(ip)}, ${esc(deviceLabel(ua))})
        RETURNING id;
      `);
      await auditDb.query(`
        UPDATE tenant_studio.studio_users SET last_login_at = NOW() WHERE id = ${esc(row.id)};
        DELETE FROM tenant_studio.studio_sessions WHERE expires_at < NOW();
      `);
      await recordLoginEvent(auditDb, { userId: row.id, email, kind: "login_berhasil", ip, userAgent: ua, sessionId: ins.rows[0]?.id ?? null });
      setSessionCookie(res, token);
      res.json({ user: await loadUserById(auditDb, esc, row.id) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Middleware: semua /api selain login wajib punya session valid
  app.use("/api", async (req, res, next) => {
    if (req.path === "/auth/login") return next();
    try {
      const token = readCookie(req, SESSION_COOKIE);
      if (!token) return res.status(401).json({ code: "UNAUTHENTICATED", error: "Silakan login terlebih dahulu." });

      const s = await auditDb.query(`
        SELECT id, user_id, expires_at, last_seen_at, ip, user_agent FROM tenant_studio.studio_sessions
        WHERE token_hash = ${esc(hashToken(token))} AND expires_at > NOW();
      `);
      const session = s.rows[0];
      if (!session) {
        setSessionCookie(res, null);
        return res.status(401).json({ code: "UNAUTHENTICATED", error: "Sesi berakhir. Silakan login kembali." });
      }
      const user = await loadUserById(auditDb, esc, session.user_id);
      if (!user) {
        setSessionCookie(res, null);
        return res.status(401).json({ code: "UNAUTHENTICATED", error: "User tidak aktif." });
      }

      // Sliding session: perpanjang paling sering 1x per jam agar tidak menulis DB di setiap request
      if (Date.now() - new Date(session.last_seen_at).getTime() > 60 * 60 * 1000) {
        await auditDb.query(`
          UPDATE tenant_studio.studio_sessions
          SET last_seen_at = NOW(), expires_at = NOW() + INTERVAL '${SESSION_TTL_DAYS} days'
          WHERE id = ${esc(session.id)};
        `);
        setSessionCookie(res, token);
      }

      req.user = user;
      req.sessionId = session.id;
      if (req.ip && req.ip !== session.ip) {
        await auditDb.query(`
          UPDATE tenant_studio.studio_sessions
          SET ip = ${esc(req.ip)}, device_label = ${esc(deviceLabel(userAgentOf(req)))}
          WHERE id = ${esc(session.id)};
        `);
      }
      // User yang wajib ganti password hanya boleh mengakses endpoint auth
      if (user.mustChangePassword && !req.path.startsWith("/auth/")) {
        return res.status(403).json({ code: "PASSWORD_CHANGE_REQUIRED", error: "Ganti password terlebih dahulu." });
      }
      next();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: req.user });
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) {
        const found = await auditDb.query(`
          SELECT s.id, s.user_id, u.email FROM tenant_studio.studio_sessions s
          JOIN tenant_studio.studio_users u ON u.id = s.user_id
          WHERE s.token_hash = ${esc(hashToken(token))};
        `);
        await auditDb.query(`DELETE FROM tenant_studio.studio_sessions WHERE token_hash = ${esc(hashToken(token))};`);
        const s = found.rows[0];
        if (s) {
          await recordLoginEvent(auditDb, { userId: s.user_id, email: s.email, kind: "logout", ip: req.ip ?? null, userAgent: userAgentOf(req), sessionId: s.id });
        }
      }
      setSessionCookie(res, null);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/change-password", async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `Password baru minimal ${MIN_PASSWORD_LENGTH} karakter.` });
      }
      if (newPassword === currentPassword) {
        return res.status(400).json({ error: "Password baru harus berbeda dari password lama." });
      }
      const r = await auditDb.query(`SELECT password_hash FROM tenant_studio.studio_users WHERE id = ${esc(req.user!.id)};`);
      if (!r.rows[0] || !(await verifyPassword(String(currentPassword || ""), r.rows[0].password_hash))) {
        return res.status(400).json({ error: "Password lama salah." });
      }
      const token = readCookie(req, SESSION_COOKIE);
      await auditDb.query(`
        UPDATE tenant_studio.studio_users
        SET password_hash = ${esc(await hashPassword(newPassword))}, must_change_password = false, updated_at = NOW()
        WHERE id = ${esc(req.user!.id)};
        DELETE FROM tenant_studio.studio_sessions
        WHERE user_id = ${esc(req.user!.id)} AND token_hash <> ${esc(hashToken(token || ""))};
      `);
      res.json({ success: true, user: await loadUserById(auditDb, esc, req.user!.id) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Preferensi per user (folder preset per domain, domain & tenant terakhir). Field yang tidak dikirim tidak diubah.
  app.put("/api/me/preferences", async (req, res) => {
    try {
      const body = req.body || {};
      const cols: Record<string, string> = {
        presetDirTenant: "preset_dir_tenant",
        presetDirWorkflow: "preset_dir_workflow",
        lastDomain: "last_domain",
        lastTenantId: "last_tenant_id",
        lastTargetEnv: "last_target_env",
        lastTargetService: "last_target_service"
      };
      const entries = Object.entries(cols).filter(([k]) => k in body);
      const dirs = body.presetDirs;
      const hasDirs = dirs !== undefined;
      if (entries.length === 0 && !hasDirs) return res.status(400).json({ error: "Tidak ada preferensi yang dikirim." });
      if (hasDirs) {
        const ok = dirs && typeof dirs === "object" && !Array.isArray(dirs) &&
          Object.entries(dirs).every(([k, v]) => /^[a-z_]+:[a-z_]+$/.test(k) && (v === null || typeof v === "string"));
        if (!ok) return res.status(400).json({ error: "presetDirs harus objek { '<layanan>:<domain>': string | null }." });
      }
      for (const [k] of entries) {
        if (body[k] !== null && typeof body[k] !== "string") {
          return res.status(400).json({ error: `${k} harus berupa string.` });
        }
      }
      const colList = entries.map(([, c]) => c);
      const valList = entries.map(([k]) => (body[k] ? esc(String(body[k]).trim()) : "NULL"));
      const updList = entries.map(([, c]) => `${c} = EXCLUDED.${c}`);
      if (hasDirs) {
        // Gabung dengan nilai lama: kunci bernilai null/kosong dihapus, sisanya ditimpa
        const set: Record<string, string> = {};
        const del: string[] = [];
        for (const [k, v] of Object.entries(dirs as Record<string, string | null>)) {
          if (v && v.trim()) set[k] = v.trim();
          else del.push(k);
        }
        const delSql = del.map((k) => ` - ${esc(k)}`).join("");
        colList.push("preset_dirs");
        valList.push(`(${esc(JSON.stringify(set))}::jsonb${delSql})`);
        updList.push(`preset_dirs = (studio_user_preferences.preset_dirs || ${esc(JSON.stringify(set))}::jsonb)${delSql}`);
      }
      await auditDb.query(`
        INSERT INTO tenant_studio.studio_user_preferences (user_id, ${colList.join(", ")}, updated_at)
        VALUES (${esc(req.user!.id)}, ${valList.join(", ")}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET ${updList.join(", ")}, updated_at = NOW();
      `);
      res.json({ success: true, user: await loadUserById(auditDb, esc, req.user!.id) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
