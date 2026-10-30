import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConfigRow } from "./types.js";
import { buildExportSql, exportBatchShape, exportFileName, exportItemOf, resolveGroupId, defaultPath, type ExportSection, type ExportSqlInput } from "./sqlExport.js";

const TC = { table: "public.tenant_configurations", typeCol: "config_type", hasPath: true };
const WF = { table: "public.pipeline_workflow_configurations", typeCol: "workflow_config_type", hasPath: false };

const tcSection: ExportSection = {
  domain: TC,
  items: [
    { configType: "A_ONE", path: "a-one", value: { a: 1 }, isDefault: false },
    { configType: "B_TWO", path: null, value: { b: 2 }, isDefault: true },
  ],
};
const wfSection: ExportSection = {
  domain: WF,
  items: [{ configType: "FLOW_A", path: null, value: { y: [1] }, isDefault: false }],
};

const base = (over: Partial<ExportSqlInput> = {}): ExportSqlInput => ({
  sections: [tcSection], mode: "timpa",
  source: { env: "development", tenantCode: "IDM" },
  target: { env: "staging", tenantId: "t-1", groupId: "g-1", tenantCode: "IDM" },
  author: "ketut", createdAt: new Date(2026, 9, 29, 10, 5), reason: "Rilis Q4",
  ...over,
});
const GLOBAL_TARGET = { env: "staging", tenantId: null, groupId: null, tenantCode: "GLOBAL_DEFAULT" };

test("header dan pembungkus", () => {
  const sql = buildExportSql(base());
  assert.equal(sql.split("\n")[0], "-- Tenant Studio · Export SQL");
  assert.ok(sql.includes("-- Sumber  : development · IDM"));
  assert.ok(sql.includes("-- Dibuat  : 2026-10-29 10:05 oleh ketut · 2 config · jika sudah ada: timpa"));
  assert.ok(sql.includes("-- Dibuat  : 2026-10-29 10:05 oleh ketut · 2 config · jika sudah ada: timpa\n-- Alasan  : Rilis Q4\n"));
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
  const sql = buildExportSql(base({ target: GLOBAL_TARGET }));
  assert.ok(sql.includes("tenant_id IS NULL"));
  assert.ok(!sql.includes("DO $$"), "tujuan global tidak memakai penjaga path");
  assert.ok(sql.includes("gen_random_uuid(), NULL, NULL,"));
  const body = sql.slice(sql.indexOf("BEGIN;"));
  assert.ok(!body.includes("GLOBAL_DEFAULT"));
});

test("domain workflow", () => {
  const sql = buildExportSql(base({ sections: [wfSection] }));
  assert.ok(sql.includes("public.pipeline_workflow_configurations"));
  assert.ok(sql.includes("workflow_config_type"));
  assert.ok(!/\bpath\b/.test(sql));
});

test("path cadangan", () => {
  const sql = buildExportSql(base({ sections: [{ domain: TC, items: [{ configType: "CANDIDATE_STABLE", path: null, value: {}, isDefault: false }] }] }));
  assert.ok(sql.includes("'candidate-stable'"));
});

test("buildExportSql menjaga isi JSON apa adanya", () => {
  const value = { note: "it's \\ $x\n", emoji: "✓" };
  const sql = buildExportSql(base({ sections: [{ domain: TC, items: [{ configType: "X", path: "x", value, isDefault: false }] }] }));
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
    reason: evil,
    sections: [{ domain: TC, items: [{ configType: "C\nEVILCOMMENT", path: "p", value: {}, isDefault: false }] }],
  }));
  const lines = sql.split("\n");
  const before = lines.slice(0, lines.indexOf("BEGIN;"));
  // nilai groupId juga masuk sebagai literal string di INSERT (aman, di dalam kutip); yang dijaga: komentar
  assert.ok(!before.some((l) => l.startsWith("DELETE")));
  assert.ok(before.every((l) => l === "" || l.startsWith("--")));
  // configType di komentar item satu baris; di SQL ia hanya ada di dalam literal string
  assert.ok(lines.includes("-- [1/1] C EVILCOMMENT"));
  assert.ok(lines.includes("-- Alasan  : x DELETE FROM t;--"));
});

test("nama file semua", () => assert.equal(exportFileName("IDM_PROD", "semua", new Date(2026, 9, 30)), "IDM_PROD_semua_2026-10-30.sql"));

test("exportFileName membersihkan tenantCode", () => {
  assert.equal(exportFileName("IDM/PROD x", "public.tenant_configurations", new Date(2026, 9, 29, 10, 0)), "IDM_PROD_x_tenant_configurations_2026-10-29.sql");
});

