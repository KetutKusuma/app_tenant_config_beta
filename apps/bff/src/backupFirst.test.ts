import { test } from "node:test";
import assert from "node:assert/strict";
import { backupThenWrite } from "./backupFirst";

// Buat fake yang mencatat panggilan ke `calls`
function fakes(opts: { backup?: () => string; write?: () => number | null; discard?: () => void } = {}) {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      backup: async () => {
        calls.push("backup");
        return opts.backup ? opts.backup() : "h1";
      },
      write: async () => {
        calls.push("write");
        return opts.write ? opts.write() : 7;
      },
      discard: async (id: string) => {
        calls.push(`discard:${id}`);
        opts.discard?.();
      },
    },
  };
}

test("backup gagal → write dan discard tidak dipanggil", async () => {
  const f = fakes({ backup: () => { throw new Error("neon down"); } });
  await assert.rejects(backupThenWrite(f.steps), /neon down/);
  assert.deepEqual(f.calls, ["backup"]);
});

test("write null → cadangan dibuang, status stale", async () => {
  const f = fakes({ write: () => null });
  assert.deepEqual(await backupThenWrite(f.steps), { status: "stale" });
  assert.deepEqual(f.calls, ["backup", "write", "discard:h1"]);
});

test("write melempar error pg dari server → cadangan dibuang lalu error diteruskan", async () => {
  const f = fakes({ write: () => { throw Object.assign(new Error("duplicate key"), { severity: "ERROR", code: "23505" }); } });
  await assert.rejects(backupThenWrite(f.steps), /duplicate key/);
  assert.deepEqual(f.calls, ["backup", "write", "discard:h1"]);
});

test("write melempar error koneksi → cadangan dipertahankan, dicatat, error diteruskan", async () => {
  const f = fakes({ write: () => { throw new Error("connection terminated"); } });
  const logged: unknown[] = [];
  await assert.rejects(backupThenWrite({ ...f.steps, onWriteUncertain: (e, id) => logged.push([e instanceof Error ? e.message : e, id]) }), /connection terminated/);
  assert.deepEqual(f.calls, ["backup", "write"]);
  assert.deepEqual(logged, [["connection terminated", "h1"]]);
});

test("sukses → tanpa discard", async () => {
  const f = fakes();
  assert.deepEqual(await backupThenWrite(f.steps), { status: "written", result: 7, historyId: "h1" });
  assert.deepEqual(f.calls, ["backup", "write"]);
});

test("discard gagal → onDiscardError dipanggil, hasil tetap stale", async () => {
  const f = fakes({ write: () => null, discard: () => { throw new Error("discard fail"); } });
  const errs: unknown[] = [];
  const res = await backupThenWrite({ ...f.steps, onDiscardError: (e) => errs.push(e) });
  assert.deepEqual(res, { status: "stale" });
  assert.equal(errs.length, 1);
});
