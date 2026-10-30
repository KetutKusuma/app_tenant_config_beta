import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planCopy, planMismatch, selectPlan, selectionMismatch, applyPathOverrides, staleConfigTypes, runCopy, writeCopyTx, writeCopyTxMulti,
  CommitUncertainError, TargetChangedError, PathConflictError, isCommitUncertain,
  COMMIT_UNCERTAIN_MESSAGE, type CopyDeps, type CopyPart, type CopyPlan, type CopyTable, type TxClient,
} from "./copyConfigs";
import type { CompareEntry, ConfigRow } from "./types";

function row(type: string, token = "t"): ConfigRow {
  return { id: `id-${type}`, tenant_id: "x", group_id: null, config_type: type, path: null, value: {}, is_default: false, version_token: token };
}
function entry(type: string, status: CompareEntry["status"], left: ConfigRow | null, right: ConfigRow | null): CompareEntry {
  return { configType: type, status, changeCount: 0, left, right };
}

test("planCopy membagi per status", () => {
  const plan = planCopy([
    entry("B", "hanya_kiri", row("B"), null),
    entry("A", "beda", row("A", "l"), row("A", "r")),
    entry("C", "sama", row("C"), row("C")),
    entry("D", "hanya_kanan", null, row("D")),
    entry("E", "ganda", row("E"), row("E")),
  ]);
  assert.deepEqual(plan.create.map((r) => r.config_type), ["B"]);
  assert.equal(plan.overwrite.length, 1);
  assert.equal(plan.overwrite[0].source.version_token, "l");
  assert.equal(plan.overwrite[0].target.version_token, "r");
  assert.deepEqual(plan.same, ["C"]);
  assert.deepEqual(plan.targetOnly, ["D"]);
  assert.deepEqual(plan.duplicates, ["E"]);
  assert.deepEqual(plan.unselected, []);
});

test("staleConfigTypes: token berbeda atau muncul → stale, A→Z; same/targetOnly diabaikan", () => {
  const plan: CopyPlan = {
    create: [row("B")],
    overwrite: [{ source: row("A"), target: row("A", "t1") }],
    same: ["S"],
    targetOnly: ["T"],
    duplicates: [],
    unselected: [],
  };
  const current = [row("A", "t2"), row("B", "x"), row("S", "z"), row("T", "z")];
  assert.deepEqual(staleConfigTypes(plan, { A: "t1", B: null, S: "old", T: "old" }, current), ["A", "B"]);
  assert.deepEqual(staleConfigTypes(plan, { A: "t1", B: null }, [row("A", "t1")]), []);
});

test("staleConfigTypes: tipe rencana yang tidak ada di expected → stale (null eksplisit tetap berarti 'belum ada')", () => {
  const plan: CopyPlan = {
    create: [row("B"), row("C")],
    overwrite: [{ source: row("A"), target: row("A", "t1") }],
    same: [], targetOnly: [], duplicates: [], unselected: [],
  };
  // C tidak pernah dilihat user (sumber bertambah setelah banding) → stale walau tujuan juga belum punya C
  assert.deepEqual(staleConfigTypes(plan, { A: "t1", B: null }, [row("A", "t1")]), ["C"]);
  // A hilang dari expected → stale walau tokennya sama
  assert.deepEqual(staleConfigTypes(plan, { B: null, C: null }, [row("A", "t1")]), ["A"]);
  // kunci warisan prototype tidak dianggap ada
  const planProto: CopyPlan = { create: [row("constructor")], overwrite: [], same: [], targetOnly: [], duplicates: [], unselected: [] };
  assert.deepEqual(staleConfigTypes(planProto, {}, []), ["constructor"]);
});

test("planMismatch: himpunan sama (urutan beda) → kosong; tambah/kurang/pindah kelompok → daftar A→Z", () => {
  const plan: CopyPlan = {
    create: [row("B"), row("C")],
    overwrite: [{ source: row("A"), target: row("A", "t1") }, { source: row("D"), target: row("D", "t1") }],
    same: [], targetOnly: [], duplicates: [], unselected: [],
  };
  assert.deepEqual(planMismatch(plan, ["C", "B"], ["D", "A"]), []);
  assert.deepEqual(planMismatch(plan, ["B", "C"], ["A"]), ["D"]); // D sebelumnya "sama" bagi user
  assert.deepEqual(planMismatch(plan, ["B", "C", "E"], ["A", "D"]), ["E"]); // E kini sama/ganda
  assert.deepEqual(planMismatch(plan, ["B"], ["A", "D", "C"]), ["C"]); // C pindah dibuat → ditimpa
  assert.deepEqual(planMismatch({ ...plan, create: [], overwrite: [] }, [], []), []);
});