test("golden: tenant_configurations, timpa, tenant biasa", () => {
  const sql = buildExportSql({
    sections: [{ domain: TC, items: [{ configType: "A_ONE", path: null, value: { x: 1 }, isDefault: true }] }],
    mode: "timpa",
    source: { env: "development", tenantCode: "IDM" },
    target: { env: "staging", tenantId: "t-1", groupId: "g-1", tenantCode: "IDM" },
    author: "Ketut", createdAt: new Date(2026, 9, 29, 10, 15), reason: "Rilis Q4",
  });
  const expected = `-- Tenant Studio · Export SQL
-- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.
-- Tabel   : public.tenant_configurations
-- Sumber  : development · IDM
-- Tujuan  : staging · IDM · tenant_id t-1 · group_id g-1
-- Dibuat  : 2026-10-29 10:15 oleh Ketut · 1 config · jika sudah ada: timpa
-- Alasan  : Rilis Q4

BEGIN;
SET LOCAL standard_conforming_strings = on;

-- == public.tenant_configurations ==

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_configurations WHERE path IN ('a-one') AND tenant_id IS DISTINCT FROM 't-1' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Path sudah dipakai tenant lain: %', (SELECT string_agg(DISTINCT path, ', ') FROM public.tenant_configurations WHERE path IN ('a-one') AND tenant_id IS DISTINCT FROM 't-1' AND deleted_at IS NULL);
  END IF;
END $$;

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
    sections: [{ domain: WF, items: [{ configType: "FLOW_A", path: null, value: { y: [1] }, isDefault: false }] }],
    mode: "lewati",
    source: { env: "development", tenantCode: "IDM" },
    target: GLOBAL_TARGET,
    author: "Ketut", createdAt: new Date(2026, 9, 29, 10, 15), reason: "Isi default",
  });
  const expected = `-- Tenant Studio · Export SQL
-- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.
-- Tabel   : public.pipeline_workflow_configurations
-- Sumber  : development · IDM
-- Tujuan  : staging · GLOBAL_DEFAULT · tenant_id NULL · group_id NULL
-- Dibuat  : 2026-10-29 10:15 oleh Ketut · 1 config · jika sudah ada: lewati
-- Alasan  : Isi default

BEGIN;
SET LOCAL standard_conforming_strings = on;

-- == public.pipeline_workflow_configurations ==

-- [1/1] FLOW_A
INSERT INTO public.pipeline_workflow_configurations (id, tenant_id, group_id, workflow_config_type, value, is_default, created_at, updated_at)
SELECT gen_random_uuid(), NULL, NULL, 'FLOW_A', '{"y":[1]}'::jsonb, false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_workflow_configurations WHERE tenant_id IS NULL AND workflow_config_type = 'FLOW_A' AND deleted_at IS NULL);

COMMIT;
`;
  assert.equal(sql, expected);
});

// ---- multi-tabel: satu transaksi, penjaga path, alasan ----

test("dua section dalam satu transaksi", () => {
  const sql = buildExportSql(base({ sections: [tcSection, wfSection] }));
  assert.equal(sql.match(/BEGIN;/g)!.length, 1);
  assert.equal(sql.match(/COMMIT;/g)!.length, 1);
  assert.ok(sql.indexOf("-- == public.tenant_configurations ==") < sql.indexOf("-- == public.pipeline_workflow_configurations =="));
  assert.ok(sql.indexOf("BEGIN;") < sql.indexOf("-- == public.tenant_configurations =="));
  assert.ok(sql.indexOf("-- == public.pipeline_workflow_configurations ==") < sql.indexOf("COMMIT;"));
  assert.ok(sql.includes("-- Tabel   : public.tenant_configurations, public.pipeline_workflow_configurations\n"));
});

test("penomoran item berlanjut antar section dan N = total item", () => {
  const sql = buildExportSql(base({ sections: [tcSection, wfSection] }));
  assert.ok(sql.includes("· 3 config · jika sudah ada: timpa"));
  for (const l of ["-- [1/3] A_ONE", "-- [2/3] B_TWO", "-- [3/3] FLOW_A"]) assert.ok(sql.split("\n").includes(l), l);
  assert.ok(sql.indexOf("-- [2/3] B_TWO") < sql.indexOf("-- == public.pipeline_workflow_configurations =="));
  assert.ok(sql.indexOf("-- == public.pipeline_workflow_configurations ==") < sql.indexOf("-- [3/3] FLOW_A"));
});

test("penjaga path hanya untuk tabel ber-path dengan tenant tujuan", () => {
  const sql = buildExportSql(base({ sections: [tcSection, wfSection] }));
  assert.equal(sql.match(/RAISE EXCEPTION/g)!.length, 1);
  assert.ok(sql.indexOf("DO $$") < sql.indexOf("UPDATE public.tenant_configurations"));
  // penjaga ada di section tenant_configurations, sebelum section workflow
  assert.ok(sql.indexOf("DO $$") < sql.indexOf("-- == public.pipeline_workflow_configurations =="));
});

test("penjaga path memuat path akhir semua item section dan tenant tujuan", () => {
  const sql = buildExportSql(base({ sections: [tcSection, wfSection] }));
  const guard = sql.slice(sql.indexOf("DO $$"), sql.indexOf("END $$;"));
  assert.ok(guard.includes("path IN ('a-one', 'b-two')"));
  assert.ok(guard.includes("tenant_id IS DISTINCT FROM 't-1'"));
  assert.ok(guard.includes("FROM public.tenant_configurations"));
});

test("tanpa penjaga path bila tujuan global (tenant NULL)", () => {
  for (const tenantId of [null, undefined, "", "GLOBAL_DEFAULT"]) {
    const sql = buildExportSql(base({ sections: [tcSection, wfSection], target: { ...GLOBAL_TARGET, tenantId: tenantId as any } }));
    assert.ok(!sql.includes("DO $$"));
    assert.ok(!sql.includes("RAISE EXCEPTION"));
    assert.ok(!sql.includes("DISTINCT FROM"));
  }
});

test("tanpa penjaga path untuk workflow saja, walau ada tenant tujuan", () => {
  const sql = buildExportSql(base({ sections: [wfSection] }));
  assert.ok(!sql.includes("DO $$"));
});

test("penjaga path menolak path yang memuat $$", () => {
  const evil: ExportSection = { domain: TC, items: [{ configType: "X", path: "a$$b", value: {}, isDefault: false }] };
  assert.throws(() => buildExportSql(base({ sections: [evil] })), /\$\$/);
  // tujuan global tidak memakai penjaga, jadi path itu hanya literal biasa
  assert.doesNotThrow(() => buildExportSql(base({ sections: [evil], target: GLOBAL_TARGET })));
});

test("alasan satu baris di header", () => {
  assert.match(buildExportSql(base({ reason: "a\nb" })), /^-- Alasan  : a b$/m);
  assert.match(buildExportSql(base({ reason: "a\r\n\r\nb" })), /^-- Alasan  : a b$/m);
});

test("exportBatchShape: satu domain memakai kunci domain, tipe polos, counts { total }", () => {
  assert.deepEqual(exportBatchShape([{ domain: "workflow_pipeline", configTypes: ["B", "A"] }]), {
    domain: "workflow_pipeline", configTypes: ["A", "B"], counts: { total: 2 },
  });
});

test("exportBatchShape: dua domain jadi semua, tipe berawalan domain dan terurut, counts per domain", () => {
  assert.deepEqual(exportBatchShape([
    { domain: "tenant_config", configTypes: ["B", "A"] },
    { domain: "workflow_pipeline", configTypes: ["A"] },
  ]), {
    domain: "semua",
    configTypes: ["tenant_config:A", "tenant_config:B", "workflow_pipeline:A"],
    counts: { total: 3, perDomain: { tenant_config: { total: 2 }, workflow_pipeline: { total: 1 } } },
  });
});

// ---- exportItemOf: path akhir dan is_default dari baris sumber ----

const srcRow = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  id: "r-1", tenant_id: "t-1", group_id: "g-1", config_type: "VACANCY_STABLE", path: "/ats/idm/vacancy", value: { v: 1 }, is_default: true, version_token: "v1", ...over,
});

test("exportItemOf: override menang, di-trim; tanpa override memakai path sumber lalu turunan config_type", () => {
  assert.equal(exportItemOf(srcRow(), { hasPath: true, override: "  /ats/baru/vacancy ", toGlobal: false }).path, "/ats/baru/vacancy");
  assert.equal(exportItemOf(srcRow(), { hasPath: true, toGlobal: false }).path, "/ats/idm/vacancy");
  assert.equal(exportItemOf(srcRow(), { hasPath: true, override: "  ", toGlobal: false }).path, "/ats/idm/vacancy");
  assert.equal(exportItemOf(srcRow({ path: null }), { hasPath: true, toGlobal: false }).path, "vacancy-stable");
});

test("exportItemOf: tabel tanpa path selalu path null, override diabaikan", () => {
  assert.equal(exportItemOf(srcRow({ path: null }), { hasPath: false, override: "/x", toGlobal: false }).path, null);
});

test("exportItemOf: is_default hanya diteruskan ke tujuan global", () => {
  assert.equal(exportItemOf(srcRow({ is_default: true }), { hasPath: true, toGlobal: true }).isDefault, true);
  assert.equal(exportItemOf(srcRow({ is_default: false }), { hasPath: true, toGlobal: true }).isDefault, false);
  assert.equal(exportItemOf(srcRow({ is_default: true }), { hasPath: true, toGlobal: false }).isDefault, false);
  assert.equal(exportItemOf(srcRow({ is_default: null as any }), { hasPath: false, toGlobal: true }).isDefault, false);
});

test("exportItemOf: tipe dan isi dibawa apa adanya", () => {
  const it = exportItemOf(srcRow({ value: { v: [1, 2] } }), { hasPath: true, toGlobal: false });
  assert.equal(it.configType, "VACANCY_STABLE");
  assert.deepEqual(it.value, { v: [1, 2] });
});
