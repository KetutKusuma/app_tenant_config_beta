import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  registerAuth, lockEntryCount, sweepExpiredLocks, MAX_FAILED_PER_IP,
  clearFailedAttempts, consumeAnyLockNotice, consumeLockNotice, loginLockRemainingMs, loginLockedMs,
  recordFailedAttempt, recordFailedLogin
} from "./auth.js";

function lock(key: string) {
  for (let i = 0; i < 5; i++) recordFailedLogin(key);
}

test("consumeLockNotice: true hanya sekali per masa kunci", () => {
  const k = "a@b.co|1.1.1.1";
  lock(k);
  assert.ok(loginLockedMs(k) > 0);
  assert.equal(consumeLockNotice(k), true);
  assert.equal(consumeLockNotice(k), false);
  assert.equal(consumeLockNotice(k), false);
});

test("consumeLockNotice: kunci berbeda punya notifikasi sendiri", () => {
  const k1 = "x@b.co|2.2.2.2";
  const k2 = "y@b.co|2.2.2.2";
  lock(k1);
  lock(k2);
  assert.equal(consumeLockNotice(k1), true);
  assert.equal(consumeLockNotice(k2), true);
});

test("consumeLockNotice: tidak terkunci -> false", () => {
  assert.equal(consumeLockNotice("tak-ada|3.3.3.3"), false);
});

const ip = (n: number) => `10.0.0.${n}`;

test("cadangan per email: 20 kegagalan dari 20 IP berbeda mengunci email, juga untuk IP ke-21", () => {
  const email = "rot@b.co";
  for (let i = 1; i <= 20; i++) {
    assert.equal(loginLockRemainingMs(email, ip(i)), 0, `IP ${i} belum terkunci`);
    recordFailedAttempt(email, ip(i));
  }
  assert.ok(loginLockRemainingMs(email, ip(21)) > 0);
});

test("cadangan per email: 4 gagal x 5 IP = 20 terkunci; 19 belum", () => {
  const locked = "five@b.co";
  for (let n = 1; n <= 5; n++) for (let i = 0; i < 4; i++) recordFailedAttempt(locked, ip(100 + n));
  assert.ok(loginLockRemainingMs(locked, ip(99)) > 0);

  const open = "nineteen@b.co";
  for (let n = 1; n <= 4; n++) for (let i = 0; i < 4; i++) recordFailedAttempt(open, ip(110 + n));
  for (let i = 0; i < 3; i++) recordFailedAttempt(open, ip(115));
  assert.equal(loginLockRemainingMs(open, ip(99)), 0);
});

test("cadangan per email: notifikasi kunci sekali, dan paling banyak satu per request", () => {
  const email = "note@b.co";
  for (let i = 1; i <= 20; i++) recordFailedAttempt(email, ip(i));
  assert.equal(consumeAnyLockNotice(email, ip(99)), true);
  assert.equal(consumeAnyLockNotice(email, ip(99)), false);

  // keduanya terkunci: tetap hanya satu true
  const both = "both@b.co";
  for (let i = 0; i < 20; i++) recordFailedAttempt(both, ip(201));
  assert.ok(loginLockedMs(`${both}|10.0.0.201`) > 0);
  assert.equal(consumeAnyLockNotice(both, ip(201)), true);
  assert.equal(consumeAnyLockNotice(both, ip(201)), false);
});

test("login sukses menghapus entri email|ip dan email", () => {
  const email = "clear@b.co";
  for (let i = 1; i <= 20; i++) recordFailedAttempt(email, ip(202));
  assert.ok(loginLockRemainingMs(email, ip(202)) > 0);
  clearFailedAttempts(email, ip(202));
  assert.equal(loginLockRemainingMs(email, ip(202)), 0);
});

