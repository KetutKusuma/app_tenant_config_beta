import "./loadEnv";
import express from "express";
import { SERVICES, isServiceKey, tableFor, type ServiceKey, type TableSpec } from "./services";

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

export const CONFIG_DOMAINS: ConfigDomain[] = ["tenant_config", "workflow_pipeline"];
export function isConfigDomain(x: unknown): x is ConfigDomain {
  return typeof x === "string" && (CONFIG_DOMAINS as string[]).includes(x);
}

export function domainOf(req: express.Request): DomainSpec {
  const raw = req.header("x-config-domain") || (req.query.domain as string) || req.body?.domain;
  const service: ServiceKey = req.targetService?.key ?? "ats";
  return (raw === "workflow_pipeline" && domainSpecFor(service, "workflow_pipeline")) || domainSpecFor(service, "tenant_config")!;
}

// Folder preset default: preferensi user login per layanan + domain. ATS: kolom lama lalu fallback env / bawaan.
// Layanan lain TIDAK jatuh ke folder ATS (preset ATS tidak boleh ter-sync ke hris_db, dst.): null = belum diatur.
export const DEFAULT_PRESET_DIR = process.env.STUDIO_DEFAULT_PRESET_DIR || "/Users/ketutkusuma/Python/test_redis_stream/stable";
export function presetDirFor(req: express.Request): string | null {
  const prefs = req.user?.preferences;
  const service: ServiceKey = req.targetService?.key ?? "ats";
  const domain = domainOf(req).key;
  if (service !== "ats") return prefs?.presetDirs?.[`${service}:${domain}`] || null;
  if (domain === "workflow_pipeline") {
    return prefs?.presetDirWorkflow || prefs?.presetDirTenant || DEFAULT_PRESET_DIR;
  }
  return prefs?.presetDirTenant || DEFAULT_PRESET_DIR;
}

/**
 * Folder/berkas preset milik layanan LAIN? Pemilik ditentukan oleh folder terpanjang yang memuat path
 * (folder HRIS di dalam folder ATS tetap milik HRIS). Mengembalikan pesan error, atau null bila boleh.
 * Mencegah preset ATS dibaca/ditimpa saat layanan lain aktif (dan sebaliknya).
 */
export function foreignPresetDir(req: express.Request, p: string): string | null {
  const prefs = req.user?.preferences;
  const current: ServiceKey = req.targetService?.key ?? "ats";
  const owned: Array<{ dir: string; service: ServiceKey }> = [];
  const atsDirs = [prefs?.presetDirTenant, prefs?.presetDirWorkflow];
  if (atsDirs.some((d) => !d)) atsDirs.push(DEFAULT_PRESET_DIR);
  for (const d of atsDirs) if (d) owned.push({ dir: d, service: "ats" });
  for (const [k, d] of Object.entries(prefs?.presetDirs ?? {})) {
    const svc = k.split(":")[0];
    if (d && isServiceKey(svc)) owned.push({ dir: d, service: svc });
  }
  const norm = (x: string) => x.replace(/\/+$/, "");
  const target = norm(p.trim());
  let owner: { dir: string; service: ServiceKey } | null = null;
  for (const o of owned) {
    const dir = norm(o.dir);
    if ((target === dir || target.startsWith(dir + "/")) && (!owner || dir.length > norm(owner.dir).length)) owner = o;
  }
  if (!owner || owner.service === current) return null;
  return `Folder ${owner.dir} adalah folder preset layanan ${SERVICES[owner.service].label}. Pilih folder preset untuk layanan ${SERVICES[current].label}.`;
}

/** Response 400 untuk layanan non-ATS yang folder presetnya belum diatur */
export function presetDirMissing(req: express.Request): { code: string; error: string } {
  const label = req.targetService?.label ?? "ATS";
  return { code: "PRESET_DIR_REQUIRED", error: `Folder preset untuk layanan ${label} belum diatur.` };
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
