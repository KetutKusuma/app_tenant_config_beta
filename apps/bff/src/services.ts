import type { ConfigDomain } from "./domain";

// Registri layanan: tiap layanan backend (ATS, HRIS, ...) punya database dan tabel config sendiri
// dengan format mirip public.tenant_configurations milik ats_db. Pilihan layanan per request
// lewat header X-Target-Service (lihat envs.ts). Menambah layanan cukup menambah entri di sini.

export type ServiceKey = "ats" | "hris" | "organization" | "auth" | "communication";

export interface TableSpec {
  /** Nama tabel schema-qualified, mis. "core.tenant_configurations" */
  table: string;
  /** Kolom kunci tipe config: "config_type" | "workflow_config_type" */
  typeCol: string;
  hasPath: boolean;
  /** Tipe kolom id. "varchar" (HRIS) berisi string UUID; jangan cast ::uuid */
  idType: "uuid" | "varchar";
  /** Kolom yang disalin apa adanya dari baris sumber saat Salin/Duplikat/Export SQL */
  extraCopyCols: string[];
  /** Kolom -> literal SQL untuk baris baru bila nilainya tidak datang dari sumber */
  extraInsertDefaults: Record<string, string>;
  /** true: group_id baris baru = group_id sumber (bukan group tenant tujuan) */
  groupIdFromSource: boolean;
}

export interface ServiceSpec {
  key: ServiceKey;
  label: string;
  defaultDbName: string;
  domains: { tenant_config: TableSpec; workflow_pipeline?: TableSpec };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      targetService?: ServiceSpec;
    }
  }
}

const tc = (table: string, over: Partial<TableSpec> = {}): TableSpec => ({
  table,
  typeCol: "config_type",
  hasPath: true,
  idType: "uuid",
  extraCopyCols: [],
  extraInsertDefaults: {},
  groupIdFromSource: false,
  ...over
});

const wf = (table: string, over: Partial<TableSpec> = {}): TableSpec => ({
  table,
  typeCol: "workflow_config_type",
  hasPath: false,
  idType: "uuid",
  extraCopyCols: [],
  extraInsertDefaults: {},
  groupIdFromSource: false,
  ...over
});

export const SERVICES: Record<ServiceKey, ServiceSpec> = {
  ats: {
    key: "ats",
    label: "ATS",
    defaultDbName: "ats_db",
    domains: {
      tenant_config: tc("public.tenant_configurations"),
      workflow_pipeline: wf("public.pipeline_workflow_configurations")
    }
  },
  hris: {
    key: "hris",
    label: "HRIS",
    defaultDbName: "hris_db",
    domains: {
      tenant_config: tc("public.tenant_configurations", { idType: "varchar", extraCopyCols: ["type"], groupIdFromSource: true }),
      workflow_pipeline: wf("workflow_pipelines.workflow_pipeline_configurations", {
        idType: "varchar",
        extraCopyCols: ["is_active"],
        extraInsertDefaults: { is_active: "true" },
        groupIdFromSource: true
      })
    }
  },
  organization: {
    key: "organization",
    label: "Organization",
    defaultDbName: "organization_db",
    domains: { tenant_config: tc("core.tenant_configurations", { extraCopyCols: ["type"] }) }
  },
  auth: {
    key: "auth",
    label: "Auth",
    defaultDbName: "auth_db",
    domains: { tenant_config: tc("public.tenant_configurations") }
  },
  communication: {
    key: "communication",
    label: "Communication",
    defaultDbName: "communication_db",
    domains: { tenant_config: tc("public.tenant_configurations") }
  }
};

export const SERVICE_KEYS: ServiceKey[] = ["ats", "hris", "organization", "auth", "communication"];

export function isServiceKey(x: unknown): x is ServiceKey {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(SERVICES, x);
}

export function tableFor(service: ServiceKey, domain: ConfigDomain): TableSpec | null {
  return SERVICES[service].domains[domain] ?? null;
}
