import "./loadEnv";
import { Pool } from "pg";

// Koneksi Audit DB (NeonDB, schema tenant_studio) + helper escape SQL.

// Helper to escape values safely for Neon SQL proxy
export function esc(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  return "'" + String(val).replace(/'/g, "''") + "'";
}

// 2. Audit & Studio Metadata Database (tetap tersimpan di NeonDB ats_db)
export const auditDb = new Pool({
  connectionString: process.env.AUDIT_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
});
auditDb.on("error", (err) => console.error("Audit DB Pool Error:", err.message));
