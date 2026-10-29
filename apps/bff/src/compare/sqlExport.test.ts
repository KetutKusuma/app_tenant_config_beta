import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExportSql, exportFileName, resolveGroupId, defaultPath, type ExportSqlInput } from "./sqlExport.js";

const TC = { table: "public.tenant_configurations", typeCol: "config_type", hasPath: true };
const WF = { table: "public.pipeline_workflow_configurations", typeCol: "workflow_config_type", hasPath: false };

const base = (over: Partial<ExportSqlInput> = {}): ExportSqlInput => ({
  domain: TC, mode: "timpa",
  source: { env: "development", tenantCode: "IDM" },
  target: { env: "staging", tenantId: "t-1", groupId: "g-1", tenantCode: "IDM" },
  author: "ketut", createdAt: new Date(2026, 9, 29, 10, 5),
  items: [
    { configType: "A_ONE", path: "a-one", value: { a: 1 }, isDefault: false },
    { configType: "B_TWO", path: null, value: { b: 2 }, isDefault: true },
  ],
  ...over,
});

test("header dan pembungkus", () => {
  const sql = buildExportSql(base());
  assert.equal(sql.split("\n")[0], "-- Tenant Studio · Export SQL");
  assert.ok(sql.includes("-- Sumber  : development · IDM"));
  assert.ok(sql.includes("-- Dibuat  : 2026-10-29 10:05 oleh ketut · 2 config · jika sudah ada: timpa"));
  assert.ok(sql.includes("BEGIN;"));
  assert.ok(sql.endsWith("COMMIT;\n"));
});

test("mode timpa", () => {
  const sql = buildExportSql(base());
  assert.ok(sql.includes("-- [1/2] A_ONE"));
  assert.ok(sql.includes("-- [2/2] B_TWO"));
  assert.equal(sql.split("UPDATE public.tenant_configurations").length - 1, 2);
  assert.equal(sql.split("WHERE NOT EXISTS").length - 1, 2);
});

test("mode lewati", () => {
  const sql = buildExportSql(base({ mode: "lewati" }));
  assert.ok(!sql.includes("UPDATE"));
  assert.ok(sql.includes("WHERE NOT EXISTS"));
});

test("tujuan GLOBAL_DEFAULT", () => {
  const sql = buildExportSql(base({ target: { env: "staging", tenantId: null, groupId: null, tenantCode: "GLOBAL_DEFAULT" } }));
  assert.ok(sql.includes("tenant_id IS NULL"));
  assert.ok(sql.includes("gen_random_uuid(), NULL, NULL,"));
  const body = sql.slice(sql.indexOf("BEGIN;"));
  assert.ok(!body.includes("GLOBAL_DEFAULT"));
});

test("domain workflow", () => {
  const sql = buildExportSql(base({ domain: WF }));
  assert.ok(sql.includes("public.pipeline_workflow_configurations"));
  assert.ok(sql.includes("workflow_config_type"));
  assert.ok(!/\bpath\b/.test(sql));
});

test("path cadangan", () => {
  const sql = buildExportSql(base({ items: [{ configType: "CANDIDATE_STABLE", path: null, value: {}, isDefault: false }] }));
  assert.ok(sql.includes("'candidate-stable'"));
});

test("buildExportSql menjaga isi JSON apa adanya", () => {
  const value = { note: "it's \\ $x\n", emoji: "✓" };
  const sql = buildExportSql(base({ items: [{ configType: "X", path: "x", value, isDefault: false }] }));
  const lit = "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb";
  assert.ok(sql.includes(lit));
  // dipakai di UPDATE dan INSERT
  assert.equal(sql.split(lit).length - 1, 2);
});

test("resolveGroupId", () => {
  assert.equal(resolveGroupId("t", ""), "t");
  assert.equal(resolveGroupId("t", null), "t");
  assert.equal(resolveGroupId(null, "g"), null);
  assert.equal(resolveGroupId("t", "g"), "g");
});

test("defaultPath", () => {
  assert.equal(defaultPath("CANDIDATE_STABLE"), "candidate-stable");
});

test("exportFileName", () => {
  assert.equal(exportFileName("IDM_PROD", "public.tenant_configurations", new Date(2026, 9, 29, 10, 0)), "IDM_PROD_tenant_configurations_2026-10-29.sql");
});

test("resolveGroupId tambahan", () => {
  assert.equal(resolveGroupId(undefined, "g"), null);
  assert.equal(resolveGroupId("t", "  "), "t");
  assert.equal(resolveGroupId("t", " g "), "g");
});

test("tenantId undefined / kosong / GLOBAL_DEFAULT tidak pernah jadi = NULL", () => {
  for (const tenantId of [undefined, "", "GLOBAL_DEFAULT"]) {
    const sql = buildExportSql(base({ target: { env: "x", tenantId: tenantId as any, groupId: "g", tenantCode: "T" } }));
    assert.ok(!sql.includes("= NULL"));
    assert.ok(sql.includes("tenant_id IS NULL"));
    assert.ok(sql.includes("gen_random_uuid(), NULL, NULL,"));
  }
});

