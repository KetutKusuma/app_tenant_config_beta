import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planCopy, staleConfigTypes, runCopy, writeCopyTx, CommitUncertainError, TargetChangedError, isCommitUncertain,
  COMMIT_UNCERTAIN_MESSAGE, type CopyDeps, type CopyPlan, type TxClient,
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
});

test("staleConfigTypes: token berbeda atau muncul → stale, A→Z; same/targetOnly diabaikan", () => {
  const plan: CopyPlan = {
    create: [row("B")],
    overwrite: [{ source: row("A"), target: row("A", "t1") }],
    same: ["S"],
    targetOnly: ["T"],
    duplicates: [],
  };
  const current = [row("A", "t2"), row("B", "x"), row("S", "z"), row("T", "z")];
  assert.deepEqual(staleConfigTypes(plan, { A: "t1", B: null, S: "old", T: "old" }, current), ["A", "B"]);
  assert.deepEqual(staleConfigTypes(plan, { A: "t1", B: null }, [row("A", "t1")]), []);
});

test("staleConfigTypes: tipe rencana yang tidak ada di expected → stale (null eksplisit tetap berarti 'belum ada')", () => {
  const plan: CopyPlan = {
    create: [row("B"), row("C")],
    overwrite: [{ source: row("A"), target: row("A", "t1") }],
    same: [], targetOnly: [], duplicates: [],
  };
  // C tidak pernah dilihat user (sumber bertambah setelah banding) → stale walau tujuan juga belum punya C
  assert.deepEqual(staleConfigTypes(plan, { A: "t1", B: null }, [row("A", "t1")]), ["C"]);
  // A hilang dari expected → stale walau tokennya sama
  assert.deepEqual(staleConfigTypes(plan, { B: null, C: null }, [row("A", "t1")]), ["A"]);
  // kunci warisan prototype tidak dianggap ada
  const planProto: CopyPlan = { create: [row("constructor")], overwrite: [], same: [], targetOnly: [], duplicates: [] };
  assert.deepEqual(staleConfigTypes(planProto, {}, []), ["constructor"]);
});

function setup(opts: { backup?: boolean; write?: boolean | Error; record?: boolean; discard?: boolean; finish?: boolean } = {}) {
  const calls: string[] = [];
  const plan: CopyPlan = {
    create: [row("B")],
    overwrite: [{ source: row("A"), target: row("A", "old") }],
    same: [], targetOnly: [], duplicates: [],
  };
  const deps: CopyDeps = {
    createBatch: async () => { calls.push("createBatch"); return "b1"; },
    backupOld: async (t) => { calls.push(`backup:${t.config_type}`); if (opts.backup) throw new Error("backup down"); },
    discardBatchBackups: async () => { calls.push("discard"); if (opts.discard) throw new Error("discard down"); },
    writeTarget: async () => {
      calls.push("write");
      if (opts.write instanceof Error) throw opts.write;
      if (opts.write) throw new Error("write down");
      return [row("B")];
    },
    recordCreated: async (r) => { calls.push(`recorded:${r.config_type}`); if (opts.record) throw new Error("hist down"); },
    finishBatch: async (_b, status, error) => {
      calls.push(error === undefined ? `finish:${status}` : `finish:${status}:${error}`);
      if (opts.finish) throw new Error("neon down");
    },
  };
  return { calls, plan, deps };
}

test("runCopy sukses", async () => {
  const s = setup();
  const r = await runCopy(s.plan, s.deps);
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "write", "recorded:B", "finish:berhasil"]);
  assert.deepEqual(r, { batchId: "b1", warnings: [] });
});

test("backup gagal → tujuan tidak ditulis", async () => {
  const s = setup({ backup: true });
  await assert.rejects(runCopy(s.plan, s.deps), /backup down/);
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "discard", "finish:gagal:backup down"]);
});

test("write gagal → cadangan dibuang", async () => {
  const s = setup({ write: true });
  await assert.rejects(runCopy(s.plan, s.deps), /write down/);
  assert.deepEqual(s.calls.slice(-3), ["write", "discard", "finish:gagal:write down"]);
});

test("error asli tetap dilempar bila discard gagal", async () => {
  const s = setup({ write: true, discard: true });
  await assert.rejects(runCopy(s.plan, s.deps), /write down/);
  assert.deepEqual(s.calls.slice(-3), ["write", "discard", "finish:gagal:write down"]);
});

