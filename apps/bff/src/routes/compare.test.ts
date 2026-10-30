import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCopyBody, parseExportBody, parsePathCheckQuery, parsePreviewQuery } from "./compare.js";

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

// ---- parseCopyBody (Salin multi-domain) ----

const domainBody = (over: any = {}) => ({
  domain: "tenant_config", expectedTargetVersions: { A: "2026-10-01 00:00:00+00", B: null },
  confirmedCreate: ["B"], confirmedOverwrite: ["A"], ...over,
});
const copyBody = (over: any = {}) => ({
  sourceEnv: "development", sourceTenantId: "t-1", targetTenantId: "t-2", reason: "Rilis",
  domains: [domainBody()], ...over,
});

test("parseCopyBody bentuk baru", () => {
  const ok = parseCopyBody(copyBody({
    domains: [{ domain: "tenant_config", expectedTargetVersions: {}, confirmedCreate: ["A"], confirmedOverwrite: [] }],
  }));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value.domains[0].pathOverrides, {});
  assert.deepEqual(parseCopyBody(copyBody({ targetTenantId: "GLOBAL_DEFAULT" })), { ok: false, error: "GLOBAL_DEFAULT tidak bisa menjadi tujuan salin" });
  assert.deepEqual(parseCopyBody(copyBody({ reason: " " })), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.deepEqual(parseCopyBody(copyBody({ domains: [] })), { ok: false, error: "domains wajib berisi minimal satu domain" });
  const d = domainBody();
  assert.deepEqual(parseCopyBody(copyBody({ domains: [d, d] })), { ok: false, error: "Domain 'tenant_config' disebut dua kali" });
  assert.deepEqual(parseCopyBody(copyBody({ domains: [{ ...d, domain: "workflow_pipeline", pathOverrides: { A: "/x" } }] })), { ok: false, error: "pathOverrides hanya untuk tenant_config" });
});

test("parseCopyBody: body valid diterima, di-trim, alasan dilipat", () => {
  const r = parseCopyBody(copyBody({
    sourceEnv: " development ", targetTenantId: " t-2 ", reason: "  Rilis\n  Q4  ",
    domains: [domainBody({ pathOverrides: { B: "  /ats/x/b  " } })],
  }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value, {
      sourceEnv: "development", sourceTenantId: "t-1", targetTenantId: "t-2", reason: "Rilis Q4",
      domains: [{
        domain: "tenant_config", expectedTargetVersions: { A: "2026-10-01 00:00:00+00", B: null },
        confirmedCreate: ["B"], confirmedOverwrite: ["A"], pathOverrides: { B: "/ats/x/b" },
      }],
    });
  }
});

