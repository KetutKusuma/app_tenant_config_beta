import express from "express";
import { domainOf } from "../domain";
import { poolFor } from "../envs";
import { buildCompareEntries, loadSides } from "../compare/compareEntries";
import { fetchTenantRows, findProfile } from "../compare/tenantRows";

// Route: banding seluruh config satu tenant di env A dengan satu tenant di env B (baca saja).

export const router = express.Router();

router.get("/api/compare", async (req, res) => {
  try {
    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : "");
    const leftEnv = q("leftEnv"), leftTenant = q("leftTenant"), rightEnv = q("rightEnv"), rightTenant = q("rightTenant");
    if (!leftEnv || !leftTenant || !rightEnv || !rightTenant) {
      return res.status(400).json({ error: "Parameter leftEnv, leftTenant, rightEnv, dan rightTenant wajib diisi" });
    }
    const lp = findProfile(leftEnv), rp = findProfile(rightEnv);
    if (!lp) return res.status(400).json({ error: `Env '${leftEnv}' tidak dikenal` });
    if (!rp) return res.status(400).json({ error: `Env '${rightEnv}' tidak dikenal` });

    const D = domainOf(req);
    const loaded = await loadSides(
      () => fetchTenantRows(poolFor(leftEnv), D, leftTenant),
      () => fetchTenantRows(poolFor(rightEnv), D, rightTenant),
      { kiri: lp.label, kanan: rp.label }
    );
    if (!loaded.ok) return res.status(502).json({ error: loaded.error, side: loaded.side });
    res.json({ data: buildCompareEntries(loaded.left, loaded.right) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
