import { canonicalize } from "../presetSync.js";
import type { CompareEntry, CompareStatus, CompareSummary, ConfigRow, Side } from "./types.js";

const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);

// Hitung path daun yang ditambah/dihapus/diubah (array per indeks)
function diffCount(a: any, b: any): number {
  const aC = isObj(a) || Array.isArray(a);
  const bC = isObj(b) || Array.isArray(b);
  if (aC && bC && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let n = 0;
    for (const k of keys) {
      const inA = Object.prototype.hasOwnProperty.call(a, k);
      const inB = Object.prototype.hasOwnProperty.call(b, k);
      if (inA && inB) n += diffCount(a[k], b[k]);
      else n += leafCount(inA ? a[k] : b[k]);
    }
    return n;
  }
  // daun vs objek (atau tipe beda) dihitung 1 di path ini
  return JSON.stringify(a) === JSON.stringify(b) ? 0 : 1;
}

// Sisi yang hanya ada di satu pihak: hitung per daun
function leafCount(v: any): number {
  if (isObj(v) || Array.isArray(v)) {
    const ks = Object.keys(v);
    return ks.length === 0 ? 1 : ks.reduce((s, k) => s + leafCount(v[k]), 0);
  }
  return 1;
}

export function countJsonChanges(a: any, b: any): number {
  return diffCount(canonicalize(a), canonicalize(b));
}

const ORDER: CompareStatus[] = ["beda", "hanya_kiri", "hanya_kanan", "ganda", "sama"];

const group = (rows: ConfigRow[]) => {
  const m = new Map<string, ConfigRow[]>();
  for (const r of rows) {
    const l = m.get(r.config_type);
    if (l) l.push(r);
    else m.set(r.config_type, [r]);
  }
  return m;
};

const canon = (r: ConfigRow | null): ConfigRow | null => (r ? { ...r, value: canonicalize(r.value) } : null);

export function buildCompareEntries(left: ConfigRow[], right: ConfigRow[]): { entries: CompareEntry[]; summary: CompareSummary } {
  const l = group(left);
  const r = group(right);
  const entries: CompareEntry[] = [];
  for (const configType of new Set([...l.keys(), ...r.keys()])) {
    const ls = l.get(configType) ?? [];
    const rs = r.get(configType) ?? [];
    const lf = canon(ls[0] ?? null);
    const rf = canon(rs[0] ?? null);
    let status: CompareStatus;
    let changeCount = 0;
    if (ls.length > 1 || rs.length > 1) status = "ganda";
    else if (!lf) status = "hanya_kanan";
    else if (!rf) status = "hanya_kiri";
    else {
      changeCount = diffCount(lf.value, rf.value);
      status = changeCount === 0 ? "sama" : "beda";
    }
    entries.push({ configType, status, changeCount, left: lf, right: rf });
  }
  entries.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.configType < b.configType ? -1 : a.configType > b.configType ? 1 : 0));
  const count = (s: CompareStatus) => entries.filter((e) => e.status === s).length;
  return {
    entries,
    summary: { total: entries.length, sama: count("sama"), beda: count("beda"), hanyaKiri: count("hanya_kiri"), hanyaKanan: count("hanya_kanan"), ganda: count("ganda") },
  };
}

// Jalankan kedua sisi paralel; bila keduanya gagal, lapor sisi kiri
export async function loadSides<T>(
  left: () => Promise<T>,
  right: () => Promise<T>,
  envLabels: { kiri: string; kanan: string },
): Promise<{ ok: true; left: T; right: T } | { ok: false; side: Side; error: string }> {
  const [l, r] = await Promise.allSettled([left(), right()]);
  const fail = (side: Side, res: PromiseRejectedResult) => ({
    ok: false as const,
    side,
    error: `Env ${envLabels[side]} (${side}) tidak terjangkau: ${res.reason?.message ?? String(res.reason)}`,
  });
  if (l.status === "rejected") return fail("kiri", l);
  if (r.status === "rejected") return fail("kanan", r);
  return { ok: true, left: l.value, right: r.value };
}
