import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tenantCodeSlug, finalPath, suggestPath, duplicateFinalPaths, findPathConflicts, takenPathsWithPrefix, pathGuardSql,
} from "./pathConflicts";

test("tenantCodeSlug", () => {
  assert.equal(tenantCodeSlug("IDM_STAGING"), "idm-staging");
  assert.equal(tenantCodeSlug("Jss Dev!"), "jss-dev");
});

test("finalPath menurunkan path dari config_type", () => {
  assert.equal(finalPath({ config_type: "VACANCY_STABLE", path: null }), "vacancy-stable");
  assert.equal(finalPath({ config_type: "X", path: "/ats/a" }, "  /ats/b "), "/ats/b");
  assert.equal(finalPath({ config_type: "X", path: "/ats/a" }, "  "), "/ats/a");
});

test("finalPath: path kosong dan override kosong jatuh ke path dari config_type", () => {
  assert.equal(finalPath({ config_type: "VACANCY_STABLE", path: "" }, ""), "vacancy-stable");
  assert.equal(finalPath({ config_type: "VACANCY_STABLE", path: "/ats/a" }), "/ats/a");
});

test("suggestPath", () => {
  assert.equal(suggestPath("/ats/vacancy-massive", "IDM_STAGING", new Set()), "/ats/idm-staging/vacancy-massive");
  assert.equal(suggestPath("vacancy-stable", "IDM_STAGING", new Set()), "idm-staging/vacancy-stable");
  assert.equal(suggestPath("/foo/bar", "IDM", new Set()), "/idm/foo/bar");
  assert.equal(suggestPath("/ats/x", "IDM", new Set(["/ats/idm/x"])), "/ats/idm/x-2");
  assert.equal(suggestPath("/ats/x", "IDM", new Set(["/ats/idm/x", "/ats/idm/x-2"])), "/ats/idm/x-3");
});

test("duplicateFinalPaths", () => {
  assert.deepEqual(duplicateFinalPaths([{ configType: "A", path: "/p" }, { configType: "B", path: "/p" }, { configType: "C", path: "/q" }]), ["/p"]);
});

test("duplicateFinalPaths: terurut dan tiap path ganda hanya sekali", () => {
  assert.deepEqual(
    duplicateFinalPaths([
      { configType: "A", path: "/z" }, { configType: "B", path: "/a" }, { configType: "C", path: "/z" },
      { configType: "D", path: "/a" }, { configType: "E", path: "/z" }, { configType: "F", path: "/solo" },
    ]),
    ["/a", "/z"],
  );
  assert.deepEqual(duplicateFinalPaths([]), []);
});

test("findPathConflicts tidak menghitung baris tenant tujuan", async () => {
  const sqls: string[] = [];
  const db = { query: async (s: string) => { sqls.push(s); return { rows: [{ path: "/ats/x", tenant_id: "t-9", config_type: "A" }] }; } };
  const m = await findPathConflicts(db, "public.tenant_configurations", ["/ats/x", "/ats/o'k"], "t-1");
  assert.match(sqls[0], /tenant_id IS DISTINCT FROM 't-1'/);
  assert.match(sqls[0], /deleted_at IS NULL/);
  assert.match(sqls[0], /'\/ats\/o''k'/);
  assert.deepEqual([...m.entries()], [["/ats/x", { tenantId: "t-9", configType: "A" }]]);
  assert.equal((await findPathConflicts(db, "public.tenant_configurations", [], "t-1")).size, 0);
  assert.equal(sqls.length, 1);
});

test("findPathConflicts: pemilik pertama per path, tenant global (NULL) tetap dihitung", async () => {
  const db = {
    query: async () => ({
      rows: [
        { path: "/ats/x", tenant_id: null, config_type: "A" },
        { path: "/ats/x", tenant_id: "t-9", config_type: "B" },
        { path: "/ats/y", tenant_id: "t-8", config_type: "C" },
      ],
    }),
  };
  const m = await findPathConflicts(db, "public.tenant_configurations", ["/ats/x", "/ats/y"], "t-1");
  assert.deepEqual([...m.entries()], [
    ["/ats/x", { tenantId: null, configType: "A" }],
    ["/ats/y", { tenantId: "t-8", configType: "C" }],
  ]);
});

test("takenPathsWithPrefix: tiga pola LIKE, tenant lain, hasil berupa Set path", async () => {
  const sqls: string[] = [];
  const db = {
    query: async (s: string) => {
      sqls.push(s);
      return { rows: [{ path: "/ats/idm/x" }, { path: "idm/y" }, { path: "/ats/idm/x" }] };
    },
  };
  const s = await takenPathsWithPrefix(db, "public.tenant_configurations", "t-1", "idm");
  assert.equal(sqls.length, 1);
  assert.match(sqls[0], /path LIKE '\/ats\/idm\/%'/);
  assert.match(sqls[0], /path LIKE '\/idm\/%'/);
  assert.match(sqls[0], /path LIKE 'idm\/%'/);
  assert.match(sqls[0], /tenant_id IS DISTINCT FROM 't-1'/);
  assert.match(sqls[0], /deleted_at IS NULL/);
  assert.ok(s instanceof Set);
  assert.deepEqual([...s].sort(), ["/ats/idm/x", "idm/y"]);
});

test("pathGuardSql", () => {
  const s = pathGuardSql("public.tenant_configurations", "t-1", ["/ats/o'k"]);
  assert.match(s, /^DO \$\$/);
  assert.match(s, /RAISE EXCEPTION/);
  assert.match(s, /tenant_id IS DISTINCT FROM 't-1'/);
  assert.match(s, /'\/ats\/o''k'/);
  assert.equal(pathGuardSql("public.tenant_configurations", "t-1", []), "");
});

test("pathGuardSql: bentuk blok DO, pesan, daftar path, dan penutup", () => {
  const s = pathGuardSql("public.tenant_configurations", "t-1", ["/ats/a", "/ats/b", "/ats/a"]);
  assert.match(s, /IF EXISTS \(SELECT 1 FROM public\.tenant_configurations WHERE path IN \('\/ats\/a', '\/ats\/b'\)/);
  assert.match(s, /RAISE EXCEPTION 'Path sudah dipakai tenant lain: %', \(SELECT string_agg\(DISTINCT path, ', '\) FROM public\.tenant_configurations/);
  assert.match(s, /deleted_at IS NULL/);
  assert.match(s, /END IF;\s*END \$\$;$/);
  // path ganda tidak diulang dalam daftar IN
  assert.equal(s.split("'/ats/a'").length - 1, 2); // sekali di IF EXISTS, sekali di subquery pesan
});

test("pathGuardSql: menolak path yang memuat $$ (akan menutup blok DO lebih awal)", () => {
  assert.throws(() => pathGuardSql("public.tenant_configurations", "t-1", ["/ats/a$$b"]), /\$\$/);
});
