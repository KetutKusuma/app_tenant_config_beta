import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoginEventSql, recordLoginEvent, toLoginEventRow } from "./loginEvents.js";
import { deviceLabel } from "./device.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const base = { userId: "u1", email: "a@b.co", kind: "login_berhasil" as const, ip: "1.2.3.4", userAgent: UA };

test("email dipotong 254 karakter", () => {
  const long = "a".repeat(300);
  const sql = buildLoginEventSql({ ...base, email: long });
  assert.ok(sql.includes(`'${"a".repeat(254)}'`));
  assert.ok(!sql.includes("a".repeat(255)));
});

test("user agent dipotong 300 karakter", () => {
  const sql = buildLoginEventSql({ ...base, userAgent: "Z".repeat(5000) });
  assert.ok(sql.includes(`'${"Z".repeat(300)}'`));
  assert.ok(!sql.includes("Z".repeat(301)));
});

test("SQL memuat label perangkat", () => {
  assert.ok(buildLoginEventSql(base).includes(`'${deviceLabel(UA)}'`));
});

test("userId null menjadi NULL dan tabel di schema tenant_studio", () => {
  const sql = buildLoginEventSql({ ...base, userId: null });
  assert.match(sql, /VALUES \(NULL,/);
  assert.match(sql, /INSERT INTO tenant_studio\.studio_login_events/);
});

test("tidak ada kolom password", () => {
  assert.ok(!/password/i.test(buildLoginEventSql(base)));
});

test("recordLoginEvent tidak pernah throw", async () => {
  await assert.doesNotReject(recordLoginEvent({ query: async () => { throw new Error("db mati"); } }, base));
});

test("toLoginEventRow: user_id null -> userRegistered false, label fallback dari UA", () => {
  const row = toLoginEventRow({
    id: "1", user_id: null, email: "x@y.co", kind: "login_gagal", reason: "tidak_terdaftar",
    ip: null, device_label: null, user_agent: UA, actor_name: null, created_at: "2026-11-28T10:00:00Z"
  });
  assert.equal(row.userRegistered, false);
  assert.equal(row.deviceLabel, "Chrome · Windows");
  assert.equal(row.createdAt, "2026-11-28T10:00:00.000Z");
  assert.equal(toLoginEventRow({ id: "2", user_id: "u", email: "e", kind: "logout", created_at: new Date() }).userRegistered, true);
});
