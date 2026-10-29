import { test } from "node:test";
import assert from "node:assert/strict";
import { planCopy, staleConfigTypes, runCopy, type CopyDeps, type CopyPlan } from "./copyConfigs";
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
  assert.deepEqual(staleConfigTypes(plan, { A: "t1" }, [row("A", "t1")]), []);
});

function setup(opts: { backup?: boolean; write?: boolean; record?: boolean; discard?: boolean } = {}) {
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
    writeTarget: async () => { calls.push("write"); if (opts.write) throw new Error("write down"); return [row("B")]; },
    recordCreated: async (r) => { calls.push(`recorded:${r.config_type}`); if (opts.record) throw new Error("hist down"); },
    finishBatch: async (_b, status) => { calls.push(`finish:${status}`); },
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
  assert.deepEqual(s.calls, ["createBatch", "backup:A", "discard", "finish:gagal"]);
});

test("write gagal → cadangan dibuang", async () => {
  const s = setup({ write: true });
  await assert.rejects(runCopy(s.plan, s.deps), /write down/);
  assert.deepEqual(s.calls.slice(-3), ["write", "discard", "finish:gagal"]);
});

test("error asli tetap dilempar bila discard gagal", async () => {
  const s = setup({ write: true, discard: true });
  await assert.rejects(runCopy(s.plan, s.deps), /write down/);
  assert.deepEqual(s.calls.slice(-3), ["write", "discard", "finish:gagal"]);
});

test("recordCreated gagal → warning, tetap berhasil", async () => {
  const s = setup({ record: true });
  const r = await runCopy(s.plan, s.deps);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0], "Versi 1 B tidak tercatat di History: hist down");
  assert.equal(s.calls.at(-1), "finish:berhasil");
});
