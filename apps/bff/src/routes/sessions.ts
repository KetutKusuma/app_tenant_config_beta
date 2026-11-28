import express from "express";
import { auditDb, esc } from "../db.js";
import { buildLoginEventSql, toLoginEventRow } from "../users/loginEvents.js";
import { UUID_RE, parsePageQuery, toSessionRow } from "../users/sessions.js";

// Perangkat aktif & riwayat login. token_hash tidak pernah dipilih ke respons.

export const router = express.Router();

export const SESSION_NOT_FOUND = "Sesi tidak ditemukan.";
export const USE_LOGOUT = "Gunakan Logout untuk perangkat ini.";

// Kolom timestamp sesi bertipe tanpa zona (diisi NOW() menurut zona DB): ubah ke timestamptz di SQL
// agar node-pg tidak menafsirkannya sebagai waktu lokal mesin BFF.
const TZ = "current_setting('TimeZone')";
const SESSION_COLS = `id, device_label, user_agent, ip,
  created_at AT TIME ZONE ${TZ} AS created_at, last_seen_at AT TIME ZONE ${TZ} AS last_seen_at,
  expires_at AT TIME ZONE ${TZ} AS expires_at`;

export const LOGIN_EVENT_SELECT = `
  SELECT id, user_id, email, kind, reason, device_label, user_agent, ip, actor_name,
         created_at
  FROM tenant_studio.studio_login_events`;

export async function listSessions(userId: string, currentSessionId: string | null) {
  const r = await auditDb.query(`
    SELECT ${SESSION_COLS} FROM tenant_studio.studio_sessions
    WHERE user_id = ${esc(userId)} AND expires_at > NOW()
    ORDER BY last_seen_at DESC;
  `);
  return r.rows.map((row) => toSessionRow(row, currentSessionId));
}

export async function listLoginEvents(query: any, userId: string | null) {
  const { limit, before } = parsePageQuery(query);
  const conds: string[] = [];
  if (userId) conds.push(`user_id = ${esc(userId)}`);
  if (before) conds.push(`date_trunc('milliseconds', created_at) < ${esc(before)}::timestamptz`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await auditDb.query(`${LOGIN_EVENT_SELECT} ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit};`);
  const data = r.rows.map(toLoginEventRow);
  const nextBefore = data.length === limit ? data[data.length - 1].createdAt : null;
  return { data, nextBefore };
}

/**
 * Keluarkan satu sesi milik `owner` (cek pemilik ada di WHERE). Validasi (UUID, sesi aktif) dilakukan
 * sebelum query. Mengembalikan { status, body } agar dipakai bersama oleh route sendiri dan admin.
 */
export async function revokeSession(
  req: express.Request,
  owner: { id: string; email: string },
  sid: string,
  asAdmin: boolean
): Promise<{ status: number; body: any }> {
  if (!UUID_RE.test(sid)) return { status: 404, body: { error: SESSION_NOT_FOUND } };
  if (req.sessionId && sid.toLowerCase() === req.sessionId.toLowerCase()) {
    return { status: 400, body: { error: USE_LOGOUT } };
  }
  const c = await auditDb.connect();
  try {
    await c.query("BEGIN");
    const del = await c.query(`
      DELETE FROM tenant_studio.studio_sessions
      WHERE id = ${esc(sid)} AND user_id = ${esc(owner.id)}
      RETURNING id, ip, device_label, user_agent;
    `);
    if (del.rows.length === 0) {
      await c.query("ROLLBACK").catch(() => undefined);
      return { status: 404, body: { error: SESSION_NOT_FOUND } };
    }
    const s = del.rows[0];
    await c.query(buildLoginEventSql({
      kind: "dikeluarkan", userId: owner.id, email: owner.email, sessionId: s.id,
      actorName: req.user!.displayName, ip: s.ip ?? null, userAgent: s.user_agent ?? null
    }));
    if (asAdmin) {
      await c.query(`
        INSERT INTO tenant_studio.studio_user_events (actor_user_id, actor_name, target_user_id, target_email, action, details)
        VALUES (${esc(req.user!.id)}, ${esc(req.user!.displayName)}, ${esc(owner.id)}, ${esc(owner.email)},
                'revoke_session', ${esc(JSON.stringify({ device: s.device_label ?? null, ip: s.ip ?? null }))}::jsonb);
      `);
    }
    await c.query("COMMIT");
    return { status: 200, body: { success: true } };
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

router.get("/api/auth/sessions", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Belum masuk." });
  try {
    res.json({ data: await listSessions(req.user.id, req.sessionId ?? null) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/auth/sessions/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Belum masuk." });
  try {
    const r = await revokeSession(req, { id: req.user.id, email: req.user.email }, req.params.id, false);
    res.status(r.status).json(r.body);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/auth/login-history", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Belum masuk." });
  try {
    res.json(await listLoginEvents(req.query, req.user.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
