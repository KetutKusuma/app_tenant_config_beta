import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PRESET_DIR, presetDirFor } from "./domain.js";

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

// ---- C1: folder preset milik layanan lain tidak boleh dipakai ----
import { foreignPresetDir } from "./domain.js";

test("foreignPresetDir: HRIS memakai folder preset ATS ditolak", () => {
  const req = reqWith("hris", { presetDirTenant: "/presets/ats", presetDirWorkflow: null, presetDirs: {} });
  assert.match(foreignPresetDir(req, "/presets/ats")!, /ATS/);
  assert.match(foreignPresetDir(req, "/presets/ats/IDM/candidate.json")!, /ATS/);
});

test("foreignPresetDir: HRIS memakai folder bawaan ATS ditolak bila ATS tanpa folder", () => {
  const req = reqWith("hris", { presetDirTenant: null, presetDirWorkflow: null, presetDirs: {} });
  assert.ok(foreignPresetDir(req, DEFAULT_PRESET_DIR));
});

test("foreignPresetDir: folder HRIS sendiri dan folder lain diizinkan", () => {
  const req = reqWith("hris", { presetDirTenant: "/presets/ats", presetDirs: { "hris:tenant_config": "/presets/hris" } });
  assert.equal(foreignPresetDir(req, "/presets/hris"), null);
  assert.equal(foreignPresetDir(req, "/presets/hris/a.json"), null);
  assert.equal(foreignPresetDir(req, "/presets/atsx"), null);
});

test("foreignPresetDir: ATS memakai folder HRIS ditolak", () => {
  const req = reqWith("ats", { presetDirTenant: "/presets/ats", presetDirs: { "hris:tenant_config": "/presets/hris" } });
  assert.match(foreignPresetDir(req, "/presets/hris")!, /HRIS/);
  assert.equal(foreignPresetDir(req, "/presets/ats"), null);
});