const TENANT_TABLE: CopyTable = { table: "public.tenant_configurations", typeCol: "config_type", hasPath: true };
const WORKFLOW_TABLE: CopyTable = { table: "public.pipeline_workflow_configurations", typeCol: "workflow_config_type", hasPath: false };

const tenantPart = (plan: CopyPlan): CopyPart => ({ domain: "tenant_config", table: TENANT_TABLE, plan });
const workflowPart = (plan: CopyPlan): CopyPart => ({ domain: "workflow_pipeline", table: WORKFLOW_TABLE, plan });

function ow(type: string, token = "old"): { source: ConfigRow; target: ConfigRow } {
  return { source: row(type), target: row(type, token) };
}

test("selectPlan hanya menyimpan pilihan user", () => {
  const plan: CopyPlan = { create: [row("A"), row("B")], overwrite: [ow("C"), ow("D")], same: [], targetOnly: [], duplicates: [], unselected: [] };
  const s = selectPlan(plan, ["A"], ["C"]);
  assert.deepEqual(s.create.map((r) => r.config_type), ["A"]);
  assert.deepEqual(s.overwrite.map((o) => o.source.config_type), ["C"]);
  assert.deepEqual(s.unselected, ["B", "D"]);
  // rencana asli tidak berubah
  assert.equal(plan.create.length, 2);
  assert.deepEqual(plan.unselected, []);
});

test("selectPlan: unselected terurut, mempertahankan isi lama, same/targetOnly/duplicates tidak disentuh", () => {
  const plan: CopyPlan = { create: [row("Z"), row("B")], overwrite: [ow("M")], same: ["S"], targetOnly: ["T"], duplicates: ["G"], unselected: ["Q"] };
  const s = selectPlan(plan, [], []);
  assert.deepEqual(s.create, []);
  assert.deepEqual(s.overwrite, []);
  assert.deepEqual(s.unselected, ["B", "M", "Q", "Z"]);
  assert.deepEqual([s.same, s.targetOnly, s.duplicates], [["S"], ["T"], ["G"]]);
});

test("selectionMismatch", () => {
  const plan: CopyPlan = { create: [row("A")], overwrite: [ow("X")], same: [], targetOnly: [], duplicates: [], unselected: [] };
  assert.deepEqual(selectionMismatch(plan, ["A", "X"], []), ["X"]);
  assert.deepEqual(selectionMismatch(plan, ["A"], ["X"]), []);
});

test("selectionMismatch: tipe yang tidak ada di rencana segar dan tipe pindah kelompok, terurut tanpa duplikat", () => {
  const plan: CopyPlan = { create: [row("B"), row("C")], overwrite: [ow("A")], same: [], targetOnly: [], duplicates: [], unselected: [] };
  assert.deepEqual(selectionMismatch(plan, ["C", "Z", "A"], ["B", "Z"]), ["A", "B", "Z"]);
  // subset dari rencana segar boleh: user memang memilih sebagian
  assert.deepEqual(selectionMismatch(plan, ["B"], []), []);
  assert.deepEqual(selectionMismatch(plan, [], []), []);
});

test("applyPathOverrides", () => {
  const plan: CopyPlan = { create: [{ ...row("VACANCY_STABLE"), path: null }], overwrite: [], same: [], targetOnly: [], duplicates: [], unselected: [] };
  assert.equal(applyPathOverrides(plan, {}).create[0].path, "vacancy-stable");
  assert.equal(applyPathOverrides(plan, { VACANCY_STABLE: "/ats/idm/v" }).create[0].path, "/ats/idm/v");
  assert.equal(plan.create[0].path, null);
});