test("aturan group_id di builder", () => {
  const a = buildExportSql(base({ target: { env: "x", tenantId: null, groupId: "g-9", tenantCode: "T" } }));
  assert.ok(a.includes("gen_random_uuid(), NULL, NULL,"));
  const b = buildExportSql(base({ target: { env: "x", tenantId: "t-1", groupId: null, tenantCode: "T" } }));
  assert.ok(b.includes("gen_random_uuid(), 't-1', 't-1',"));
  assert.ok(b.includes("group_id t-1"));
});

test("baris baru tidak bisa keluar dari komentar", () => {
  const evil = "x\nDELETE FROM t;--";
  const sql = buildExportSql(base({
    author: evil,
    target: { env: evil, tenantId: "t-1", groupId: evil, tenantCode: evil },
    source: { env: evil, tenantCode: evil },
    items: [{ configType: "C\nEVILCOMMENT", path: "p", value: {}, isDefault: false }],
  }));
  const lines = sql.split("\n");
  const before = lines.slice(0, lines.indexOf("BEGIN;"));
  // nilai groupId juga masuk sebagai literal string di INSERT (aman, di dalam kutip); yang dijaga: komentar
  assert.ok(!before.some((l) => l.startsWith("DELETE")));
  assert.ok(before.every((l) => l === "" || l.startsWith("--")));
  // configType di komentar item satu baris; di SQL ia hanya ada di dalam literal string
  assert.ok(lines.includes("-- [1/1] C EVILCOMMENT"));
});

test("exportFileName membersihkan tenantCode", () => {
  assert.equal(exportFileName("IDM/PROD x", "public.tenant_configurations", new Date(2026, 9, 29, 10, 0)), "IDM_PROD_x_tenant_configurations_2026-10-29.sql");
});

test("golden: tenant_configurations, timpa, tenant biasa", () => {
  const sql = buildExportSql({
    domain: TC, mode: "timpa",
    source: { env: "development", tenantCode: "IDM" },
    target: { env: "staging", tenantId: "t-1", groupId: "g-1", tenantCode: "IDM" },
    author: "Ketut", createdAt: new Date(2026, 9, 29, 10, 15),
    items: [{ configType: "A_ONE", path: null, value: { x: 1 }, isDefault: true }],
  });
  const expected = `-- Tenant Studio · Export SQL
-- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.
-- Tabel   : public.tenant_configurations
-- Sumber  : development · IDM
-- Tujuan  : staging · IDM · tenant_id t-1 · group_id g-1
-- Dibuat  : 2026-10-29 10:15 oleh Ketut · 1 config · jika sudah ada: timpa

BEGIN;
SET LOCAL standard_conforming_strings = on;

-- [1/1] A_ONE
UPDATE public.tenant_configurations
SET value = '{"x":1}'::jsonb, path = 'a-one', updated_at = NOW()
WHERE tenant_id = 't-1' AND config_type = 'A_ONE' AND deleted_at IS NULL;
INSERT INTO public.tenant_configurations (id, tenant_id, group_id, config_type, path, value, is_default, created_at, updated_at)
SELECT gen_random_uuid(), 't-1', 'g-1', 'A_ONE', 'a-one', '{"x":1}'::jsonb, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_configurations WHERE tenant_id = 't-1' AND config_type = 'A_ONE' AND deleted_at IS NULL);

COMMIT;
`;
  assert.equal(sql, expected);
});

test("golden: workflow, lewati, GLOBAL_DEFAULT", () => {
  const sql = buildExportSql({
    domain: WF, mode: "lewati",
    source: { env: "development", tenantCode: "IDM" },
    target: { env: "staging", tenantId: null, groupId: null, tenantCode: "GLOBAL_DEFAULT" },
    author: "Ketut", createdAt: new Date(2026, 9, 29, 10, 15),
    items: [{ configType: "FLOW_A", path: null, value: { y: [1] }, isDefault: false }],
  });
  const expected = `-- Tenant Studio · Export SQL
-- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.
-- Tabel   : public.pipeline_workflow_configurations
-- Sumber  : development · IDM
-- Tujuan  : staging · GLOBAL_DEFAULT · tenant_id NULL · group_id NULL
-- Dibuat  : 2026-10-29 10:15 oleh Ketut · 1 config · jika sudah ada: lewati

BEGIN;
SET LOCAL standard_conforming_strings = on;

-- [1/1] FLOW_A
INSERT INTO public.pipeline_workflow_configurations (id, tenant_id, group_id, workflow_config_type, value, is_default, created_at, updated_at)
SELECT gen_random_uuid(), NULL, NULL, 'FLOW_A', '{"y":[1]}'::jsonb, false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_workflow_configurations WHERE tenant_id IS NULL AND workflow_config_type = 'FLOW_A' AND deleted_at IS NULL);

COMMIT;
`;
  assert.equal(sql, expected);
});
