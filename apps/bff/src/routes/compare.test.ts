import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExportBody } from "./compare.js";

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