test("applyPathOverrides: overwrite.source ikut, target tidak berubah, override kosong diabaikan, kunci prototype aman", () => {
  const o = { source: { ...row("A"), path: "/ats/a" }, target: { ...row("A", "old"), path: "/ats/target-a" } };
  const plan: CopyPlan = { create: [{ ...row("constructor"), path: "/ats/c" }], overwrite: [o], same: ["S"], targetOnly: [], duplicates: [], unselected: ["U"] };
  const out = applyPathOverrides(plan, { A: " /ats/idm/a " });
  assert.equal(out.overwrite[0].source.path, "/ats/idm/a");
  assert.equal(out.overwrite[0].target.path, "/ats/target-a");
  assert.equal(o.source.path, "/ats/a");
  assert.equal(out.create[0].path, "/ats/c"); // "constructor" bukan override milik sendiri
  assert.equal(applyPathOverrides(plan, { A: "   " }).overwrite[0].source.path, "/ats/a");
  assert.deepEqual([out.same, out.unselected], [["S"], ["U"]]);
});

function setup(opts: { backup?: boolean; write?: boolean | Error; record?: boolean; discard?: boolean; finish?: boolean } = {}) {
  const calls: string[] = [];
  const plan: CopyPlan = {
    create: [row("B")],
    overwrite: [{ source: row("A"), target: row("A", "old") }],
    same: [], targetOnly: [], duplicates: [], unselected: [],
  };
  const parts = [tenantPart(plan)];
  const deps: CopyDeps = {
    createBatch: async () => { calls.push("createBatch"); return "b1"; },
    backupOld: async (o) => { calls.push(`backup:${o.target.config_type}`); if (opts.backup) throw new Error("backup down"); },
    discardBatchBackups: async () => { calls.push("discard"); if (opts.discard) throw new Error("discard down"); },
    writeTarget: async () => {
      calls.push("write");
      if (opts.write instanceof Error) throw opts.write;
      if (opts.write) throw new Error("write down");
      return [{ ...row("B"), domain: "tenant_config" }];
    },
    recordCreated: async (r) => { calls.push(`recorded:${r.config_type}`); if (opts.record) throw new Error("hist down"); },
    finishBatch: async (_b, status, error) => {
      calls.push(error === undefined ? `finish:${status}` : `finish:${status}:${error}`);
      if (opts.finish) throw new Error("neon down");
    },
  };
  return { calls, plan, parts, deps };
}

test("runCopy sukses", async () => {
  const s = setup();
  const r = await runCopy(s.parts, s.deps);
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "write", "recorded:B", "finish:berhasil"]);
  assert.deepEqual(r, { batchId: "b1", warnings: [] });
});

test("runCopy dua part: cadangan per part (membawa part-nya), satu writeTarget untuk semua part", async () => {
  const calls: string[] = [];
  const mk = (type: string): CopyPlan => ({ create: [], overwrite: [ow(type)], same: [], targetOnly: [], duplicates: [], unselected: [] });
  const parts = [tenantPart(mk("A")), workflowPart(mk("W"))];
  const deps: CopyDeps = {
    createBatch: async () => "b2",
    backupOld: async (o, part, batchId) => { calls.push(`backup:${part.domain}:${o.source.config_type}:${o.target.version_token}:${batchId}`); },
    discardBatchBackups: async () => { calls.push("discard"); },
    writeTarget: async (ps) => { calls.push(`write:${ps.length}`); return [{ ...row("N"), domain: "workflow_pipeline" }]; },
    recordCreated: async (r, batchId) => { calls.push(`recorded:${r.domain}:${r.config_type}:${batchId}`); },
    finishBatch: async (_b, status) => { calls.push(`finish:${status}`); },
  };
  const r = await runCopy(parts, deps);
  assert.deepEqual(calls, [
    "backup:tenant_config:A:old:b2", "backup:workflow_pipeline:W:old:b2", "write:2", "recorded:workflow_pipeline:N:b2", "finish:berhasil",
  ]);
  assert.deepEqual(r, { batchId: "b2", warnings: [] });
});

test("backup gagal → tujuan tidak ditulis", async () => {
  const s = setup({ backup: true });
  await assert.rejects(runCopy(s.parts, s.deps), /backup down/);
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "discard", "finish:gagal:backup down"]);
});

test("write gagal → cadangan dibuang", async () => {
  const s = setup({ write: true });
  await assert.rejects(runCopy(s.parts, s.deps), /write down/);
  assert.deepEqual(s.calls.slice(-3), ["write", "discard", "finish:gagal:write down"]);
});

test("error asli tetap dilempar bila discard gagal", async () => {
  const s = setup({ write: true, discard: true });
  await assert.rejects(runCopy(s.parts, s.deps), /write down/);
  assert.deepEqual(s.calls.slice(-3), ["write", "discard", "finish:gagal:write down"]);
});

