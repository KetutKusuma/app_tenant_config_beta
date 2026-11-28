import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeLockNotice, loginLockedMs, recordFailedLogin } from "./auth.js";

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
