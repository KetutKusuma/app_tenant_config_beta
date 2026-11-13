import { test } from "node:test";
import assert from "node:assert/strict";
import { assertServiceInEnvs } from "./compareService.js";
import type { ServiceAvailability } from "../envs.js";

const avail = (available: boolean): ServiceAvailability[] => [
  { key: "hris", label: "HRIS", dbName: available ? "hris_db" : null, available, hasWorkflow: true, ...(available ? {} : { reason: "tidak dikonfigurasi" }) },
];

test("assertServiceInEnvs: env tanpa layanan aktif menghasilkan pesan berisi env dan layanan", async () => {
  const msg = await assertServiceInEnvs("hris", ["development", "neondb"], async (env) => avail(env !== "neondb"));
  assert.ok(msg);
  assert.match(msg!, /neondb/);
  assert.match(msg!, /HRIS/);
});

test("assertServiceInEnvs: semua env punya layanan -> null", async () => {
  assert.equal(await assertServiceInEnvs("hris", ["development", "staging"], async () => avail(true)), null);
});

test("assertServiceInEnvs: production-manual (bukan env DB) dilewati", async () => {
  assert.equal(await assertServiceInEnvs("hris", ["development", "production-manual"], async (env) => avail(env === "development")), null);
});
