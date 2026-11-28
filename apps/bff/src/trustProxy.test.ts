import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { TRUST_PROXY } from "./trustProxy.js";

async function ipFor(xff: string): Promise<string> {
  const app = express();
  app.set("trust proxy", TRUST_PROXY);
  app.get("/ip", (req, res) => res.send(req.ip));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const r = await fetch(`http://127.0.0.1:${port}/ip`, { headers: { "X-Forwarded-For": xff } });
    return await r.text();
  } finally {
    server.close();
  }
}

test("trust proxy: IP klien dari X-Forwarded-For lewat loopback", async () => {
  assert.equal(await ipFor("203.0.113.7"), "203.0.113.7");
});

test("trust proxy: hop publik terakhir, bukan nilai pertama yang bisa dipalsukan", async () => {
  assert.equal(await ipFor("203.0.113.7, 198.51.100.9"), "198.51.100.9");
});

test("trust proxy: pemanggil langsung dari alamat publik tidak dipercaya, loopback/privat dipercaya", () => {
  const app = express();
  app.set("trust proxy", TRUST_PROXY);
  const trust = app.get("trust proxy fn") as (ip: string, hop: number) => boolean;
  assert.equal(trust("203.0.113.5", 0), false);
  assert.equal(trust("100.64.0.1", 0), false);
  assert.equal(trust("127.0.0.1", 0), true);
  assert.equal(trust("172.18.0.1", 0), true);
});