test("COMMIT tidak pasti → cadangan TIDAK dibuang, batch gagal dengan pesan khusus, error asli dilempar", async () => {
  const uncertain = new CommitUncertainError(new Error("connection terminated"));
  const s = setup({ write: uncertain });
  await assert.rejects(runCopy(s.plan, s.deps), (e) => e === uncertain);
  assert.ok(!s.calls.includes("discard"));
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "write", `finish:gagal:${COMMIT_UNCERTAIN_MESSAGE}`]);
  assert.equal(COMMIT_UNCERTAIN_MESSAGE, "Hasil COMMIT tidak pasti; periksa tujuan. Cadangan isi lama tetap disimpan.");
});

test("COMMIT tidak pasti + finishBatch gagal → error asli tetap dilempar", async () => {
  const uncertain = new CommitUncertainError(new Error("connection terminated"));
  const s = setup({ write: uncertain, finish: true });
  await assert.rejects(runCopy(s.plan, s.deps), (e) => e === uncertain);
  assert.ok(!s.calls.includes("discard"));
});

test("recordCreated gagal → warning, tetap berhasil", async () => {
  const s = setup({ record: true });
  const r = await runCopy(s.plan, s.deps);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0], "Versi 1 B tidak tercatat di History: hist down");
  assert.equal(s.calls.at(-1), "finish:berhasil");
});

test("finishBatch berhasil gagal → tetap resolve dengan warning (tujuan sudah ditulis)", async () => {
  const s = setup({ finish: true });
  const r = await runCopy(s.plan, s.deps);
  assert.equal(r.batchId, "b1");
  assert.deepEqual(r.warnings, ["Status batch tidak diperbarui: neon down"]);
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "write", "recorded:B", "finish:berhasil"]);
});

// ---- writeCopyTx: transaksi tulis ke DB tujuan, diuji dengan client palsu (tanpa DB) ----

const TENANT_TABLE = { table: "public.tenant_configurations", typeCol: "config_type", hasPath: true };
const WORKFLOW_TABLE = { table: "public.pipeline_workflow_configurations", typeCol: "workflow_config_type", hasPath: false };

