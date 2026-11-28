import { test } from "node:test";
import assert from "node:assert/strict";
import {
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

const ipKey = (email: string, n: number) => `${email}|10.0.0.${n}`;

test("cadangan per email: 20 kegagalan dari 20 IP berbeda mengunci email, juga untuk IP ke-21", () => {
  const email = "rot@b.co";
  for (let i = 1; i <= 20; i++) {
    assert.equal(loginLockRemainingMs(email, ipKey(email, i)), 0, `IP ${i} belum terkunci`);
    recordFailedAttempt(email, ipKey(email, i));
  }
  assert.ok(loginLockRemainingMs(email, ipKey(email, 21)) > 0);
});

test("cadangan per email: 4 gagal x 5 IP = 20 terkunci; 19 belum", () => {
  const locked = "five@b.co";
  for (let ip = 1; ip <= 5; ip++) for (let i = 0; i < 4; i++) recordFailedAttempt(locked, ipKey(locked, ip));
  assert.ok(loginLockRemainingMs(locked, ipKey(locked, 99)) > 0);

  const open = "nineteen@b.co";
  for (let ip = 1; ip <= 4; ip++) for (let i = 0; i < 4; i++) recordFailedAttempt(open, ipKey(open, ip));
  for (let i = 0; i < 3; i++) recordFailedAttempt(open, ipKey(open, 5));
  assert.equal(loginLockRemainingMs(open, ipKey(open, 99)), 0);
});

test("cadangan per email: notifikasi kunci sekali, dan paling banyak satu per request", () => {
  const email = "note@b.co";
  for (let i = 1; i <= 20; i++) recordFailedAttempt(email, ipKey(email, i));
  assert.equal(consumeAnyLockNotice(email, ipKey(email, 99)), true);
  assert.equal(consumeAnyLockNotice(email, ipKey(email, 99)), false);

  // keduanya terkunci: tetap hanya satu true
  const both = "both@b.co";
  for (let i = 0; i < 20; i++) recordFailedAttempt(both, ipKey(both, 1));
  assert.ok(loginLockedMs(ipKey(both, 1)) > 0);
  assert.equal(consumeAnyLockNotice(both, ipKey(both, 1)), true);
  assert.equal(consumeAnyLockNotice(both, ipKey(both, 1)), false);
});

test("login sukses menghapus kedua entri", () => {
  const email = "clear@b.co";
  for (let i = 1; i <= 20; i++) recordFailedAttempt(email, ipKey(email, 1));
  assert.ok(loginLockRemainingMs(email, ipKey(email, 1)) > 0);
  clearFailedAttempts(email, ipKey(email, 1));
  assert.equal(loginLockRemainingMs(email, ipKey(email, 1)), 0);
});
