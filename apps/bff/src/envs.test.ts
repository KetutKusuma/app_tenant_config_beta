import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceAvailability, servicePoolConfig, targetServiceMiddleware, type ServiceAvailability } from "./envs.js";

test("servicePoolConfig: hris memakai default hris_db di host yang sama", () => {
  const c = servicePoolConfig({ DB_HOST: "h", DB_NAME: "ats_db" }, "hris")!;
  assert.equal(c.database, "hris_db");
  assert.equal(c.host, "h");
});

test("servicePoolConfig: DB_NAME_HRIS menimpa default", () => {
  assert.equal(servicePoolConfig({ DB_HOST: "h", DB_NAME_HRIS: "hris_custom" }, "hris")!.database, "hris_custom");
});

test("servicePoolConfig: profil TARGET_DB_URL tanpa URL khusus layanan -> null", () => {
  assert.equal(servicePoolConfig({ TARGET_DB_URL: "postgres://u:p@x/ats" }, "hris"), null);
  assert.notEqual(servicePoolConfig({ TARGET_DB_URL: "postgres://u:p@x/ats", TARGET_DB_URL_HRIS: "postgres://u:p@x/hris" }, "hris"), null);
});

test("servicePoolConfig: ats tetap memakai DB_NAME (perilaku lama)", () => {
  assert.equal(servicePoolConfig({ DB_HOST: "h", DB_NAME: "ats_db" }, "ats")!.database, "ats_db");
  assert.ok(servicePoolConfig({ TARGET_DB_URL: "postgres://u:p@x/ats" }, "ats"));
});

test("serviceAvailability: layanan tanpa konfigurasi tidak tersedia, hasWorkflow sesuai registri", async () => {
  const list = await serviceAvailability("neondb", {
    configs: () => ({ ats: { database: "ats_db" } }),
    ping: async () => ({ ok: true })
  });
  const ats = list.find((s) => s.key === "ats")!;
  const hris = list.find((s) => s.key === "hris")!;
  const auth = list.find((s) => s.key === "auth")!;
  assert.equal(ats.available, true);
  assert.equal(ats.dbName, "ats_db");
  assert.equal(hris.available, false);
  assert.match(hris.reason!, /tidak dikonfigurasi/);
  assert.equal(hris.hasWorkflow, true);
  assert.equal(auth.hasWorkflow, false);
});

test("serviceAvailability: tabel config tidak ada -> tidak tersedia dengan alasan", async () => {
  const list = await serviceAvailability("development", {
    configs: () => ({ hris: { database: "hris_db" } }),
    ping: async () => ({ ok: false, reason: "tabel public.tenant_configurations tidak ditemukan" })
  });
  const hris = list.find((s) => s.key === "hris")!;
  assert.equal(hris.available, false);
  assert.match(hris.reason!, /tidak ditemukan/);
});

function fakeReqRes(opts: { method: string; header?: string; pref?: string | null }) {
  const req: any = {
    path: "/configs",
    method: opts.method,
    header: (n: string) => (n.toLowerCase() === "x-target-service" ? opts.header : undefined),
    user: { preferences: { lastTargetService: opts.pref ?? null } },
    targetEnv: { name: "development", label: "Development" }
  };
  const res: any = {
    statusCode: 200,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; }
  };
  return { req, res };
}

const allAvailable = async (): Promise<ServiceAvailability[]> =>
  (["ats", "hris", "organization", "auth", "communication"] as const).map((key) => ({ key, label: key, dbName: key, available: true, hasWorkflow: false }));

async function run(mw: any, req: any, res: any): Promise<boolean> {
  let called = false;
  await mw(req, res, () => { called = true; });
  return called;
}

test("middleware: POST tanpa header layanan ditolak TARGET_SERVICE_REQUIRED", async () => {
  const { req, res } = fakeReqRes({ method: "POST", pref: "hris" });
  const mw = targetServiceMiddleware({ availability: allAvailable, pool: () => ({}) as any });
  assert.equal(await run(mw, req, res), false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "TARGET_SERVICE_REQUIRED");
});

