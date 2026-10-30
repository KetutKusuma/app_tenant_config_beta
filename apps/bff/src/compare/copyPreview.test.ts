import { test } from "node:test";
import assert from "node:assert/strict";
import { attachConflicts, previewItems, previewSourceOnly, type PreviewItem } from "./copyPreview";
import type { CompareEntry, ConfigRow } from "./types";

let n = 0;
const cfg = (over: Partial<ConfigRow> & { config_type: string }): ConfigRow => ({
  id: `id${++n}`, tenant_id: "t", group_id: null, path: null, value: {}, is_default: false, version_token: "v", ...over,
});
const entry = (status: CompareEntry["status"], left: ConfigRow | null, right: ConfigRow | null): CompareEntry => ({
  configType: (left ?? right)!.config_type, status, changeCount: 0, left, right,
});
const item = (over: Partial<PreviewItem> & { configType: string }): PreviewItem => ({
  status: "baru", targetVersion: null, autoSummary: "Config baru", path: null, pathConflict: null, ...over,
});

test("pratinjau memakai path turunan", () => {
  const left = cfg({ config_type: "VACANCY_STABLE", path: null, value: { a: 1 } });
  const items = previewItems([{ configType: "VACANCY_STABLE", status: "hanya_kiri", changeCount: 0, left, right: null }], true);
  assert.deepEqual(items[0], { configType: "VACANCY_STABLE", status: "baru", targetVersion: null, autoSummary: "Config baru", path: "vacancy-stable", pathConflict: null });
});

test("timpa membawa ringkasan dan versi tujuan", () => {
  const left = cfg({ config_type: "A", path: "/ats/a", value: { a: 2 } });
  const right = cfg({ config_type: "A", path: "/ats/a", value: { a: 1 }, version_token: "2026-01-01 10:00:00+00" });
  const [it] = previewItems([entry("beda", left, right)], true);
  assert.equal(it.status, "timpa");
  assert.equal(it.autoSummary, "Ubah 1 field: a");
  assert.equal(it.targetVersion, "2026-01-01 10:00:00+00");
  assert.equal(it.path, "/ats/a");
});

test("timpa dengan path berbeda memasukkan perubahan path ke ringkasan", () => {
  const left = cfg({ config_type: "A", path: "/ats/baru", value: { a: 1 } });
  const right = cfg({ config_type: "A", path: "/ats/lama", value: { a: 2 } });
  const [it] = previewItems([entry("beda", left, right)], true);
  assert.equal(it.autoSummary, "Ubah 1 field: a · path: /ats/lama → /ats/baru");
  assert.equal(it.path, "/ats/baru");
});

test("tanpa kolom path (workflow_pipeline): path null dan ringkasan tanpa perubahan path", () => {
  const left = cfg({ config_type: "W", path: null, value: { a: 2 } });
  const right = cfg({ config_type: "W", path: null, value: { a: 1 } });
  const items = previewItems([entry("beda", left, right), entry("hanya_kiri", cfg({ config_type: "X" }), null)], false);
  assert.deepEqual(items.map((i) => i.path), [null, null]);
  assert.equal(items[0].autoSummary, "Ubah 1 field: a");
});

test("pemetaan status: sama, ganda, hanya_kanan tanpa ringkasan", () => {
  const a = cfg({ config_type: "A" }), b = cfg({ config_type: "B" }), c = cfg({ config_type: "C", path: "/ats/c", version_token: "vc" });
  const items = previewItems([entry("sama", a, a), entry("ganda", b, b), entry("hanya_kanan", null, c)], true);
  assert.deepEqual(items.map((i) => [i.status, i.autoSummary]), [["sama", null], ["ganda", null], ["hanya_tujuan", null]]);
  // path memakai sumber bila ada, kalau tidak tujuan
  assert.deepEqual(items.map((i) => i.path), ["a", "b", "/ats/c"]);
  assert.deepEqual(items.map((i) => i.targetVersion), ["v", "v", "vc"]);
  assert.ok(items.every((i) => i.pathConflict === null));
});

