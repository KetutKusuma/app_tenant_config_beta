import { randomBytes } from "node:crypto";

export type Role = "admin" | "user";
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export type UserAction = "create" | "update" | "deactivate" | "activate" | "reset_password" | "revoke_session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MIN_PASSWORD = 8;

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function isRole(v: unknown): v is Role {
  return v === "admin" || v === "user";
}

export function parseCreateUserBody(
  body: unknown,
): Parsed<{ email: string; displayName: string; role: Role; password: string | null }> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const email = normalizeEmail(b.email);
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Format email tidak valid." };

  const role = b.role === undefined || b.role === null ? "user" : b.role;
  if (!isRole(role)) return { ok: false, error: "Peran harus admin atau user." };

  let password: string | null = null;
  if (typeof b.password === "string" && b.password !== "") {
    if (b.password.length < MIN_PASSWORD) return { ok: false, error: "Password minimal 8 karakter." };
    password = b.password;
  }

  let displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
  if (displayName.length > MAX_NAME) return { ok: false, error: "Nama tampilan maksimal 100 karakter." };
  if (displayName === "") displayName = email.split("@")[0];

  return { ok: true, value: { email, displayName, role, password } };
}

export function parseUpdateUserBody(
  body: unknown,
): Parsed<{ displayName?: string; role?: Role; isActive?: boolean }> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const value: { displayName?: string; role?: Role; isActive?: boolean } = {};

  if (b.displayName !== undefined) {
    const name = typeof b.displayName === "string" ? b.displayName.trim() : "";
    if (name === "") return { ok: false, error: "Nama tampilan tidak boleh kosong." };
    if (name.length > MAX_NAME) return { ok: false, error: "Nama tampilan maksimal 100 karakter." };
    value.displayName = name;
  }
  if (b.role !== undefined) {
    if (!isRole(b.role)) return { ok: false, error: "Peran harus admin atau user." };
    value.role = b.role;
  }
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== "boolean") return { ok: false, error: "isActive harus boolean." };
    value.isActive = b.isActive;
  }
  if (Object.keys(value).length === 0) return { ok: false, error: "Tidak ada perubahan yang dikirim." };
  return { ok: true, value };
}

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generateTempPassword(): string {
  const n = PASSWORD_ALPHABET.length;
  const limit = 256 - (256 % n); // rejection sampling: buang byte yang bikin bias
  let out = "";
  while (out.length < 16) {
    for (const byte of randomBytes(32)) {
      if (byte < limit && out.length < 16) out += PASSWORD_ALPHABET[byte % n];
    }
  }
  return out;
}

export function checkUserChange(i: {
  actorId: string;
  target: { id: string; role: Role; isActive: boolean };
  action: "update" | "reset_password";
  change?: { role?: Role; isActive?: boolean };
  activeAdminCount: number;
}): { ok: true } | { ok: false; status: 403 | 409; error: string } {
  const change = i.change ?? {};
  const isSelf = i.actorId === i.target.id;

  if (isSelf && i.action === "reset_password") {
    return { ok: false, status: 403, error: "Gunakan menu Ganti Password untuk akun sendiri." };
  }
  if (isSelf && (change.role === "user" || change.isActive === false)) {
    return { ok: false, status: 403, error: "Tidak bisa menurunkan peran atau menonaktifkan akun sendiri." };
  }
  const wouldRemoveAdmin =
    i.target.role === "admin" && i.target.isActive && (change.role === "user" || change.isActive === false);
  if (wouldRemoveAdmin && i.activeAdminCount <= 1) {
    return { ok: false, status: 409, error: "Minimal harus ada satu admin aktif." };
  }
  return { ok: true };
}

export function describeUpdate(
  before: { displayName: string; role: Role; isActive: boolean },
  change: { displayName?: string; role?: Role; isActive?: boolean },
): { action: UserAction; details: Record<string, { from: unknown; to: unknown }> } | null {
  const details: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ["displayName", "role", "isActive"] as const) {
    if (change[key] !== undefined && change[key] !== before[key]) {
      details[key] = { from: before[key], to: change[key] };
    }
  }
  if (Object.keys(details).length === 0) return null;
  let action: UserAction = "update";
  if (details.isActive) action = change.isActive ? "activate" : "deactivate";
  return { action, details };
}
