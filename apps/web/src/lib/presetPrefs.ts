import type { StudioUser } from "../components/AuthGate";
import type { ConfigDomain, ServiceKey } from "../types";

// Folder preset per layanan + domain. ATS memakai kolom lama; layanan lain tidak memakai folder ATS.

export function presetDirPref(prefs: StudioUser["preferences"], service: ServiceKey, domain: ConfigDomain): string {
  if (service !== "ats") return prefs.presetDirs?.[`${service}:${domain}`] || "";
  return domain === "workflow_pipeline" ? prefs.presetDirWorkflow || "" : prefs.presetDirTenant || "";
}

export function presetDirPrefPatch(service: ServiceKey, domain: ConfigDomain, dir: string): Partial<StudioUser["preferences"]> {
  if (service !== "ats") return { presetDirs: { [`${service}:${domain}`]: dir } };
  return domain === "workflow_pipeline" ? { presetDirWorkflow: dir } : { presetDirTenant: dir };
}