test("COMMIT tidak pasti → cadangan TIDAK dibuang, batch gagal dengan pesan khusus, error asli dilempar", async () => {
  const uncertain = new CommitUncertainError(new Error("connection terminated"));
  const s = setup({ write: uncertain });
  await assert.rejects(runCopy(s.parts, s.deps), (e) => e === uncertain);
  assert.ok(!s.calls.includes("discard"));
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "write", `finish:gagal:${COMMIT_UNCERTAIN_MESSAGE}`]);
  assert.equal(COMMIT_UNCERTAIN_MESSAGE, "Hasil COMMIT tidak pasti; periksa tujuan. Cadangan isi lama tetap disimpan.");
});

test("COMMIT tidak pasti + finishBatch gagal → error asli tetap dilempar", async () => {
  const uncertain = new CommitUncertainError(new Error("connection terminated"));
  const s = setup({ write: uncertain, finish: true });
  await assert.rejects(runCopy(s.parts, s.deps), (e) => e === uncertain);
  assert.ok(!s.calls.includes("discard"));
});

test("recordCreated gagal → warning, tetap berhasil", async () => {
  const s = setup({ record: true });
  const r = await runCopy(s.parts, s.deps);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0], "Versi 1 B tidak tercatat di History: hist down");
  assert.equal(s.calls.at(-1), "finish:berhasil");
});

test("finishBatch berhasil gagal → tetap resolve dengan warning (tujuan sudah ditulis)", async () => {
  const s = setup({ finish: true });
  const r = await runCopy(s.parts, s.deps);
  assert.equal(r.batchId, "b1");
  assert.deepEqual(r.warnings, ["Status batch tidak diperbarui: neon down"]);
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "write", "recorded:B", "finish:berhasil"]);
});

// ---- writeCopyTxMulti: transaksi tulis ke DB tujuan, diuji dengan client palsu (tanpa DB) ----

function fakeClient(opts: {
  updateRows?: number; insertRows?: number; failRollback?: boolean; failOn?: "BEGIN" | "COMMIT";
  failUpdateOn?: string; conflictRows?: any[];
} = {}) {
  const sql: string[] = [];
  const released: unknown[] = [];
  const client: TxClient = {
    query: async (q: string) => {
      sql.push(q.trim());
      if (q.startsWith("ROLLBACK") && opts.failRollback) throw new Error("koneksi putus");
      if (opts.failOn && q === opts.failOn) throw new Error(`${opts.failOn} gagal`);
      if (q.includes("IS DISTINCT FROM")) return { rowCount: opts.conflictRows?.length ?? 0, rows: opts.conflictRows ?? [] };
      if (q.includes("UPDATE ")) {
        if (opts.failUpdateOn && q.includes(`UPDATE ${opts.failUpdateOn}`)) return { rowCount: 0, rows: [] };
        return { rowCount: opts.updateRows ?? 1, rows: [] };
      }
      if (q.includes("INSERT INTO")) {
        const n = opts.insertRows ?? 1;
        return { rowCount: n, rows: n ? [{ version_token: "2026-10-29 10:00:00+00" }] : [] };
      }
      return { rowCount: null, rows: [] };
    },
    release: (err?: Error | boolean) => { released.push(err); },
  };
  return { sql, released, connect: async () => client };
}

function copyPlan(): CopyPlan {
  const src = (type: string, value: any, path: string | null = null): ConfigRow => ({ ...row(type), value, path, is_default: true });
  return {
    create: [src("NEW_TYPE", { a: "it's" })],
    overwrite: [{ source: src("A", { b: 1 }, "custom-a"), target: { ...row("A", "2026-10-01 00:00:00+00"), id: "t-id-A" } }],
    same: [], targetOnly: [], duplicates: [], unselected: [],
  };
}