function fakeClient(opts: { updateRows?: number; insertRows?: number; failRollback?: boolean; failOn?: "BEGIN" | "COMMIT" } = {}) {
  const sql: string[] = [];
  const released: unknown[] = [];
  const client: TxClient = {
    query: async (q: string) => {
      sql.push(q.trim());
      if (q.startsWith("ROLLBACK") && opts.failRollback) throw new Error("koneksi putus");
      if (opts.failOn && q === opts.failOn) throw new Error(`${opts.failOn} gagal`);
      if (q.includes("UPDATE ")) return { rowCount: opts.updateRows ?? 1, rows: [] };
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
    same: [], targetOnly: [], duplicates: [],
  };
}

test("writeCopyTx sukses: BEGIN → UPDATE berkunci versi → INSERT → COMMIT, client dilepas", async () => {
  const f = fakeClient();
  const created = await writeCopyTx(f.connect, TENANT_TABLE, copyPlan(), { tenantId: "tt", groupId: "gg" }, () => "new-1");
  assert.deepEqual(f.sql.slice(0, 4), [
    "BEGIN",
    "SELECT pg_advisory_xact_lock(hashtext('public.tenant_configurations:tt'));",
    "SET LOCAL standard_conforming_strings = on;",
    "SET LOCAL lock_timeout = '5s';",
  ]);
  assert.equal(f.sql.at(-1), "COMMIT");
  assert.equal(f.sql.length, 7);
  assert.ok(!f.sql.includes("ROLLBACK"));
  const upd = f.sql[4];
  assert.match(upd, /^UPDATE public\.tenant_configurations/);
  assert.match(upd, /SET value = '\{"b":1\}'::jsonb, path = 'custom-a', updated_at = NOW\(\)/);
  assert.match(upd, /WHERE id = 't-id-A' AND updated_at::text = '2026-10-01 00:00:00\+00' AND deleted_at IS NULL/);
  const ins = f.sql[5];
  assert.match(ins, /INSERT INTO public\.tenant_configurations \(id, tenant_id, group_id, config_type, path, value, is_default, created_at, updated_at\)/);
  assert.match(ins, /SELECT 'new-1', 'tt', 'gg', 'NEW_TYPE', 'new-type', '\{"a":"it''s"\}'::jsonb, true, NOW\(\), NOW\(\)/);
  assert.match(ins, /WHERE NOT EXISTS \(SELECT 1 FROM public\.tenant_configurations WHERE tenant_id = 'tt' AND config_type = 'NEW_TYPE' AND deleted_at IS NULL\)/);
  assert.deepEqual(f.released, [undefined]);
  assert.deepEqual(created, [{
    id: "new-1", tenant_id: "tt", group_id: "gg", config_type: "NEW_TYPE", path: "new-type",
    value: { a: "it's" }, is_default: true, version_token: "2026-10-29 10:00:00+00",
  }]);
});

test("writeCopyTx GLOBAL_DEFAULT: tenant NULL dan kondisi IS NULL, tanpa path di workflow", async () => {
  const f = fakeClient();
  const created = await writeCopyTx(f.connect, WORKFLOW_TABLE, copyPlan(), { tenantId: null, groupId: null }, () => "new-1");
  assert.equal(f.sql[1], "SELECT pg_advisory_xact_lock(hashtext('public.pipeline_workflow_configurations:GLOBAL_DEFAULT'));");
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

test("writeCopyTx: UPDATE 0 baris → ROLLBACK, tidak COMMIT, error dilempar, client dilepas", async () => {
  const f = fakeClient({ updateRows: 0 });
  await assert.rejects(writeCopyTx(f.connect, TENANT_TABLE, copyPlan(), { tenantId: "tt", groupId: "tt" }), (e) => {
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

test("writeCopyTx: INSERT 0 baris (sudah ada di tujuan) → ROLLBACK", async () => {
  const f = fakeClient({ insertRows: 0 });
  await assert.rejects(writeCopyTx(f.connect, TENANT_TABLE, copyPlan(), { tenantId: "tt", groupId: "tt" }), (e) => {
    assert.ok(e instanceof TargetChangedError);
    assert.equal(e.configType, "NEW_TYPE");
    assert.match(e.message, /NEW_TYPE sudah ada di tujuan/);
    return true;
  });
  assert.equal(f.sql.at(-1), "ROLLBACK");
  assert.ok(!f.sql.includes("COMMIT"));
  assert.equal(f.released.length, 1);
});

test("writeCopyTx: ROLLBACK gagal → error asli dilempar, koneksi dibuang (release dengan error)", async () => {
  const f = fakeClient({ updateRows: 0, failRollback: true });
  await assert.rejects(writeCopyTx(f.connect, TENANT_TABLE, copyPlan(), { tenantId: "tt", groupId: "tt" }), /A di tujuan berubah/);
  assert.equal(f.released.length, 1);
  assert.ok(f.released[0] instanceof Error);
});

test("writeCopyTx: COMMIT melempar → error ditandai tidak pasti (cause = error asli), ROLLBACK dicoba, client dilepas", async () => {
  const f = fakeClient({ failOn: "COMMIT" });
  await assert.rejects(writeCopyTx(f.connect, TENANT_TABLE, copyPlan(), { tenantId: "tt", groupId: "tt" }), (e) => {
    assert.ok(e instanceof CommitUncertainError);
    assert.equal(isCommitUncertain(e), true);
    assert.equal((e as Error).cause instanceof Error && ((e as Error).cause as Error).message, "COMMIT gagal");
    return true;
  });
  assert.deepEqual(f.sql.slice(-2), ["COMMIT", "ROLLBACK"]);
  assert.equal(f.released.length, 1);
});

test("writeCopyTx: BEGIN melempar → bukan COMMIT tidak pasti", async () => {
  const f = fakeClient({ failOn: "BEGIN" });
  await assert.rejects(writeCopyTx(f.connect, TENANT_TABLE, copyPlan(), { tenantId: "tt", groupId: "tt" }), (e) => {
    assert.ok(!(e instanceof CommitUncertainError));
    assert.equal(isCommitUncertain(e), false);
    assert.match((e as Error).message, /BEGIN gagal/);
    return true;
  });
  assert.ok(!f.sql.includes("COMMIT"));
  assert.equal(f.released.length, 1);
});
