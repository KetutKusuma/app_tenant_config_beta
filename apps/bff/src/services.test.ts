import { test } from "node:test";
import assert from "node:assert/strict";
import { isServiceKey, SERVICE_KEYS, tableFor } from "./services.js";
import { domainOf, domainSpecFor } from "./domain.js";

test("tableFor hris tenant_config: id varchar, type ikut disalin, group_id dari sumber", () => {
  const t = tableFor("hris", "tenant_config")!;
  assert.equal(t.table, "public.tenant_configurations");
  assert.equal(t.typeCol, "config_type");
  assert.equal(t.hasPath, true);
  assert.equal(t.idType, "varchar");
  assert.deepEqual(t.extraCopyCols, ["type"]);
  assert.equal(t.groupIdFromSource, true);
});

test("tableFor organization memakai schema core", () => {
  const t = tableFor("organization", "tenant_config")!;
  assert.equal(t.table, "core.tenant_configurations");
  assert.equal(t.idType, "uuid");
  assert.deepEqual(t.extraCopyCols, ["type"]);
  assert.equal(t.groupIdFromSource, false);
});

test("tableFor hris workflow: schema workflow_pipelines, is_active default true", () => {
  const t = tableFor("hris", "workflow_pipeline")!;
  assert.equal(t.table, "workflow_pipelines.workflow_pipeline_configurations");
  assert.equal(t.typeCol, "workflow_config_type");
  assert.equal(t.hasPath, false);
  assert.equal(t.idType, "varchar");
  assert.deepEqual(t.extraCopyCols, ["is_active"]);
  assert.deepEqual(t.extraInsertDefaults, { is_active: "true" });
  assert.equal(t.groupIdFromSource, true);
});

test("tableFor auth workflow tidak ada", () => {
  assert.equal(tableFor("auth", "workflow_pipeline"), null);
  assert.equal(tableFor("communication", "workflow_pipeline"), null);
  assert.equal(tableFor("organization", "workflow_pipeline"), null);
});

test("ats tetap sama seperti DOMAINS lama", () => {
  const tc = domainSpecFor("ats", "tenant_config")!;
  assert.equal(tc.table, "public.tenant_configurations");
  assert.equal(tc.pathSel, "path");
  assert.equal(tc.linkKey("X"), "X");
  const wf = domainSpecFor("ats", "workflow_pipeline")!;
  assert.equal(wf.table, "public.pipeline_workflow_configurations");
  assert.equal(wf.pathSel, "NULL::text AS path");
  assert.equal(wf.linkKey("X"), "WORKFLOW_PIPELINE:X");
});

test("domainOf: layanan tanpa workflow jatuh ke tenant_config", () => {
  const req = { targetService: { key: "auth" }, header: () => "workflow_pipeline", query: {}, body: {} } as any;
  const d = domainOf(req);
  assert.equal(d.key, "tenant_config");
  assert.equal(d.table, "public.tenant_configurations");
});

test("domainOf: tanpa targetService memakai ats", () => {
  const req = { header: () => "workflow_pipeline", query: {}, body: {} } as any;
  assert.equal(domainOf(req).table, "public.pipeline_workflow_configurations");
});

test("domainOf: hris workflow", () => {
  const req = { targetService: { key: "hris" }, header: () => "workflow_pipeline", query: {}, body: {} } as any;
  assert.equal(domainOf(req).table, "workflow_pipelines.workflow_pipeline_configurations");
});

test("isServiceKey dan urutan menu", () => {
  assert.equal(isServiceKey("hris"), true);
  assert.equal(isServiceKey("integrator"), false);
  assert.equal(isServiceKey(undefined), false);
  assert.deepEqual(SERVICE_KEYS, ["ats", "hris", "organization", "auth", "communication"]);
});