test("parseCopyBody: dua domain berbeda diterima, pathOverrides kosong di workflow diterima", () => {
  const r = parseCopyBody(copyBody({
    domains: [domainBody(), domainBody({ domain: "workflow_pipeline", pathOverrides: {} })],
  }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.domains.map((d) => d.domain), ["tenant_config", "workflow_pipeline"]);
});

test("parseCopyBody: domains bukan larik tidak kosong ditolak", () => {
  for (const v of [undefined, null, "tenant_config", {}, 1]) {
    assert.deepEqual(parseCopyBody(copyBody({ domains: v })), { ok: false, error: "domains wajib berisi minimal satu domain" });
  }
});

test("parseCopyBody: domain tidak dikenal ditolak, termasuk nama prototype", () => {
  for (const x of ["bogus", "constructor", "__proto__"]) {
    assert.deepEqual(parseCopyBody(copyBody({ domains: [domainBody({ domain: x })] })), { ok: false, error: `Domain '${x}' tidak dikenal` });
  }
  assert.equal(parseCopyBody(copyBody({ domains: [null] })).ok, false);
  assert.equal(parseCopyBody(copyBody({ domains: ["tenant_config"] })).ok, false);
});

test("parseCopyBody: pathOverrides harus objek dengan nilai teks", () => {
  assert.deepEqual(parseCopyBody(copyBody({ domains: [domainBody({ pathOverrides: { B: 5 } })] })), { ok: false, error: "pathOverrides.B harus teks" });
  assert.deepEqual(parseCopyBody(copyBody({ domains: [domainBody({ pathOverrides: { B: null } })] })), { ok: false, error: "pathOverrides.B harus teks" });
  for (const v of ["x", ["a"], 1]) assert.equal(parseCopyBody(copyBody({ domains: [domainBody({ pathOverrides: v })] })).ok, false);
});

test("parseCopyBody: alasan tidak valid memakai pesan parseReason", () => {
  assert.deepEqual(parseCopyBody(copyBody({ reason: undefined })), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.deepEqual(parseCopyBody(copyBody({ reason: "x".repeat(501) })), { ok: false, error: "Catatan (alasan) maksimal 500 karakter" });
  assert.equal(parseCopyBody(copyBody({ reason: "x".repeat(500) })).ok, true);
});

test("parseCopyBody: field wajib kosong ditolak", () => {
  assert.equal(parseCopyBody(null).ok, false);
  assert.equal(parseCopyBody("x").ok, false);
  assert.equal(parseCopyBody(copyBody({ sourceEnv: "" })).ok, false);
  assert.equal(parseCopyBody(copyBody({ sourceTenantId: undefined })).ok, false);
  assert.equal(parseCopyBody(copyBody({ targetTenantId: "  " })).ok, false);
  assert.equal(parseCopyBody(copyBody({ sourceEnv: 5 })).ok, false);
});

test("parseCopyBody: expectedTargetVersions kosong diterima, bukan objek ditolak", () => {
  assert.equal(parseCopyBody(copyBody({ domains: [domainBody({ expectedTargetVersions: {} })] })).ok, true);
  for (const v of [undefined, null, "x", 1, ["a"]]) {
    const r = parseCopyBody(copyBody({ domains: [domainBody({ expectedTargetVersions: v })] }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /expectedTargetVersions/);
  }
});

test("parseCopyBody: nilai versi selain teks/null ditolak", () => {
  assert.equal(parseCopyBody(copyBody({ domains: [domainBody({ expectedTargetVersions: { A: 1 } })] })).ok, false);
  assert.equal(parseCopyBody(copyBody({ domains: [domainBody({ expectedTargetVersions: { A: {} } })] })).ok, false);
});

test("parseCopyBody: confirmedCreate/confirmedOverwrite wajib daftar teks", () => {
  for (const f of ["confirmedCreate", "confirmedOverwrite"]) {
    for (const v of [undefined, null, "A", { a: 1 }, [1], ["A", null]]) {
      const r = parseCopyBody(copyBody({ domains: [domainBody({ [f]: v })] }));
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, new RegExp(f));
    }
  }
  assert.equal(parseCopyBody(copyBody({ domains: [domainBody({ confirmedCreate: [], confirmedOverwrite: [] })] })).ok, true);
});

const previewQuery = (over: any = {}) => ({
  sourceEnv: "development", sourceTenantId: "t-1", targetEnv: "staging", targetTenantId: "t-2", domains: "tenant_config,workflow_pipeline", ...over,
});

test("parsePreviewQuery: query valid diterima, domains dipisah koma dan di-trim", () => {
  assert.deepEqual(parsePreviewQuery(previewQuery({ domains: " tenant_config , workflow_pipeline " })), {
    ok: true,
    value: { sourceEnv: "development", sourceTenantId: "t-1", targetEnv: "staging", targetTenantId: "t-2", domains: ["tenant_config", "workflow_pipeline"] },
  });
  const one = parsePreviewQuery(previewQuery({ domains: "workflow_pipeline" }));
  assert.ok(one.ok && one.value.domains.length === 1);
});

test("parsePreviewQuery: domains hilang, kosong, atau bukan teks ditolak", () => {
  for (const v of [undefined, "", "  ", ",", ["tenant_config"], 1]) {
    const r = parsePreviewQuery(previewQuery({ domains: v }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /domains/);
  }
});

test("parsePreviewQuery: domain tidak dikenal ditolak, termasuk nama prototype", () => {
  for (const x of ["bogus", "constructor", "__proto__"]) {
    assert.deepEqual(parsePreviewQuery(previewQuery({ domains: `tenant_config,${x}` })), { ok: false, error: `Domain '${x}' tidak dikenal` });
  }
});

test("parsePreviewQuery: domain yang sama disebut dua kali hanya dihitung sekali", () => {
  const r = parsePreviewQuery(previewQuery({ domains: "tenant_config,tenant_config" }));
  assert.ok(r.ok && r.value.domains.length === 1);
});

test("parsePreviewQuery: parameter wajib kosong ditolak, GLOBAL_DEFAULT bukan tujuan", () => {
  for (const f of ["sourceEnv", "sourceTenantId", "targetEnv", "targetTenantId"]) {
    assert.equal(parsePreviewQuery(previewQuery({ [f]: "" })).ok, false);
    assert.equal(parsePreviewQuery(previewQuery({ [f]: undefined })).ok, false);
  }
  assert.deepEqual(parsePreviewQuery(previewQuery({ targetTenantId: "GLOBAL_DEFAULT" })), { ok: false, error: "GLOBAL_DEFAULT tidak bisa menjadi tujuan salin" });
  // GLOBAL_DEFAULT boleh menjadi sumber
  assert.equal(parsePreviewQuery(previewQuery({ sourceTenantId: "GLOBAL_DEFAULT" })).ok, true);
  // production-manual boleh sebagai env tujuan (tujuan tidak dibaca)
  assert.equal(parsePreviewQuery(previewQuery({ targetEnv: "production-manual" })).ok, true);
});

test("parsePathCheckQuery: valid diterima, path di-trim", () => {
  assert.deepEqual(parsePathCheckQuery({ targetEnv: "staging", targetTenantId: "t-2", path: "  /ats/idm/x " }), {
    ok: true, value: { targetEnv: "staging", targetTenantId: "t-2", path: "/ats/idm/x" },
  });
});

test("parsePathCheckQuery: parameter kosong, production-manual, dan GLOBAL_DEFAULT ditolak", () => {
  const q = (over: any = {}) => ({ targetEnv: "staging", targetTenantId: "t-2", path: "/ats/x", ...over });
  for (const f of ["targetEnv", "targetTenantId", "path"]) {
    assert.equal(parsePathCheckQuery(q({ [f]: "" })).ok, false);
    assert.equal(parsePathCheckQuery(q({ [f]: "   " })).ok, false);
    assert.equal(parsePathCheckQuery(q({ [f]: undefined })).ok, false);
  }
  assert.equal(parsePathCheckQuery(q({ path: ["/a", "/b"] })).ok, false);
  const pm = parsePathCheckQuery(q({ targetEnv: "production-manual" }));
  assert.equal(pm.ok, false);
  if (!pm.ok) assert.match(pm.error, /Production \(isi manual\)/);
  assert.equal(parsePathCheckQuery(q({ targetTenantId: "GLOBAL_DEFAULT" })).ok, false);
});
