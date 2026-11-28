import { esc } from "../db.js";
import { deviceLabel } from "./device.js";

// Riwayat login (tabel studio_login_events). Tidak pernah memuat password/hash/token.

export type LoginEventKind = "login_berhasil" | "login_gagal" | "login_terkunci" | "logout" | "dikeluarkan";
export type LoginFailReason = "password_salah" | "tidak_terdaftar" | "nonaktif";

export interface LoginEventInput {
  userId: string | null;
  email: string;
  kind: LoginEventKind;
  reason?: LoginFailReason | null;
  ip: string | null;
  userAgent: string | null;
  sessionId?: string | null;
  actorName?: string | null;
}

const MAX_EMAIL = 254;
const MAX_UA = 300;
const MAX_ACTOR = 100;

const cut = (v: string | null | undefined, n: number) => (v == null ? null : v.slice(0, n));

export function buildLoginEventSql(e: LoginEventInput): string {
  return `
    INSERT INTO tenant_studio.studio_login_events (user_id, email, kind, reason, ip, device_label, user_agent, session_id, actor_name)
    VALUES (${esc(e.userId)}, ${esc(cut(e.email, MAX_EMAIL))}, ${esc(e.kind)}, ${esc(e.reason ?? null)}, ${esc(cut(e.ip, 64))},
            ${esc(deviceLabel(e.userAgent))}, ${esc(cut(e.userAgent, MAX_UA))}, ${esc(e.sessionId ?? null)},
            ${esc(cut(e.actorName, MAX_ACTOR))});
  `;
}

/** Mencatat event; kegagalan pencatatan tidak boleh menggagalkan login/logout. */
export async function recordLoginEvent(db: { query(sql: string): Promise<unknown> }, e: LoginEventInput): Promise<void> {
  try {
    await db.query(buildLoginEventSql(e));
  } catch (err: any) {
    console.error("Gagal mencatat event login:", err?.message ?? err);
  }
}

export interface LoginEventRow {
  id: string;
  email: string;
  kind: LoginEventKind;
  reason: LoginFailReason | null;
  deviceLabel: string;
  ip: string | null;
  actorName: string | null;
  createdAt: string;
  userRegistered: boolean;
}

export function toLoginEventRow(row: any): LoginEventRow {
  return {
    id: row.id,
    email: row.email,
    kind: row.kind,
    reason: row.reason ?? null,
    deviceLabel: row.device_label || deviceLabel(row.user_agent),
    ip: row.ip ?? null,
    actorName: row.actor_name ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    userRegistered: row.user_id != null
  };
}
