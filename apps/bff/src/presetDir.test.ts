import { test } from "node:test";
import assert from "node:assert/strict";
import { presetDirFor } from "./domain.js";

const reqWith = (service: string, prefs: Record<string, unknown>, domain = "tenant_config") =>
  ({ targetService: { key: service }, user: { preferences: prefs }, header: () => domain, query: {}, body: {} }) as any;

test("presetDirFor: HRIS tanpa folder tidak memakai folder ATS", () => {
  assert.equal(presetDirFor(reqWith("hris", { presetDirTenant: "/ats", presetDirs: {} })), null);
});

test("presetDirFor: HRIS memakai presetDirs per layanan + domain", () => {
  assert.equal(presetDirFor(reqWith("hris", { presetDirTenant: "/ats", presetDirs: { "hris:tenant_config": "/hris" } })), "/hris");
  assert.equal(
    presetDirFor(reqWith("hris", { presetDirs: { "hris:workflow_pipeline": "/hris-wf" } }, "workflow_pipeline")),
    "/hris-wf"
  );
});

test("presetDirFor: ATS tetap memakai kolom lama", () => {
  assert.equal(presetDirFor(reqWith("ats", { presetDirTenant: "/ats", presetDirs: {} })), "/ats");
});
