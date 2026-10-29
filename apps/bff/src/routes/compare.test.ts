import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCopyBody, parseExportBody } from "./compare.js";

const profileBody = (over: any = {}) => ({
  sourceEnv: "development", sourceTenantId: "t-1", configTypes: ["A"], mode: "timpa",
  target: { kind: "profile", env: "staging", tenantId: "t-2" }, ...over,
});

test("configTypes kosong ditolak", () => {
  const r = parseExportBody(profileBody({ configTypes: [] }));
  assert.equal(r.ok, false);
});

test("manual tenantId bukan UUID ditolak dan menyebut UUID", () => {
  const r = parseExportBody(profileBody({ target: { kind: "manual", tenantId: "abc" } }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /UUID/);
});

test("manual GLOBAL_DEFAULT diterima", () => {
  const r = parseExportBody(profileBody({ target: { kind: "manual", tenantId: "GLOBAL_DEFAULT" } }));
  assert.equal(r.ok, true);
});

test("manual UUID valid diterima", () => {
  const r = parseExportBody(profileBody({ target: { kind: "manual", tenantId: "123e4567-e89b-12d3-a456-426614174000", groupId: "123e4567-e89b-12d3-a456-426614174001" } }));
  assert.equal(r.ok, true);
});

test("body profil valid diterima", () => {
  const r = parseExportBody(profileBody());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.target.kind, "profile");
});

test("mode salah dan field kosong ditolak", () => {
  assert.equal(parseExportBody(profileBody({ mode: "x" })).ok, false);
  assert.equal(parseExportBody(profileBody({ sourceEnv: "" })).ok, false);
  assert.equal(parseExportBody(null).ok, false);
});

// ---- parseCopyBody (Salin ke Kanan) ----

const copyBody = (over: any = {}) => ({
  sourceEnv: "development", sourceTenantId: "t-1", targetTenantId: "t-2",
  expectedTargetVersions: { A: "2026-10-01 00:00:00+00", B: null },
  confirmedCreate: ["B"], confirmedOverwrite: ["A"], ...over,
});

test("parseCopyBody: body valid diterima dan di-trim", () => {
  const r = parseCopyBody(copyBody({ sourceEnv: " development ", targetTenantId: " t-2 " }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value, {
      sourceEnv: "development", sourceTenantId: "t-1", targetTenantId: "t-2",
      expectedTargetVersions: { A: "2026-10-01 00:00:00+00", B: null },
      confirmedCreate: ["B"], confirmedOverwrite: ["A"],
    });
  }
});

test("parseCopyBody: expectedTargetVersions kosong diterima", () => {
  assert.equal(parseCopyBody(copyBody({ expectedTargetVersions: {} })).ok, true);
});

test("parseCopyBody: field wajib kosong ditolak", () => {
  assert.equal(parseCopyBody(null).ok, false);
  assert.equal(parseCopyBody("x").ok, false);
  assert.equal(parseCopyBody(copyBody({ sourceEnv: "" })).ok, false);
  assert.equal(parseCopyBody(copyBody({ sourceTenantId: undefined })).ok, false);
  assert.equal(parseCopyBody(copyBody({ targetTenantId: "  " })).ok, false);
  assert.equal(parseCopyBody(copyBody({ sourceEnv: 5 })).ok, false);
});

test("parseCopyBody: expectedTargetVersions bukan objek ditolak", () => {
  for (const v of [undefined, null, "x", 1, ["a"]]) {
    const r = parseCopyBody(copyBody({ expectedTargetVersions: v }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /expectedTargetVersions/);
  }
});

test("parseCopyBody: nilai versi selain teks/null ditolak", () => {
  assert.equal(parseCopyBody(copyBody({ expectedTargetVersions: { A: 1 } })).ok, false);
  assert.equal(parseCopyBody(copyBody({ expectedTargetVersions: { A: {} } })).ok, false);
});

test("parseCopyBody: confirmedCreate/confirmedOverwrite wajib daftar teks", () => {
  for (const f of ["confirmedCreate", "confirmedOverwrite"]) {
    for (const v of [undefined, null, "A", { a: 1 }, [1], ["A", null]]) {
      const r = parseCopyBody(copyBody({ [f]: v }));
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, new RegExp(f));
    }
  }
  assert.equal(parseCopyBody(copyBody({ confirmedCreate: [], confirmedOverwrite: [] })).ok, true);
});
