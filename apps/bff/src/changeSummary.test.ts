import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReason, diffPaths, autoSummary, composeNote, REASON_MAX, QUICK_SAVE_REASON } from "./changeSummary";

test("konstanta", () => {
  assert.equal(REASON_MAX, 500);
  assert.equal(QUICK_SAVE_REASON, "Update via Tenant Studio");
});

test("parseReason melipat baris baru dan membatasi panjang", () => {
  assert.deepEqual(parseReason("  Rilis 30 Okt  "), { ok: true, value: "Rilis 30 Okt" });
  assert.deepEqual(parseReason("a\nb\r\n  c"), { ok: true, value: "a b c" });
  assert.deepEqual(parseReason("   "), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.deepEqual(parseReason(undefined), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.deepEqual(parseReason(42), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.equal(parseReason("x".repeat(500)).ok, true);
  assert.deepEqual(parseReason("x".repeat(501)), { ok: false, error: "Catatan (alasan) maksimal 500 karakter" });
});

test("diffPaths", () => {
  assert.deepEqual(diffPaths({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 }), { changed: ["b.c"], added: ["d"], removed: [] });
  assert.deepEqual(diffPaths({ l: [1, 2] }, { l: [1] }), { changed: [], added: [], removed: ["l[1]"] });
  assert.deepEqual(diffPaths({ l: [1] }, { l: [1, 5] }), { changed: [], added: ["l[1]"], removed: [] });
  assert.deepEqual(diffPaths({ x: { y: 1 } }, { x: "s" }), { changed: ["x"], added: [], removed: [] });
  assert.deepEqual(diffPaths({ b: 1, a: 1 }, { a: 1, b: 1 }), { changed: [], added: [], removed: [] });
  assert.deepEqual(diffPaths(1, 2), { changed: ["(akar)"], added: [], removed: [] });
});

test("autoSummary", () => {
  assert.equal(autoSummary(null, { a: 1 }), "Config baru");
  assert.equal(autoSummary({ a: 1 }, { a: 1 }), "Tidak ada perubahan isi");
  assert.equal(autoSummary({ a: 1, b: 1, c: { d: 1 } }, { a: 2, b: 2, c: { d: 2 }, e: 1 }), "Ubah 3 field: a, b, c.d · tambah 1");
  assert.equal(autoSummary({ a: 1 }, { a: 1, e: 1 }), "Tambah 1: e");
  assert.equal(autoSummary({ a: 1, b: 2 }, { a: 1 }), "Hapus 1: b");
  const many = (v: number) => Object.fromEntries(["k1", "k2", "k3", "k4", "k5", "k6", "k7"].map((k) => [k, v]));
  assert.equal(autoSummary(many(1), many(2)), "Ubah 7 field: k1, k2, k3, k4, k5 (+2 lainnya)");
  assert.equal(autoSummary({ a: 1 }, { a: 1 }, { from: "/ats/x", to: "/ats/idm/x" }), "Path: /ats/x → /ats/idm/x");
  assert.equal(autoSummary({ a: 1 }, { a: 2 }, { from: null, to: "a-b" }), "Ubah 1 field: a · path: (kosong) → a-b");
});

test("autoSummary: rincian tambah/hapus dan path bersarang", () => {
  const keys = ["k1", "k2", "k3", "k4", "k5", "k6", "k7"];
  const obj = (v: number) => Object.fromEntries(keys.map((k) => [k, v]));
  assert.equal(autoSummary({}, obj(1)), "Tambah 7: k1, k2, k3, k4, k5 (+2 lainnya)");
  assert.equal(autoSummary(obj(1), {}), "Hapus 7: k1, k2, k3, k4, k5 (+2 lainnya)");
  assert.equal(autoSummary({ a: 1, b: 1 }, { a: 2, c: 1 }), "Ubah 1 field: a · tambah 1 · hapus 1");
  assert.equal(autoSummary({ a: 1 }, { a: 1 }, { from: "x", to: "x" }), "Tidak ada perubahan isi");
  assert.equal(autoSummary({ a: 1 }, { a: 1 }, { from: "x", to: null }), "Path: x → (kosong)");
  assert.deepEqual(
    diffPaths({ l: [{ a: 1 }, { a: 2 }] }, { l: [{ a: 1 }, { a: 3, b: 1 }] }),
    { changed: ["l[1].a"], added: ["l[1].b"], removed: [] },
  );
  assert.deepEqual(diffPaths([1, 2], [1, 3]), { changed: ["[1]"], added: [], removed: [] });
  assert.deepEqual(diffPaths({ a: null }, { a: {} }), { changed: ["a"], added: [], removed: [] });
  assert.deepEqual(diffPaths({ a: [] }, { a: {} }), { changed: ["a"], added: [], removed: [] });
});

test("composeNote", () => {
  assert.equal(composeNote("Rilis", "Disalin dari development · IDM", "Config baru"), "Rilis — Disalin dari development · IDM · Config baru");
  assert.equal(composeNote("Rilis", null, "Ubah 1 field: a"), "Rilis — Ubah 1 field: a");
  assert.equal(composeNote("Rilis"), "Rilis");
  assert.equal(composeNote("Rilis", null, undefined, ""), "Rilis");
});