test("middleware: GET tanpa header memakai preferensi lastTargetService", async () => {
  const { req, res } = fakeReqRes({ method: "GET", pref: "hris" });
  const pools: string[] = [];
  const mw = targetServiceMiddleware({ availability: allAvailable, pool: (env, svc) => { pools.push(`${env}:${svc}`); return {} as any; } });
  assert.equal(await run(mw, req, res), true);
  assert.equal(req.targetService.key, "hris");
  assert.deepEqual(pools, ["development:hris"]);
});

test("middleware: GET tanpa header dan tanpa preferensi -> ats", async () => {
  const { req, res } = fakeReqRes({ method: "GET" });
  const mw = targetServiceMiddleware({ availability: allAvailable, pool: () => ({}) as any });
  assert.equal(await run(mw, req, res), true);
  assert.equal(req.targetService.key, "ats");
});

test("middleware: header layanan tak dikenal -> UNKNOWN_TARGET_SERVICE", async () => {
  const { req, res } = fakeReqRes({ method: "GET", header: "integrator" });
  const mw = targetServiceMiddleware({ availability: allAvailable, pool: () => ({}) as any });
  assert.equal(await run(mw, req, res), false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "UNKNOWN_TARGET_SERVICE");
});

test("middleware: layanan tidak tersedia di env -> 409 SERVICE_UNAVAILABLE", async () => {
  const { req, res } = fakeReqRes({ method: "POST", header: "hris" });
  const mw = targetServiceMiddleware({
    availability: async () => [{ key: "hris", label: "HRIS", dbName: null, available: false, hasWorkflow: true, reason: "tidak dikonfigurasi" }],
    pool: () => ({}) as any
  });
  assert.equal(await run(mw, req, res), false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "SERVICE_UNAVAILABLE");
  assert.match(res.body.error, /HRIS/);
  assert.match(res.body.error, /Development/);
});

test("middleware: route auth dan envs dilewati", async () => {
  const { req, res } = fakeReqRes({ method: "POST" });
  req.path = "/me/preferences";
  const mw = targetServiceMiddleware({ availability: allAvailable, pool: () => ({}) as any });
  assert.equal(await run(mw, req, res), true);
});

// ---- I1: DB tidak terjangkau tidak memblokir request (perilaku lama: route melapor sendiri) ----
test("middleware: layanan tidak terjangkau (koneksi) tetap diteruskan", async () => {
  const { req, res } = fakeReqRes({ method: "GET", header: "ats" });
  const mw = targetServiceMiddleware({
    availability: async () => [{ key: "ats", label: "ATS", dbName: "ats_db", available: false, unreachable: true, hasWorkflow: true, reason: "timeout" }],
    pool: () => ({}) as any
  });
  assert.equal(await run(mw, req, res), true);
  assert.equal(req.targetService.key, "ats");
});

test("serviceAvailability: ping gagal koneksi ditandai unreachable", async () => {
  const list = await serviceAvailability("development", {
    configs: () => ({ hris: { database: "hris_db" } }),
    ping: async () => ({ ok: false, unreachable: true, reason: "timeout" })
  });
  const hris = list.find((s) => s.key === "hris")!;
  assert.equal(hris.available, false);
  assert.equal(hris.unreachable, true);
});

// ---- I3: domain workflow diminta eksplisit untuk layanan tanpa workflow ----
test("middleware: X-Config-Domain workflow_pipeline di layanan Auth -> 400 DOMAIN_UNAVAILABLE", async () => {
  const { req, res } = fakeReqRes({ method: "GET", header: "auth" });
  const base = req.header;
  req.header = (n: string) => (n.toLowerCase() === "x-config-domain" ? "workflow_pipeline" : base(n));
  const mw = targetServiceMiddleware({ availability: allAvailable, pool: () => ({}) as any });
  assert.equal(await run(mw, req, res), false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "DOMAIN_UNAVAILABLE");
});
