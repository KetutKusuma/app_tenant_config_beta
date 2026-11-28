import type { CompareEntry, ConfigRow } from "../types";

export function prettyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

export function sideEditable(
  entry: CompareEntry | null,
  side: "left" | "right",
  envReadonly: boolean,
): boolean {
  if (!entry || envReadonly) return false;
  if (entry.status === "ganda") return false;
  return entry[side] !== null;
}

export function isDirty(draft: string | undefined, row: ConfigRow | null): boolean {
  if (draft === undefined || row === null) return false;
  return draft !== prettyValue(row.value);
}

const DEFAULT_TYPE = "CANDIDATE_STABLE";

export function pickConfigAfterSwitch<T extends { config_type: string }>(
  configs: T[],
  preferType?: string | null,
): { config: T | null; missingType: string | null } {
  if (configs.length === 0) return { config: null, missingType: null };
  if (preferType) {
    const hit = configs.find((c) => c.config_type === preferType);
    if (hit) return { config: hit, missingType: null };
  }
  const fallback = configs.find((c) => c.config_type === DEFAULT_TYPE) ?? configs[0];
  return { config: fallback, missingType: preferType ? preferType : null };
}
