import { deviceLabel } from "./device.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionRow {
  id: string;
  deviceLabel: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

const iso = (v: unknown) => new Date(v as string).toISOString();

/** Pemetaan baris studio_sessions; token_hash dan user_agent mentah sengaja tidak ikut. */
export function toSessionRow(row: any, currentSessionId: string | null): SessionRow {
  return {
    id: row.id,
    deviceLabel: row.device_label || deviceLabel(row.user_agent),
    ip: row.ip ?? null,
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at),
    expiresAt: iso(row.expires_at),
    current: currentSessionId != null && row.id === currentSessionId
  };
}

/** limit 1..200 (default 50); before hanya diterima bila tanggal valid, dikembalikan sebagai ISO. */
export function parsePageQuery(q: { limit?: unknown; before?: unknown }): { limit: number; before: string | null } {
  const n = parseInt(String(q.limit ?? ""), 10);
  const limit = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : 50;
  const raw = typeof q.before === "string" ? q.before : "";
  const d = raw ? new Date(raw) : null;
  return { limit, before: d && !isNaN(d.getTime()) ? d.toISOString() : null };
}
