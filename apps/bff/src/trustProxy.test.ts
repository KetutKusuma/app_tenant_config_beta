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
