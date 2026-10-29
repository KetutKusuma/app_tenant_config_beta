import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { auditDb, esc } from "./db";
import { registerAuth } from "./auth";
import { targetEnvMiddleware } from "./envs";
import { initStudioSchema } from "./studioSchema";
import { router as tenantRoutes } from "./routes/tenants";
import { router as configRoutes } from "./routes/configs";
import { router as validatorRoutes } from "./routes/validator";
import { router as referenceRoutes } from "./routes/references";
import { router as syncRoutes } from "./routes/sync";

// Titik masuk BFF Tenant Config Studio: middleware global lalu route per area (lihat routes/).

const app = express();
const PORT = process.env.PORT_BFF || process.env.PORT || 4000;

// Cookie session butuh origin eksplisit + credentials (bukan wildcard)
app.use(cors({ origin: process.env.STUDIO_WEB_ORIGIN || "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "50mb" }));

// Auth: /api/auth/* + middleware wajib login untuk seluruh /api lainnya
registerAuth(app, auditDb, esc);
// Target env (ats_db) per request: header X-Target-Env -> preferensi user -> default
app.use("/api", targetEnvMiddleware());

app.use(tenantRoutes);
app.use(configRoutes);
app.use(validatorRoutes);
app.use(referenceRoutes);
app.use(syncRoutes);

// Deploy (mis. Railway): BFF sekaligus menyajikan hasil build web agar /api satu origin dengan UI (cookie session SameSite=Lax)
const WEB_DIST = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

initStudioSchema();

app.listen(PORT, () => {
  console.log(`🚀 Tenant Config Studio BFF running on http://localhost:${PORT}`);
});
