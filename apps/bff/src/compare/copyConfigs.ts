import type { CompareEntry, ConfigRow } from "./types";

export interface CopyPlan {
  create: ConfigRow[];
  overwrite: Array<{ source: ConfigRow; target: ConfigRow }>;
  same: string[];
  targetOnly: string[];
  duplicates: string[];
}

export function planCopy(entries: CompareEntry[]): CopyPlan {
  const plan: CopyPlan = { create: [], overwrite: [], same: [], targetOnly: [], duplicates: [] };
  for (const e of entries) {
    if (e.status === "hanya_kiri" && e.left) plan.create.push(e.left);
    else if (e.status === "beda" && e.left && e.right) plan.overwrite.push({ source: e.left, target: e.right });
    else if (e.status === "sama") plan.same.push(e.configType);
    else if (e.status === "hanya_kanan") plan.targetOnly.push(e.configType);
    else if (e.status === "ganda") plan.duplicates.push(e.configType);
  }
  return plan;
}

export function staleConfigTypes(plan: CopyPlan, expected: Record<string, string | null>, currentTarget: ConfigRow[]): string[] {
  const types = [...plan.create.map((r) => r.config_type), ...plan.overwrite.map((o) => o.source.config_type)];
  const stale = new Set<string>();
  for (const type of types) {
    const current = currentTarget.find((r) => r.config_type === type)?.version_token ?? null;
    if (current !== (expected[type] ?? null)) stale.add(type);
  }
  return [...stale].sort();
}

export interface CopyDeps {
  createBatch(): Promise<string>;
  backupOld(target: ConfigRow, batchId: string): Promise<void>;
  discardBatchBackups(batchId: string): Promise<void>;
  writeTarget(plan: CopyPlan): Promise<ConfigRow[]>;
  recordCreated(row: ConfigRow, batchId: string): Promise<void>;
  finishBatch(batchId: string, status: "berhasil" | "gagal", error?: string): Promise<void>;
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runCopy(plan: CopyPlan, deps: CopyDeps): Promise<{ batchId: string; warnings: string[] }> {
  const batchId = await deps.createBatch();

  const fail = async (err: unknown): Promise<never> => {
    try { await deps.discardBatchBackups(batchId); } catch (e) { console.error("discardBatchBackups gagal:", e); }
    try { await deps.finishBatch(batchId, "gagal", msgOf(err)); } catch (e) { console.error("finishBatch gagal:", e); }
    throw err;
  };

  try {
    for (const o of plan.overwrite) await deps.backupOld(o.target, batchId);
  } catch (e) {
    return fail(e);
  }

  let created: ConfigRow[];
  try {
    created = await deps.writeTarget(plan);
  } catch (e) {
    return fail(e);
  }

  const warnings: string[] = [];
  for (const row of created) {
    try {
      await deps.recordCreated(row, batchId);
    } catch (e) {
      warnings.push(`Versi 1 ${row.config_type} tidak tercatat di History: ${msgOf(e)}`);
    }
  }
  await deps.finishBatch(batchId, "berhasil");
  return { batchId, warnings };
}