test("writeCopyTxMulti sukses: BEGIN → kunci → cek path → UPDATE berkunci versi → INSERT → COMMIT, client dilepas", async () => {
  const f = fakeClient();
  const created = await writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: "tt", groupId: "gg" }, () => "new-1");
  assert.deepEqual(f.sql.slice(0, 4), [
    "BEGIN",
    "SELECT pg_advisory_xact_lock(hashtext('public.tenant_configurations:tt'));",
    "SET LOCAL standard_conforming_strings = on;",
    "SET LOCAL lock_timeout = '5s';",
  ]);
  assert.equal(f.sql.at(-1), "COMMIT");
  assert.equal(f.sql.length, 8);
  assert.ok(!f.sql.includes("ROLLBACK"));
  const chk = f.sql[4];
  assert.match(chk, /^SELECT path, tenant_id, config_type FROM public\.tenant_configurations WHERE path IN \('new-type', 'custom-a'\) AND tenant_id IS DISTINCT FROM 'tt' AND deleted_at IS NULL/);
  const upd = f.sql[5];
  assert.match(upd, /^UPDATE public\.tenant_configurations/);
  assert.match(upd, /SET value = '\{"b":1\}'::jsonb, path = 'custom-a', updated_at = NOW\(\)/);
  assert.match(upd, /WHERE id = 't-id-A' AND updated_at::text = '2026-10-01 00:00:00\+00' AND deleted_at IS NULL/);
  const ins = f.sql[6];
  assert.match(ins, /INSERT INTO public\.tenant_configurations \(id, tenant_id, group_id, config_type, path, value, is_default, created_at, updated_at\)/);
  assert.match(ins, /SELECT 'new-1', 'tt', 'gg', 'NEW_TYPE', 'new-type', '\{"a":"it''s"\}'::jsonb, false, NOW\(\), NOW\(\)/);
  assert.match(ins, /WHERE NOT EXISTS \(SELECT 1 FROM public\.tenant_configurations WHERE tenant_id = 'tt' AND config_type = 'NEW_TYPE' AND deleted_at IS NULL\)/);
  assert.deepEqual(f.released, [undefined]);
  assert.deepEqual(created, [{
    id: "new-1", tenant_id: "tt", group_id: "gg", config_type: "NEW_TYPE", path: "new-type",
    value: { a: "it's" }, is_default: false, version_token: "2026-10-29 10:00:00+00", domain: "tenant_config",
  }]);
});

test("writeCopyTxMulti dua tabel: satu transaksi, workflow tanpa SQL path, baris baru membawa domain-nya", async () => {
  const f = fakeClient();
  const ids = ["n-tenant", "n-wf"];
  const created = await writeCopyTxMulti(
    f.connect, [tenantPart(copyPlan()), workflowPart(copyPlan())], { tenantId: "tt", groupId: "gg" }, () => ids.shift()!,
  );
  assert.equal(f.sql[0], "BEGIN");
  assert.equal(f.sql.at(-1), "COMMIT");
  assert.equal(f.sql.filter((q) => q === "BEGIN" || q === "COMMIT").length, 2);
  const wfSql = f.sql.filter((q) => q.includes("pipeline_workflow_configurations") && !q.includes("pg_advisory_xact_lock"));
  assert.equal(wfSql.length, 2); // UPDATE + INSERT saja, tanpa SELECT cek path
  for (const q of wfSql) assert.doesNotMatch(q, /\bpath\b/);
  assert.equal(f.sql.filter((q) => q.includes("IS DISTINCT FROM")).length, 1);
  assert.match(f.sql.find((q) => q.includes("IS DISTINCT FROM"))!, /FROM public\.tenant_configurations/);
  assert.deepEqual(created.map((c) => [c.domain, c.id, c.path]), [["tenant_config", "n-tenant", "new-type"], ["workflow_pipeline", "n-wf", null]]);
});

test("writeCopyTxMulti GLOBAL_DEFAULT: tenant NULL dan kondisi IS NULL, tanpa path di workflow", async () => {
  const f = fakeClient();
  const created = await writeCopyTxMulti(f.connect, [workflowPart(copyPlan())], { tenantId: null, groupId: null }, () => "new-1");
  assert.equal(f.sql[1], "SELECT pg_advisory_xact_lock(hashtext('public.pipeline_workflow_configurations:GLOBAL_DEFAULT'));");
  assert.equal(f.sql.length, 7); // BEGIN, kunci, 2 SET, UPDATE, INSERT, COMMIT
  const upd = f.sql[4];
  assert.doesNotMatch(upd, /path/);
  const ins = f.sql[5];
  assert.match(ins, /\(id, tenant_id, group_id, workflow_config_type, value, is_default, created_at, updated_at\)/);
  assert.match(ins, /SELECT 'new-1', NULL, NULL, 'NEW_TYPE', '/);
  assert.match(ins, /WHERE tenant_id IS NULL AND workflow_config_type = 'NEW_TYPE' AND deleted_at IS NULL/);
  assert.doesNotMatch(ins, /= NULL/);
  assert.equal(created[0].tenant_id, null);
  assert.equal(created[0].path, null);
});

test("writeCopyTxMulti: tujuan GLOBAL_DEFAULT (tenant NULL) pada tabel ber-path tidak menjalankan cek bentrok", async () => {
  const f = fakeClient();
  await writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: null, groupId: null }, () => "new-1");
  assert.ok(!f.sql.some((q) => q.includes("IS DISTINCT FROM")));
  assert.equal(f.sql.at(-1), "COMMIT");
});

