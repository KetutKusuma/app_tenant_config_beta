import type express from "express";
import type { Pool } from "pg";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";

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
  preferences: {
    presetDirTenant: string | null;
    presetDirWorkflow: string | null;
    lastDomain: string | null;
    lastTenantId: string | null;
    lastTargetEnv: string | null;
    lastTargetService?: string | null;
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: StudioUser;
    }
  }
}

type Esc = (val: any) => string;

// Format hash: scrypt$<salt hex>$<hash hex>
async function hashPassword(password: string): Promise<string> {
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
const failedLogins = new Map<string, { count: number; until: number }>();
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

function loginLockedMs(key: string): number {
  const entry = failedLogins.get(key);
  if (!entry) return 0;
  if (entry.until && entry.until > Date.now()) return entry.until - Date.now();
  if (entry.until && entry.until <= Date.now()) failedLogins.delete(key);
  return 0;
}
function recordFailedLogin(key: string) {
  const entry = failedLogins.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED) entry.until = Date.now() + LOCK_MS;
  failedLogins.set(key, entry);
}

function toStudioUser(row: any): StudioUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
    mustChangePassword: !!row.must_change_password,
    preferences: {
      presetDirTenant: row.preset_dir_tenant || null,
      presetDirWorkflow: row.preset_dir_workflow || null,
      lastDomain: row.last_domain || null,
      lastTenantId: row.last_tenant_id || null,
      lastTargetEnv: row.last_target_env || null
    }
  };
}

/** Nama yang dicatat di history (author_name) — selalu dari user login, bukan dari body request */
export function actorName(req: express.Request, fallback = "Studio User"): string {
  return req.user ? req.user.displayName : fallback;
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
        INSERT INTO tenant_studio.studio_users (email, password_hash, display_name, must_change_password)
        VALUES (${esc(email)}, ${esc(hash)}, ${esc(email.split("@")[0])}, true);
      `);
      console.log(`👤 User default Studio dibuat: ${email} (wajib ganti password saat login pertama)`);
    }
  }

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
    SELECT u.id, u.email, u.display_name, u.must_change_password,
           p.preset_dir_tenant, p.preset_dir_workflow, p.last_domain, p.last_tenant_id, p.last_target_env
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
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      const lockKey = `${email}|${req.ip}`;
      const lockedMs = loginLockedMs(lockKey);
      if (lockedMs > 0) {
        return res.status(429).json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(lockedMs / 60000)} menit.` });
      }
      if (!email || !password) {
        return res.status(400).json({ error: "Email dan password wajib diisi." });
      }

      const r = await auditDb.query(`
        SELECT id, password_hash FROM tenant_studio.studio_users
        WHERE email = ${esc(email)} AND is_active = true;
      `);
      const row = r.rows[0];
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        recordFailedLogin(lockKey);
        return res.status(401).json({ error: "Email atau password salah." });
      }
      failedLogins.delete(lockKey);

      const token = randomBytes(32).toString("base64url");
      await auditDb.query(`
        INSERT INTO tenant_studio.studio_sessions (user_id, token_hash, expires_at, user_agent)
        VALUES (${esc(row.id)}, ${esc(hashToken(token))}, NOW() + INTERVAL '${SESSION_TTL_DAYS} days', ${esc(String(req.headers["user-agent"] || "").slice(0, 300))});
        UPDATE tenant_studio.studio_users SET last_login_at = NOW() WHERE id = ${esc(row.id)};
        DELETE FROM tenant_studio.studio_sessions WHERE expires_at < NOW();
      `);
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
        SELECT id, user_id, expires_at, last_seen_at FROM tenant_studio.studio_sessions
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
        await auditDb.query(`DELETE FROM tenant_studio.studio_sessions WHERE token_hash = ${esc(hashToken(token))};`);
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
        lastTargetEnv: "last_target_env"
      };
      const entries = Object.entries(cols).filter(([k]) => k in body);
      if (entries.length === 0) return res.status(400).json({ error: "Tidak ada preferensi yang dikirim." });
      for (const [k] of entries) {
        if (body[k] !== null && typeof body[k] !== "string") {
          return res.status(400).json({ error: `${k} harus berupa string.` });
        }
      }
      const colList = entries.map(([, c]) => c).join(", ");
      const valList = entries.map(([k]) => (body[k] ? esc(String(body[k]).trim()) : "NULL")).join(", ");
      const updList = entries.map(([, c]) => `${c} = EXCLUDED.${c}`).join(", ");
      await auditDb.query(`
        INSERT INTO tenant_studio.studio_user_preferences (user_id, ${colList}, updated_at)
        VALUES (${esc(req.user!.id)}, ${valList}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET ${updList}, updated_at = NOW();
      `);
      res.json({ success: true, user: await loadUserById(auditDb, esc, req.user!.id) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
