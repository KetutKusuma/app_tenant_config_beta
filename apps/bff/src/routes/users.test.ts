import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { router } from "./users.js";
import { requireAdmin } from "../auth.js";
import { auditDb } from "../db.js";

const U = "00000000-0000-0000-0000-000000000001";
const plainUser: any = {
  id: U, email: "u@x.co", displayName: "U", role: "user", mustChangePassword: false,
  preferences: { presetDirTenant: null, presetDirWorkflow: null, lastDomain: null, lastTenantId: null, lastTargetEnv: null, lastTargetService: null, presetDirs: {} }
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = plainUser; next(); });
app.use(router);
const server = app.listen(0);
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await new Promise((r) => server.close(r));
  await auditDb.end().catch(() => {});
});

const cases: Array<[string, string, string, any?]> = [
  ["GET", "/api/admin/users", "daftar akun"],
  ["POST", "/api/admin/users", "buat akun", { email: "a@b.co", displayName: "A", role: "user" }],
  ["PATCH", `/api/admin/users/${U}`, "ubah akun", { role: "admin" }],
  ["POST", `/api/admin/users/${U}/reset-password`, "reset password", {}],
  ["GET", "/api/admin/user-events", "log aktivitas"],
  ["GET", `/api/admin/users/${U}/sessions`, "sesi akun"],
  ["DELETE", `/api/admin/users/${U}/sessions/${U}`, "keluarkan sesi akun"],
  ["GET", "/api/admin/login-history", "riwayat login semua akun"]
];
for (const [method, path, label, body] of cases) {
  test(`user biasa ditolak 403 FORBIDDEN: ${label}`, async () => {
    const res = await fetch(base() + path, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "FORBIDDEN");
  });
}

function run(user: any) {
  let status = 0, json: any = null, nexted = false;
  const res: any = { status(c: number) { status = c; return res; }, json(b: any) { json = b; return res; } };
  requireAdmin({ user } as any, res, () => { nexted = true; });
  return { status, json, nexted };
}
test("requireAdmin: admin lanjut", () => { const r = run({ role: "admin" }); assert.equal(r.nexted, true); assert.equal(r.status, 0); });
test("requireAdmin: user 403", () => { const r = run({ role: "user" }); assert.equal(r.nexted, false); assert.equal(r.status, 403); assert.equal(r.json.code, "FORBIDDEN"); });
test("requireAdmin: tanpa req.user 403", () => { const r = run(undefined); assert.equal(r.nexted, false); assert.equal(r.status, 403); });

// --- Endpoint sesi admin: validasi sebelum query yang tidak perlu ---
const adminSid = "00000000-0000-0000-0000-0000000000aa";
const adminApp = express();
adminApp.use(express.json());
adminApp.use((req, _res, next) => { req.user = { ...plainUser, role: "admin" }; req.sessionId = adminSid; next(); });
adminApp.use(router);
const adminServer = adminApp.listen(0);
const adminBase = () => `http://127.0.0.1:${(adminServer.address() as AddressInfo).port}`;
after(async () => { await new Promise((r) => adminServer.close(r)); });

test("admin DELETE sesi dengan id akun bukan UUID: 404 Akun tidak ditemukan tanpa DB", async () => {
  const res = await fetch(`${adminBase()}/api/admin/users/bukan-uuid/sessions/${adminSid}`, { method: "DELETE" });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Akun tidak ditemukan.");
});

test("admin DELETE sesi yang sedang dipakai admin sendiri: 400 sebelum DELETE", async () => {
  const origQuery = (auditDb as any).query;
  const origConnect = (auditDb as any).connect;
  (auditDb as any).query = async () => ({ rows: [{ id: U, email: "u@x.co" }] }); // hanya cek akun ada
  (auditDb as any).connect = async () => { throw new Error("connect tidak boleh dipanggil"); };
  try {
    const res = await fetch(`${adminBase()}/api/admin/users/${U}/sessions/${adminSid}`, { method: "DELETE" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Gunakan Logout untuk perangkat ini.");
  } finally {
    (auditDb as any).query = origQuery;
    (auditDb as any).connect = origConnect;
  }
});