test("writeCopyTxMulti: UPDATE 0 baris → ROLLBACK, tidak COMMIT, error dilempar, client dilepas", async () => {
  const f = fakeClient({ updateRows: 0 });
  await assert.rejects(writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: "tt", groupId: "tt" }), (e) => {
    assert.ok(e instanceof TargetChangedError);
    assert.equal(e.code, "TARGET_CHANGED");
    assert.equal(e.configType, "A");
    assert.match(e.message, /A di tujuan berubah/);
    assert.equal(isCommitUncertain(e), false);
    return true;
  });
  assert.equal(f.sql.at(-1), "ROLLBACK");
  assert.ok(!f.sql.includes("COMMIT"));
  assert.ok(!f.sql.some((q) => q.includes("INSERT INTO")));
  assert.deepEqual(f.released, [undefined]);
});

test("writeCopyTxMulti: INSERT 0 baris (sudah ada di tujuan) → ROLLBACK", async () => {
  const f = fakeClient({ insertRows: 0 });
  await assert.rejects(writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: "tt", groupId: "tt" }), (e) => {
    assert.ok(e instanceof TargetChangedError);
    assert.equal(e.configType, "NEW_TYPE");
    assert.match(e.message, /NEW_TYPE sudah ada di tujuan/);
    return true;
  });
  assert.equal(f.sql.at(-1), "ROLLBACK");
  assert.ok(!f.sql.includes("COMMIT"));
  assert.equal(f.released.length, 1);
});

test("gagal di tabel kedua membatalkan semuanya", async () => {
  const f = fakeClient({ failUpdateOn: "public.pipeline_workflow_configurations" });
  await assert.rejects(
    writeCopyTxMulti(f.connect, [tenantPart(copyPlan()), workflowPart(copyPlan())], { tenantId: "tt", groupId: "tt" }),
    (e) => {
      assert.ok(e instanceof TargetChangedError);
      assert.equal(e.configType, "A");
      return true;
    },
  );
  // tabel pertama sudah ditulis di dalam transaksi, lalu semuanya dibatalkan
  assert.ok(f.sql.some((q) => q.startsWith("UPDATE public.tenant_configurations")));
  assert.ok(f.sql.some((q) => q.startsWith("INSERT INTO public.tenant_configurations")));
  assert.equal(f.sql.at(-1), "ROLLBACK");
  assert.ok(!f.sql.includes("COMMIT"));
  assert.ok(!f.sql.some((q) => q.startsWith("INSERT INTO public.pipeline_workflow_configurations")));
  assert.deepEqual(f.released, [undefined]);
});

test("lock diambil tenant_configurations dulu walau parts terbalik", async () => {
  const f = fakeClient();
  await writeCopyTxMulti(f.connect, [workflowPart(copyPlan()), tenantPart(copyPlan())], { tenantId: "tt", groupId: "tt" });
  const locks = f.sql.filter((q) => q.includes("pg_advisory_xact_lock"));
  assert.deepEqual(locks, [
    "SELECT pg_advisory_xact_lock(hashtext('public.tenant_configurations:tt'));",
    "SELECT pg_advisory_xact_lock(hashtext('public.pipeline_workflow_configurations:tt'));",
  ]);
  // kedua kunci diambil sebelum SET LOCAL dan sebelum statement tulis pertama
  assert.deepEqual(f.sql.slice(0, 3), ["BEGIN", locks[0], locks[1]]);
  assert.equal(f.sql[3], "SET LOCAL standard_conforming_strings = on;");
  assert.equal(f.sql[4], "SET LOCAL lock_timeout = '5s';");
});