test("kunci per IP: 30 gagal dari 30 email tak terdaftar mengunci IP, juga untuk email ke-31", () => {
  for (let i = 0; i < 30; i++) {
    assert.equal(loginLockRemainingMs(`spray${i}@b.co`, "198.51.100.1"), 0);
    recordFailedAttempt(`spray${i}@b.co`, "198.51.100.1");
  }
  assert.ok(loginLockRemainingMs("baru@b.co", "198.51.100.1") > 0);
  assert.equal(loginLockRemainingMs("baru@b.co", "198.51.100.2"), 0);
  assert.equal(MAX_FAILED_PER_IP, 30);
});

test("kunci per IP bertahan setelah login sukses (clear hanya email|ip dan email)", () => {
  const ipv = "198.51.100.3";
  for (let i = 0; i < 30; i++) recordFailedAttempt(`s${i}@b.co`, ipv);
  clearFailedAttempts("s0@b.co", ipv);
  assert.ok(loginLockRemainingMs("akun-sah@b.co", ipv) > 0);
});

test("sweepExpiredLocks menghapus entri yang kedaluwarsa", () => {
  const before = lockEntryCount();
  recordFailedAttempt("sweep@b.co", "198.51.100.4"); // 3 entri baru, belum terkunci
  assert.equal(lockEntryCount(), before + 3);
  sweepExpiredLocks(Date.now()); // masih dalam jendela
  assert.equal(lockEntryCount(), before + 3);
  sweepExpiredLocks(Date.now() + 16 * 60 * 1000); // jendela 15 menit habis
  assert.equal(lockEntryCount(), 0);
});

// --- handler login dengan DB tiruan ---
async function withLoginApp(fn: (post: (body: any) => Promise<{ status: number; json: any }>, db: { calls: string[] }) => Promise<void>) {
  const db = { calls: [] as string[] };
  const fake: any = { query: async (sql: string) => { db.calls.push(sql); return { rows: [] }; } };
  const app = express();
  app.use(express.json());
  registerAuth(app, fake, (v: any) => `'${String(v)}'`);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/login`;
    const post = async (body: any) => {
      const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json() };
    };
    await fn(post, db);
  } finally {
    server.close();
  }
}

test("login: email/password terlalu panjang atau bukan string -> 401 generik tanpa DB, peta kunci, event", async () => {
  await withLoginApp(async (post, db) => {
    const before = lockEntryCount();
    for (const body of [
      { email: "a".repeat(255), password: "x" },
      { email: "a@b.co", password: "p".repeat(1025) },
      { email: ["a@b.co"], password: "x" },
      { email: "a@b.co", password: 12345 }
    ]) {
      const r = await post(body);
      assert.equal(r.status, 401);
      assert.equal(r.json.error, "Email atau password salah.");
    }
    assert.equal(lockEntryCount(), before);
    assert.equal(db.calls.length, 0);
  });
});

test("login: 30 email tak terdaftar dari satu IP -> percobaan ke-31 ditolak 429", async () => {
  sweepExpiredLocks(Date.now() + 16 * 60 * 1000);
  await withLoginApp(async (post) => {
    for (let i = 0; i < 30; i++) assert.equal((await post({ email: `h${i}@b.co`, password: "x" })).status, 401);
    assert.equal((await post({ email: "h99@b.co", password: "x" })).status, 429);
  });
});

test("login: kegagalan dicatat ke peta kunci sebelum event ditulis", async () => {
  sweepExpiredLocks(Date.now() + 16 * 60 * 1000);
  await withLoginApp(async (post, db) => {
    let seenAtEvent = -1;
    const fake = (db as any);
    const origCalls = fake.calls;
    fake.calls = new Proxy(origCalls, {
      get(t, k, r) {
        if (k === "push") return (sql: string) => { if (sql.includes("studio_login_events")) seenAtEvent = lockEntryCount(); return t.push(sql); };
        return Reflect.get(t, k, r);
      }
    });
    await post({ email: "race@b.co", password: "x" });
    assert.equal(seenAtEvent, 3, "tiga entri kunci sudah ada saat event ditulis");
  });
});
