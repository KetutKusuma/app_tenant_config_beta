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