test("previewSourceOnly menandai ganda", () => {
  const items = previewSourceOnly([cfg({ config_type: "A" }), cfg({ config_type: "A" }), cfg({ config_type: "B", path: "/ats/b" })], true);
  assert.deepEqual(items, [
    { configType: "A", status: "ganda", targetVersion: null, autoSummary: null, path: "a", pathConflict: null },
    { configType: "B", status: "tidak_dibaca", targetVersion: null, autoSummary: null, path: "/ats/b", pathConflict: null },
  ]);
});

test("previewSourceOnly tanpa kolom path memberi path null", () => {
  const items = previewSourceOnly([cfg({ config_type: "W" })], false);
  assert.deepEqual(items.map((i) => [i.status, i.path]), [["tidak_dibaca", null]]);
  assert.deepEqual(previewSourceOnly([], true), []);
});

test("attachConflicts memberi saran yang tidak saling bentrok", () => {
  const items = [
    item({ configType: "X", path: "/ats/x" }),
    item({ configType: "Y", path: "/ats/y", status: "timpa", autoSummary: "Ubah 1 field: a", targetVersion: "v1" }),
    item({ configType: "S", path: "/ats/s", status: "sama", autoSummary: null }),
    item({ configType: "T", path: "/ats/t", status: "hanya_tujuan", autoSummary: null }),
  ];
  const conflicts = new Map([
    ["/ats/x", { tenantId: "t-9", configType: "OTHER_X" }],
    ["/ats/y", { tenantId: null, configType: "OTHER_Y" }],
    ["/ats/s", { tenantId: "t-8", configType: "OTHER_S" }],
    ["/ats/t", { tenantId: "t-8", configType: "OTHER_T" }],
  ]);
  const out = attachConflicts(items, conflicts, "IDM", new Set(["/ats/idm/x"]));
  assert.deepEqual(out[0].pathConflict, { ownerTenantId: "t-9", ownerConfigType: "OTHER_X", suggestion: "/ats/idm/x-2" });
  assert.deepEqual(out[1].pathConflict, { ownerTenantId: null, ownerConfigType: "OTHER_Y", suggestion: "/ats/idm/y" });
  // sama / hanya_tujuan tidak diberi pathConflict
  assert.equal(out[2].pathConflict, null);
  assert.equal(out[3].pathConflict, null);
  // sisa field item tidak berubah
  assert.equal(out[1].autoSummary, "Ubah 1 field: a");
  assert.equal(out[1].targetVersion, "v1");
});

test("attachConflicts: saran item sebelumnya dihitung sebagai terpakai", () => {
  const items = [item({ configType: "A", path: "/ats/x" }), item({ configType: "B", path: "/ats/x-2" })];
  const conflicts = new Map([
    ["/ats/x", { tenantId: "t-9", configType: "A9" }],
    ["/ats/x-2", { tenantId: "t-9", configType: "B9" }],
  ]);
  const out = attachConflicts(items, conflicts, "IDM", new Set(["/ats/idm/x"]));
  assert.equal(out[0].pathConflict?.suggestion, "/ats/idm/x-2");
  // basis B "/ats/idm/x-2" sudah dipakai saran A
  assert.equal(out[1].pathConflict?.suggestion, "/ats/idm/x-2-2");
});

test("attachConflicts: item tanpa bentrok dibiarkan, masukan tidak diubah", () => {
  const items = [item({ configType: "A", path: "/ats/a" }), item({ configType: "B", path: null })];
  const taken = new Set(["/ats/idm/a"]);
  const out = attachConflicts(items, new Map(), "IDM", taken);
  assert.deepEqual(out, items);
  const conflicts = new Map([["/ats/a", { tenantId: "t-9", configType: "A9" }]]);
  attachConflicts(items, conflicts, "IDM", taken);
  assert.deepEqual([...taken], ["/ats/idm/a"]);
  assert.equal(items[0].pathConflict, null);
});
