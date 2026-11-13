import { extraSelect, liveWhere } from "../configRows";
import type { Pool } from "pg";
import { auditDb, esc } from "../db";
import type { DomainSpec } from "../domain";
import { baseTenantCode, listProfiles, type TargetEnvProfile } from "../envs";
import type { ConfigRow } from "./types";

// Helper baca-saja untuk banding antar env (dan dipakai ulang task berikutnya).

export function tenantWhere(tenantId: string): string {
  return tenantId === "GLOBAL_DEFAULT" ? "tenant_id IS NULL" : `tenant_id = ${esc(tenantId)}`;
}

export async function fetchTenantRows(pool: Pool, D: DomainSpec, tenantId: string, configTypes?: string[]): Promise<ConfigRow[]> {
  if (configTypes && configTypes.length === 0) return [];
  const typeFilter = configTypes ? ` AND ${D.typeCol} IN (${configTypes.map(esc).join(", ")})` : "";
  const r = await pool.query(`
    SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, ${D.pathSel}, value, is_default, updated_at::text AS version_token${extraSelect(D)}
    FROM ${D.table}
    WHERE ${tenantWhere(tenantId)} AND ${liveWhere(D)}${typeFilter}
    ORDER BY ${D.typeCol} ASC;
  `);
  return r.rows as ConfigRow[];
}

export function findProfile(name: string): TargetEnvProfile | undefined {
  return listProfiles().profiles.find((p) => p.name === name);
}

export async function fetchTenantMeta(
  env: string,
  tenantId: string
): Promise<{ tenantId: string; groupId: string | null; name: string; code: string; baseCode: string } | null> {
  const r = await auditDb.query(`
    SELECT tenant_id, group_id, client_name, client_code
    FROM tenant_studio.tenant_metadata
    WHERE target_env = ${esc(env)} AND tenant_id = ${esc(tenantId)};
  `);
  const m = r.rows[0];
  if (!m) return null;
  const suffix = findProfile(env)?.tenantCodeSuffix ?? "";
  const code: string = m.client_code || "";
  return { tenantId: m.tenant_id, groupId: m.group_id || null, name: m.client_name, code, baseCode: baseTenantCode(code, suffix) };
}