test("cek path di transaksi mengecualikan tenant tujuan dan menolak bentrok", async () => {
  const f = fakeClient({ conflictRows: [{ path: "custom-a", tenant_id: "t-9", config_type: "OTHER" }] });
  await assert.rejects(writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: "t-2", groupId: "t-2" }), (e) => {
    assert.ok(e instanceof PathConflictError);
    assert.equal(e.code, "PATH_CONFLICT");
    assert.deepEqual(e.paths, ["custom-a"]);
    assert.match(e.message, /custom-a/);
    assert.equal(isCommitUncertain(e), false);
    return true;
  });
  const chk = f.sql.find((q) => q.includes("IS DISTINCT FROM"))!;
  assert.match(chk, /tenant_id IS DISTINCT FROM 't-2'/);
  assert.match(chk, /deleted_at IS NULL/);
  assert.match(chk, /path IN \('new-type', 'custom-a'\)/);
  assert.ok(!f.sql.some((q) => q.includes("UPDATE ") || q.includes("INSERT INTO")));
  assert.equal(f.sql.at(-1), "ROLLBACK");
  assert.ok(!f.sql.includes("COMMIT"));
  assert.deepEqual(f.released, [undefined]);
});

test("baris baru selalu is_default false", async () => {
  const f = fakeClient();
  const plan = copyPlan();
  assert.equal(plan.create[0].is_default, true); // sumber is_default true
  const created = await writeCopyTxMulti(f.connect, [tenantPart(plan), workflowPart(copyPlan())], { tenantId: "tt", groupId: "tt" }, () => "n");
  const inserts = f.sql.filter((q) => q.startsWith("INSERT INTO"));
  assert.equal(inserts.length, 2);
  for (const ins of inserts) {
    assert.match(ins, /'\{"a":"it''s"\}'::jsonb, false, NOW\(\), NOW\(\)/);
    assert.doesNotMatch(ins, /true/);
  }
  assert.deepEqual(created.map((c) => c.is_default), [false, false]);
});

test("writeCopyTxMulti: ROLLBACK gagal → error asli dilempar, koneksi dibuang (release dengan error)", async () => {
  const f = fakeClient({ updateRows: 0, failRollback: true });
  await assert.rejects(writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: "tt", groupId: "tt" }), /A di tujuan berubah/);
  assert.equal(f.released.length, 1);
  assert.ok(f.released[0] instanceof Error);
});

test("writeCopyTxMulti: COMMIT melempar → error ditandai tidak pasti (cause = error asli), ROLLBACK dicoba, client dilepas", async () => {
  const f = fakeClient({ failOn: "COMMIT" });
  await assert.rejects(writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: "tt", groupId: "tt" }), (e) => {
    assert.ok(e instanceof CommitUncertainError);
    assert.equal(isCommitUncertain(e), true);
    assert.equal((e as Error).cause instanceof Error && ((e as Error).cause as Error).message, "COMMIT gagal");
    return true;
  });
  assert.deepEqual(f.sql.slice(-2), ["COMMIT", "ROLLBACK"]);
  assert.equal(f.released.length, 1);
});

test("writeCopyTxMulti: BEGIN melempar → bukan COMMIT tidak pasti", async () => {
  const f = fakeClient({ failOn: "BEGIN" });
  await assert.rejects(writeCopyTxMulti(f.connect, [tenantPart(copyPlan())], { tenantId: "tt", groupId: "tt" }), (e) => {
    assert.ok(!(e instanceof CommitUncertainError));
    assert.equal(isCommitUncertain(e), false);
    assert.match((e as Error).message, /BEGIN gagal/);
    return true;
  });
  assert.ok(!f.sql.includes("COMMIT"));
  assert.equal(f.released.length, 1);
});

test("writeCopyTx (pembungkus sementara) memanggil writeCopyTxMulti dengan satu part dan mengembalikan ConfigRow tanpa domain", async () => {
  const f = fakeClient();
  const created = await writeCopyTx(f.connect, TENANT_TABLE, copyPlan(), { tenantId: "tt", groupId: "gg" }, () => "new-1");
  assert.equal(f.sql.at(-1), "COMMIT");
  assert.equal(f.sql.filter((q) => q.startsWith("INSERT INTO")).length, 1);
  assert.deepEqual(created, [{
    id: "new-1", tenant_id: "tt", group_id: "gg", config_type: "NEW_TYPE", path: "new-type",
    value: { a: "it's" }, is_default: false, version_token: "2026-10-29 10:00:00+00",
  }]);
});
