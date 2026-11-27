import fs from "fs";
import path from "path";
import { auditDb, esc } from "./db";
import type { StudioScope } from "./services";
import type { Actor } from "./auth";

// Helper Sync Center: perbandingan JSON kanonik, file preset, snapshot riwayat, preset_links.

// Urutkan key secara rekursif agar urutan key (jsonb vs file) tidak dianggap perbedaan
export function canonicalize(v: any): any {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((acc: any, k) => {
      acc[k] = canonicalize(v[k]);
      return acc;
    }, {});
  }
  return v;
}
export function sameJson(a: any, b: any): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}
export function normalizeName(s: any): string {
  if (!s || typeof s !== "string") return "";
  return s.replace(/\.json$/i, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}
export function isSafePresetPath(p: any): p is string {
  return typeof p === "string" && path.isAbsolute(p) && p.toLowerCase().endsWith(".json");
}
export function scanJsonFiles(dir: string): Array<{ path: string; name: string; mtime: number }> {
  const out: Array<{ path: string; name: string; mtime: number }> = [];
  const walk = (cur: string) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith(".json")) {
        out.push({ path: full, name: entry.name, mtime: fs.statSync(full).mtimeMs });
      }
    }
  };
  walk(dir);
  return out;
}
// Tulis file dengan cadangan 1 level (<file>.bak, bukan .json sehingga tidak ikut terpindai)
export function writeJsonFileWithBackup(filePath: string, value: any): { existed: boolean } {
  const existed = fs.existsSync(filePath);
  if (existed) fs.copyFileSync(filePath, filePath + ".bak");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
  return { existed };
}
export async function snapshotBeforeChange(row: any, summary: string | ((version: number) => string), author: Actor, scope: StudioScope, batchId: string | null = null): Promise<{ historyId: string; version: number }> {
  const v = await auditDb.query(`
    SELECT COALESCE(MAX(version), 0) AS last_version
    FROM tenant_studio.tenant_config_histories
    WHERE core_config_id = ${esc(row.id)} AND target_env = ${esc(scope.env)} AND target_service = ${esc(scope.service)};
  `);
  const nextVersion = parseInt(v.rows[0].last_version, 10) + 1;
  // change_summary adalah varchar(500): potong sebagai jaring pengaman bila pemanggil tidak memakai composeNote
  const summaryText = (typeof summary === "function" ? summary(nextVersion) : summary).slice(0, 500);
  const ins = await auditDb.query(`
    INSERT INTO tenant_studio.tenant_config_histories
    (tenant_id, group_id, config_type, core_config_id, version, config_value, change_summary, author_name, author_id, target_env, target_service${batchId ? ", batch_id" : ""})
    VALUES (
      ${row.tenant_id ? esc(row.tenant_id) : "NULL"},
      ${row.group_id ? esc(row.group_id) : "NULL"},
      ${esc(row.config_type || "UNKNOWN")},
      ${esc(row.id)},
      ${nextVersion},
      ${esc(JSON.stringify(row.value || {}))}::jsonb,
      ${esc(summaryText)},
      ${esc(author.name)},
      ${esc(author.id)},
      ${esc(scope.env)},
      ${esc(scope.service)}${batchId ? `,\n      ${esc(batchId)}` : ""}
    )
    RETURNING id;
  `);
  return { historyId: String(ins.rows[0].id), version: nextVersion };
}
export async function discardSnapshot(historyId: string): Promise<void> {
  await auditDb.query(`DELETE FROM tenant_studio.tenant_config_histories WHERE id = ${esc(historyId)};`);
}
export async function discardBatchSnapshots(batchId: string): Promise<void> {
  await auditDb.query(`DELETE FROM tenant_studio.tenant_config_histories WHERE batch_id = ${esc(batchId)};`);
}
export async function upsertPresetLink(userId: string, scope: StudioScope, tenantId: string, configType: string, filePath: string) {
  await auditDb.query(`
    INSERT INTO tenant_studio.preset_links (user_id, target_env, target_service, tenant_id, config_type, file_path, updated_at)
    VALUES (${esc(userId)}, ${esc(scope.env)}, ${esc(scope.service)}, ${esc(tenantId)}, ${esc(configType)}, ${esc(filePath)}, NOW())
    ON CONFLICT (user_id, target_env, target_service, tenant_id, config_type) DO UPDATE
    SET file_path = EXCLUDED.file_path,
        base_db_version = CASE WHEN preset_links.file_path = EXCLUDED.file_path THEN preset_links.base_db_version END,
        updated_at = NOW();
  `);
}
export async function setPresetBase(userId: string, scope: StudioScope, tenantId: string, configType: string, filePath: string, versionToken: string) {
  await upsertPresetLink(userId, scope, tenantId, configType, filePath);
  await auditDb.query(`
    UPDATE tenant_studio.preset_links SET base_db_version = ${esc(versionToken)}
    WHERE user_id = ${esc(userId)} AND target_env = ${esc(scope.env)} AND target_service = ${esc(scope.service)} AND tenant_id = ${esc(tenantId)} AND config_type = ${esc(configType)};
  `);
}
