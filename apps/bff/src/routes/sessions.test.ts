import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { router } from "./sessions.js";
import { auditDb } from "../db.js";

const U = "00000000-0000-0000-0000-000000000001";
const SID = "00000000-0000-0000-0000-0000000000aa";
const user: any = { id: U, email: "u@x.co", displayName: "U", role: "user", mustChangePassword: false };

// Validasi harus selesai sebelum query DB: pool diganti agar query/connect apa pun menggagalkan tes.
let dbCalls = 0;
(auditDb as any).query = async () => { dbCalls++; throw new Error("query tidak boleh dipanggil"); };
(auditDb as any).connect = async () => { dbCalls++; throw new Error("connect tidak boleh dipanggil"); };

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = user; req.sessionId = SID; next(); });
app.use(router);
const server = app.listen(0);
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await new Promise((r) => server.close(r));
});

test("DELETE sesi dengan id bukan UUID: 404 tanpa query", async () => {
  const res = await fetch(`${base()}/api/auth/sessions/bukan-uuid`, { method: "DELETE" });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Sesi tidak ditemukan.");
  assert.equal(dbCalls, 0);
});

test("DELETE sesi yang sedang dipakai: 400 tanpa query", async () => {
  const res = await fetch(`${base()}/api/auth/sessions/${SID}`, { method: "DELETE" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "Gunakan Logout untuk perangkat ini.");
  assert.equal(dbCalls, 0);
});
