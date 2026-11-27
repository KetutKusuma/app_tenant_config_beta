import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkUserChange,
  describeUpdate,
  generateTempPassword,
  normalizeEmail,
  parseCreateUserBody,
  parseUpdateUserBody,
} from "./rules.js";

test("normalizeEmail", () => {
  assert.equal(normalizeEmail(" Budi@X.com "), "budi@x.com");
  assert.equal(normalizeEmail(5), "");
});

test("parseCreateUserBody: email tidak valid", () => {
  assert.deepEqual(parseCreateUserBody({ email: "budi@x" }), { ok: false, error: "Format email tidak valid." });
});

test("parseCreateUserBody: default", () => {
  assert.deepEqual(parseCreateUserBody({ email: "Budi@X.com" }), {
    ok: true,
    value: { email: "budi@x.com", displayName: "budi", role: "user", password: null },
  });
});

test("parseCreateUserBody: error lain", () => {
  assert.deepEqual(parseCreateUserBody({ email: "a@b.co", role: "viewer" }), { ok: false, error: "Peran harus admin atau user." });
  assert.deepEqual(parseCreateUserBody({ email: "a@b.co", password: "1234567" }), { ok: false, error: "Password minimal 8 karakter." });
  assert.deepEqual(parseCreateUserBody({ email: "a@b.co", displayName: "x".repeat(101) }), {
    ok: false,
    error: "Nama tampilan maksimal 100 karakter.",
  });
  const r = parseCreateUserBody({ email: "a@b.co", password: "" });
  assert.ok(r.ok && r.value.password === null);
});

test("parseUpdateUserBody", () => {
  assert.deepEqual(parseUpdateUserBody({}), { ok: false, error: "Tidak ada perubahan yang dikirim." });
  assert.deepEqual(parseUpdateUserBody({ isActive: "false" }), { ok: false, error: "isActive harus boolean." });
  assert.deepEqual(parseUpdateUserBody({ email: "a@b.co" }), { ok: false, error: "Tidak ada perubahan yang dikirim." });
  assert.deepEqual(parseUpdateUserBody({ displayName: "  " }), { ok: false, error: "Nama tampilan tidak boleh kosong." });
  assert.deepEqual(parseUpdateUserBody({ displayName: " Bu ", role: "admin", isActive: false }), {
    ok: true,
    value: { displayName: "Bu", role: "admin", isActive: false },
  });
});

test("generateTempPassword", () => {
  const a = generateTempPassword();
  const b = generateTempPassword();
  assert.equal(a.length, 16);
  assert.notEqual(a, b);
  assert.ok(!/[0Ol1]/.test(a + b));
});

const self = { id: "u1", role: "admin" as const, isActive: true };
test("checkUserChange", () => {
  const own = "Tidak bisa menurunkan peran atau menonaktifkan akun sendiri.";
  assert.deepEqual(checkUserChange({ actorId: "u1", target: self, action: "update", change: { role: "user" }, activeAdminCount: 3 }), { ok: false, status: 403, error: own });
  assert.deepEqual(checkUserChange({ actorId: "u1", target: self, action: "update", change: { isActive: false }, activeAdminCount: 3 }), { ok: false, status: 403, error: own });
  assert.deepEqual(checkUserChange({ actorId: "u1", target: self, action: "reset_password", activeAdminCount: 3 }), {
    ok: false,
    status: 403,
    error: "Gunakan menu Ganti Password untuk akun sendiri.",
  });
  const other = { id: "u2", role: "admin" as const, isActive: true };
  assert.deepEqual(checkUserChange({ actorId: "u1", target: other, action: "update", change: { role: "user" }, activeAdminCount: 1 }), {
    ok: false,
    status: 409,
    error: "Minimal harus ada satu admin aktif.",
  });
  assert.deepEqual(checkUserChange({ actorId: "u1", target: other, action: "update", change: { isActive: false }, activeAdminCount: 2 }), { ok: true });
  assert.deepEqual(
    checkUserChange({ actorId: "u1", target: { id: "u3", role: "user", isActive: true }, action: "update", change: { isActive: false }, activeAdminCount: 1 }),
    { ok: true },
  );
  assert.deepEqual(checkUserChange({ actorId: "u1", target: self, action: "update", change: {}, activeAdminCount: 1 }), { ok: true });
});

test("describeUpdate", () => {
  const before = { displayName: "A", role: "user" as const, isActive: true };
  assert.deepEqual(describeUpdate(before, { isActive: false }), { action: "deactivate", details: { isActive: { from: true, to: false } } });
  assert.deepEqual(describeUpdate({ ...before, isActive: false }, { isActive: true })?.action, "activate");
  assert.deepEqual(describeUpdate(before, { role: "admin" }), { action: "update", details: { role: { from: "user", to: "admin" } } });
  assert.equal(describeUpdate(before, { displayName: "A", role: "user", isActive: true }), null);
});
