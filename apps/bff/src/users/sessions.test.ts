import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageQuery, toSessionRow, UUID_RE } from "./sessions.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const row = {
  id: "s1", token_hash: "secret", user_agent: UA, device_label: null, ip: "1.1.1.1",
  created_at: "2026-11-28T10:00:00Z", last_seen_at: new Date("2026-11-28T11:00:00Z"), expires_at: "2026-12-05T10:00:00Z"
};

test("toSessionRow: current hanya bila id sama", () => {
  assert.equal(toSessionRow(row, "s1").current, true);
  assert.equal(toSessionRow(row, "s2").current, false);
  assert.equal(toSessionRow(row, null).current, false);
});

test("toSessionRow: label fallback, tanggal ISO, tanpa token_hash/user_agent", () => {
  const s: any = toSessionRow(row, null);
  assert.equal(s.deviceLabel, "Chrome · Windows");
  assert.equal(s.createdAt, "2026-11-28T10:00:00.000Z");
  assert.equal(s.lastSeenAt, "2026-11-28T11:00:00.000Z");
  assert.ok(!("token_hash" in s) && !("user_agent" in s) && !("tokenHash" in s) && !("userAgent" in s));
});

test("parsePageQuery", () => {
  assert.deepEqual(parsePageQuery({}), { limit: 50, before: null });
  assert.equal(parsePageQuery({ limit: "0" }).limit, 1);
  assert.equal(parsePageQuery({ limit: "999" }).limit, 200);
  assert.equal(parsePageQuery({ before: "bukan-tanggal" }).before, null);
  assert.equal(parsePageQuery({ before: "2026-11-28T10:00:00.000Z" }).before, "2026-11-28T10:00:00.000Z");
});

test("UUID_RE", () => {
  assert.ok(UUID_RE.test("00000000-0000-0000-0000-000000000001"));
  assert.ok(!UUID_RE.test("abc"));
});
