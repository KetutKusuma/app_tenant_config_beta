import express from "express";
import type { PoolClient } from "pg";
import { auditDb, esc } from "../db";
import { hashPassword, requireAdmin } from "../auth";
import {
  checkUserChange,
  describeUpdate,
  generateTempPassword,
  parseCreateUserBody,
  parseUpdateUserBody,
  type Role,
  type UserAction
} from "../users/rules";
import { UUID_RE, parsePageQuery } from "../users/sessions";

// Route admin: kelola akun Studio (/api/admin/users) + log aktivitas akun (/api/admin/user-events).
// Akun tidak pernah dihapus, hanya dinonaktifkan. Password/hash tidak pernah masuk log atau event.

export const router = express.Router();

const NOT_FOUND = "Akun tidak ditemukan.";
const FORBIDDEN = "Hanya admin yang boleh mengakses fitur ini.";

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  createdByName: string | null;
}

const toIso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

function toAdminUserRow(row: any): AdminUserRow {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
    role: row.role === "admin" ? "admin" : "user",
    isActive: !!row.is_active,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: toIso(row.last_login_at),
    createdAt: toIso(row.created_at)!,
    createdByName: row.created_by_name ?? null
  };
}

// last_login_at/created_at bertipe timestamp (tanpa zona) yang diisi NOW() menurut zona sesi DB;
// ubah ke timestamptz di SQL agar node-pg tidak menafsirkannya sebagai waktu lokal mesin BFF.
const SELECT_USERS = `
  SELECT u.id, u.email, u.display_name, u.role, u.is_active, u.must_change_password,
         u.last_login_at AT TIME ZONE current_setting('TimeZone') AS last_login_at,
         u.created_at AT TIME ZONE current_setting('TimeZone') AS created_at,
         c.display_name AS created_by_name
  FROM tenant_studio.studio_users u
  LEFT JOIN tenant_studio.studio_users c ON c.id = u.created_by`;

async function loadAdminUserRow(c: PoolClient, id: string): Promise<AdminUserRow> {
  const r = await c.query(`${SELECT_USERS} WHERE u.id = ${esc(id)};`);
  return toAdminUserRow(r.rows[0]);
}

async function writeEvent(
  c: PoolClient,
  req: express.Request,
  target: { id: string; email: string },
  action: UserAction,
  details: Record<string, unknown>
) {
  await c.query(`
    INSERT INTO tenant_studio.studio_user_events (actor_user_id, actor_name, target_user_id, target_email, action, details)
    VALUES (${esc(req.user!.id)}, ${esc(req.user!.displayName)}, ${esc(target.id)}, ${esc(target.email)},
            ${esc(action)}, ${esc(JSON.stringify(details))}::jsonb);
  `);
}

/**
 * Kunci semua baris admin aktif lalu baris target (urutan tetap agar tidak deadlock).
 * Mengembalikan jumlah admin aktif SEBELUM perubahan, apakah aktor masih admin aktif (bisa saja
 * baru diturunkan oleh request serentak), dan baris target (null bila tidak ada).
 */
async function lockAdminsAndTarget(c: PoolClient, id: string, actorId: string) {
  const admins = await c.query(`
    SELECT id FROM tenant_studio.studio_users WHERE role = 'admin' AND is_active ORDER BY id FOR UPDATE;
  `);
  const t = await c.query(`
    SELECT id, email, display_name, role, is_active FROM tenant_studio.studio_users WHERE id = ${esc(id)} FOR UPDATE;
  `);
  return {
    activeAdminCount: admins.rows.length,
    actorIsAdmin: admins.rows.some((r) => r.id === actorId),
    target: t.rows[0] ?? null
  };
}

async function rollback(c: PoolClient) {
  await c.query("ROLLBACK").catch(() => undefined);
}

router.use("/api/admin", requireAdmin);

