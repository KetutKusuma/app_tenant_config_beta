import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompareEntries, countJsonChanges, loadSides } from "./compareEntries.js";
import type { ConfigRow } from "./types.js";

let n = 0;
const row = (config_type: string, value: any): ConfigRow => ({
  id: `id${++n}`, tenant_id: "t", group_id: null, config_type, path: null, value, is_default: false, version_token: "v",
});

test("urutan key tidak dihitung beda", () => {
  const { entries } = buildCompareEntries([row("A", { a: 1, b: { c: 2, d: 3 } })], [row("A", { b: { d: 3, c: 2 }, a: 1 })]);
  assert.equal(entries[0].status, "sama");
  assert.equal(entries[0].changeCount, 0);
});

test("beda dihitung per path daun", () => {
  const { entries } = buildCompareEntries([row("A", { a: 1, b: { c: 2 } })], [row("A", { a: 1, b: { c: 3 }, d: 4 })]);
  assert.equal(entries[0].status, "beda");
  assert.equal(entries[0].changeCount, 2);
});

test("array per indeks", () => {
  assert.equal(countJsonChanges([1, 2, 3], [1, 3]), 2);
});

test("daun vs objek dihitung 1", () => {
  assert.equal(countJsonChanges({ a: 1 }, { a: { x: 1, y: 2 } }), 1);
});

test("hanya satu sisi", () => {
  const { entries } = buildCompareEntries([row("X", 1)], [row("Y", 2)]);
  const x = entries.find((e) => e.configType === "X")!;
  const y = entries.find((e) => e.configType === "Y")!;
  assert.equal(x.status, "hanya_kiri");
  assert.equal(x.right, null);
  assert.equal(y.status, "hanya_kanan");
  assert.equal(y.left, null);
});

test("ganda", () => {
  const { entries, summary } = buildCompareEntries([row("Z", 1), row("Z", 2)], [row("Z", 1)]);
  assert.equal(entries[0].status, "ganda");
  assert.equal(entries[0].changeCount, 0);
  assert.equal(summary.ganda, 1);
});

test("urutan hasil", () => {
  const { entries } = buildCompareEntries(
    [row("s2", 1), row("s1", 1), row("b2", 1), row("b1", 1), row("k2", 1), row("k1", 1), row("g", 1), row("g", 1)],
    [row("s2", 1), row("s1", 1), row("b2", 2), row("b1", 2), row("n2", 1), row("n1", 1), row("g", 1)],
  );
  assert.deepEqual(entries.map((e) => e.configType), ["b1", "b2", "k1", "k2", "n1", "n2", "g", "s1", "s2"]);
});

test("nilai dikembalikan dalam bentuk kanonik", () => {
  const { entries } = buildCompareEntries([row("A", { b: 1, a: 2 })], [row("A", { b: 1, a: 2 })]);
  assert.deepEqual(Object.keys(entries[0].left!.value), ["a", "b"]);
});

test("summary", () => {
  const { summary } = buildCompareEntries(
    [row("s", 1), row("b", 1), row("k", 1), row("g", 1), row("g", 1)],
    [row("s", 1), row("b", 2), row("n", 1), row("g", 1)],
  );
  assert.deepEqual(summary, { total: 5, sama: 1, beda: 1, hanyaKiri: 1, hanyaKanan: 1, ganda: 1 });
});

test("loadSides menyebut sisi yang gagal", async () => {
  const r = await loadSides(async () => 1, async () => { throw new Error("ECONNREFUSED"); }, { kiri: "Development", kanan: "Staging" });
  assert.deepEqual(r, { ok: false, side: "kanan", error: "Env Staging (kanan) tidak terjangkau: ECONNREFUSED" });
});

test("loadSides sukses dan kiri diutamakan bila keduanya gagal", async () => {
  const ok = await loadSides(async () => 1, async () => 2, { kiri: "A", kanan: "B" });
  assert.deepEqual(ok, { ok: true, left: 1, right: 2 });
  const bad = await loadSides(async () => { throw new Error("x"); }, async () => { throw new Error("y"); }, { kiri: "A", kanan: "B" });
  assert.deepEqual(bad, { ok: false, side: "kiri", error: "Env A (kiri) tidak terjangkau: x" });
});
