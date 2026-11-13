import "./loadEnv";
import express from "express";
import { tableFor, type ServiceKey, type TableSpec } from "./services";

// Domain konfigurasi (tenant_config / workflow_pipeline) dan folder preset default per user.

// Domain konfigurasi: tenant_config (public.tenant_configurations) atau
// workflow_pipeline (public.pipeline_workflow_configurations). Keduanya ada di DB target (ats_db)
// dengan struktur hampir sama; bedanya kolom tipe (`workflow_config_type`) dan tidak ada kolom `path`.
// Tabel per domain kini ditentukan oleh layanan aktif (services.ts), bukan lagi di-hardcode ke ats_db.
export type ConfigDomain = "tenant_config" | "workflow_pipeline";
export interface DomainSpec extends TableSpec {
  key: ConfigDomain;
  /** kolom path untuk SELECT (NULL bila tabel tidak punya kolom path) */
  pathSel: string;
  /** key config_type di tenant_studio.preset_links, diberi prefix agar tidak bentrok antar domain */
  linkKey: (configType: string) => string;
}

export function domainSpecFor(service: ServiceKey, domain: ConfigDomain): DomainSpec | null {
  const t = tableFor(service, domain);
  if (!t) return null;
  return {
    ...t,
    key: domain,
    pathSel: t.hasPath ? "path" : "NULL::text AS path",
    linkKey: domain === "workflow_pipeline" ? (x) => `WORKFLOW_PIPELINE:${x}` : (x) => x
  };
}

/** Alias ATS untuk pemakai lama; dihapus setelah semua route memakai domainSpecFor */
export const DOMAINS: Record<ConfigDomain, DomainSpec> = {
  tenant_config: domainSpecFor("ats", "tenant_config")!,
  workflow_pipeline: domainSpecFor("ats", "workflow_pipeline")!
};

export function domainOf(req: express.Request): DomainSpec {
  const raw = req.header("x-config-domain") || (req.query.domain as string) || req.body?.domain;
  const service: ServiceKey = req.targetService?.key ?? "ats";
  return (raw === "workflow_pipeline" && domainSpecFor(service, "workflow_pipeline")) || domainSpecFor(service, "tenant_config")!;
}

// Folder preset default: preferensi user login per domain, lalu fallback env / bawaan
export const DEFAULT_PRESET_DIR = process.env.STUDIO_DEFAULT_PRESET_DIR || "/Users/ketutkusuma/Python/test_redis_stream/stable";
export function presetDirFor(req: express.Request): string {
  const prefs = req.user?.preferences;
  if (domainOf(req).key === "workflow_pipeline") {
    return prefs?.presetDirWorkflow || prefs?.presetDirTenant || DEFAULT_PRESET_DIR;
  }
  return prefs?.presetDirTenant || DEFAULT_PRESET_DIR;
}

// Optimistic locking: editor wajib mengirim versi (updated_at) yang ia muat terakhir.
// Jika DB sudah berubah sejak itu, simpan ditolak agar perubahan orang lain tidak tertimpa.
export function staleVersionError(expected: any, current: string): { error: string; code: string } | null {
  if (!expected) {
    return {
      code: "VERSION_REQUIRED",
      error: "Versi konfigurasi tidak diketahui. Muat ulang (pull) konfigurasi dari database sebelum menyimpan."
    };
  }
  if (expected !== current) {
    return {
      code: "STALE_VERSION",
      error: "Konfigurasi di database sudah berubah sejak terakhir Anda memuatnya. Pull/muat ulang dari database dulu, lalu terapkan ulang perubahan Anda."
    };
  }
  return null;
}