router.get("/api/admin/users", async (_req, res) => {
  try {
    const r = await auditDb.query(`${SELECT_USERS} ORDER BY u.created_at ASC;`);
    res.json({ data: r.rows.map(toAdminUserRow) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/admin/users", async (req, res) => {
  const parsed = parseCreateUserBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { email, displayName, role, password } = parsed.value;
  const tempPassword = password ?? generateTempPassword();

  const c = await auditDb.connect();
  try {
    await c.query("BEGIN");
    const ins = await c.query(`
      INSERT INTO tenant_studio.studio_users (email, password_hash, display_name, role, must_change_password, created_by)
      VALUES (${esc(email)}, ${esc(await hashPassword(tempPassword))}, ${esc(displayName)}, ${esc(role)}, true, ${esc(req.user!.id)})
      RETURNING id;
    `);
    const id = ins.rows[0].id as string;
    await writeEvent(c, req, { id, email }, "create", { role, displayName });
    const user = await loadAdminUserRow(c, id);
    await c.query("COMMIT");
    res.status(201).json({ user, tempPassword });
  } catch (err: any) {
    await rollback(c);
    if (err?.code === "23505") return res.status(409).json({ error: "Email sudah terdaftar." });
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

router.patch("/api/admin/users/:id", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: NOT_FOUND });
  const parsed = parseUpdateUserBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const change = parsed.value;

  const c = await auditDb.connect();
  try {
    await c.query("BEGIN");
    const { activeAdminCount, actorIsAdmin, target } = await lockAdminsAndTarget(c, id, req.user!.id);
    if (!actorIsAdmin) {
      await rollback(c);
      return res.status(403).json({ code: "FORBIDDEN", error: FORBIDDEN });
    }
    if (!target) {
      await rollback(c);
      return res.status(404).json({ error: NOT_FOUND });
    }
    const role: Role = target.role === "admin" ? "admin" : "user";
    const check = checkUserChange({
      actorId: req.user!.id,
      target: { id: target.id, role, isActive: !!target.is_active },
      action: "update",
      change: { role: change.role, isActive: change.isActive },
      activeAdminCount
    });
    if (!check.ok) {
      await rollback(c);
      return res.status(check.status).json({ error: check.error });
    }

    const desc = describeUpdate(
      { displayName: target.display_name ?? "", role, isActive: !!target.is_active },
      change
    );
    if (desc) {
      const sets: string[] = [];
      if (desc.details.displayName) sets.push(`display_name = ${esc(change.displayName)}`);
      if (desc.details.role) sets.push(`role = ${esc(change.role)}`);
      if (desc.details.isActive) sets.push(`is_active = ${esc(change.isActive)}`);
      await c.query(`
        UPDATE tenant_studio.studio_users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ${esc(id)};
      `);
      if (change.isActive === false) {
        await c.query(`DELETE FROM tenant_studio.studio_sessions WHERE user_id = ${esc(id)};`);
      }
      await writeEvent(c, req, { id, email: target.email }, desc.action, desc.details);
    }
    const user = await loadAdminUserRow(c, id);
    await c.query("COMMIT");
    res.json({ user });
  } catch (err: any) {
    await rollback(c);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

router.post("/api/admin/users/:id/reset-password", async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: NOT_FOUND });
  const raw = req.body?.password;
  let password: string | null = null;
  if (raw !== undefined && raw !== null && raw !== "") {
    if (typeof raw !== "string" || raw.length < 8) return res.status(400).json({ error: "Password minimal 8 karakter." });
    password = raw;
  }
  const tempPassword = password ?? generateTempPassword();

  const c = await auditDb.connect();
  try {
    await c.query("BEGIN");
    const { activeAdminCount, actorIsAdmin, target } = await lockAdminsAndTarget(c, id, req.user!.id);
    if (!actorIsAdmin) {
      await rollback(c);
      return res.status(403).json({ code: "FORBIDDEN", error: FORBIDDEN });
    }
    if (!target) {
      await rollback(c);
      return res.status(404).json({ error: NOT_FOUND });
    }
    const check = checkUserChange({
      actorId: req.user!.id,
      target: { id: target.id, role: target.role === "admin" ? "admin" : "user", isActive: !!target.is_active },
      action: "reset_password",
      activeAdminCount
    });
    if (!check.ok) {
      await rollback(c);
      return res.status(check.status).json({ error: check.error });
    }
    await c.query(`
      UPDATE tenant_studio.studio_users
      SET password_hash = ${esc(await hashPassword(tempPassword))}, must_change_password = true, updated_at = NOW()
      WHERE id = ${esc(id)};
    `);
    await c.query(`DELETE FROM tenant_studio.studio_sessions WHERE user_id = ${esc(id)};`);
    await writeEvent(c, req, { id, email: target.email }, "reset_password", {});
    await c.query("COMMIT");
    res.json({ tempPassword });
  } catch (err: any) {
    await rollback(c);
    res.status(500).json({ error: err.message });
  } finally {
    c.release();
  }
});

router.get("/api/admin/user-events", async (req, res) => {
  try {
    const { limit, before } = parsePageQuery(req.query);
    const where = before ? `WHERE date_trunc('milliseconds', created_at) < ${esc(before)}::timestamptz` : "";
    const r = await auditDb.query(`
      SELECT id, actor_name, target_email, action, details, created_at
      FROM tenant_studio.studio_user_events
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit};
    `);
    const data = r.rows.map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      targetEmail: row.target_email,
      action: row.action,
      details: row.details ?? {},
      createdAt: toIso(row.created_at)!
    }));
    const nextBefore = data.length === limit ? data[data.length - 1].createdAt : null;
    res.json({ data, nextBefore });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
