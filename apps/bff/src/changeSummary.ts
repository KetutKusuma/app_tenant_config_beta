import { canonicalize } from "./presetSync";

// Ringkasan otomatis perubahan config dan validasi catatan (alasan) wajib. Murni, tanpa DB.

export const REASON_MAX = 500;
export const QUICK_SAVE_REASON = "Update via Tenant Studio";

const ROOT_PATH = "(akar)";
const EMPTY_PATH = "(kosong)";
const MAX_LISTED_PATHS = 5;

// Catatan wajib: di-trim, baris baru dilipat jadi satu spasi, tidak kosong, maksimal REASON_MAX karakter.
export function parseReason(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Catatan (alasan) wajib diisi" };
  const value = raw.trim().replace(/\s*[\r\n]+\s*/g, " ");
  if (value === "") return { ok: false, error: "Catatan (alasan) wajib diisi" };
  if (value.length > REASON_MAX) return { ok: false, error: `Catatan (alasan) maksimal ${REASON_MAX} karakter` };
  return { ok: true, value };
}

function kindOf(v: any): "null" | "array" | "object" | "primitive" {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return "primitive";
}

const hasKey = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// Beda isi dua nilai JSON, ditulis sebagai path bertitik ("a.b[2].c"). Key/indeks yang hanya ada di satu sisi
// dicatat pada node itu saja (subtree tidak dijabarkan); beda tipe atau beda nilai primitif = changed.
export function diffPaths(before: any, after: any): { changed: string[]; added: string[]; removed: string[] } {
  const out = { changed: [] as string[], added: [] as string[], removed: [] as string[] };

  const walk = (a: any, b: any, path: string) => {
    const ka = kindOf(a);
    if (ka !== kindOf(b)) {
      out.changed.push(path || ROOT_PATH);
      return;
    }
    if (ka === "object") {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const child = path ? `${path}.${key}` : key;
        const inA = hasKey(a, key);
        const inB = hasKey(b, key);
        if (inA && inB) walk(a[key], b[key], child);
        else if (inB) out.added.push(child);
        else out.removed.push(child);
      }
    } else if (ka === "array") {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const child = `${path}[${i}]`;
        if (i < a.length && i < b.length) walk(a[i], b[i], child);
        else if (i < b.length) out.added.push(child);
        else out.removed.push(child);
      }
    } else if (a !== b) {
      out.changed.push(path || ROOT_PATH);
    }
  };

  walk(canonicalize(before), canonicalize(after), "");
  return out;
}

// "a, b, c (+2 lainnya)": paling banyak MAX_LISTED_PATHS path, sisanya diringkas jadi hitungan.
function listPaths(paths: string[]): string {
  const rest = paths.length - MAX_LISTED_PATHS;
  return paths.slice(0, MAX_LISTED_PATHS).join(", ") + (rest > 0 ? ` (+${rest} lainnya)` : "");
}

// Ringkasan satu baris untuk catatan perubahan. `before === null` berarti config baru.
export function autoSummary(
  before: any | null,
  after: any,
  pathChange?: { from: string | null; to: string | null },
): string {
  if (before === null) return "Config baru";
  const { changed, added, removed } = diffPaths(before, after);
  const parts: string[] = [];
  if (changed.length > 0) parts.push(`Ubah ${changed.length} field: ${listPaths(changed)}`);
  // Rincian path tambah/hapus hanya ditampilkan bila tidak ada field yang berubah
  const detail = (paths: string[]) => (changed.length === 0 ? `: ${listPaths(paths)}` : "");
  if (added.length > 0) parts.push(`tambah ${added.length}${detail(added)}`);
  if (removed.length > 0) parts.push(`hapus ${removed.length}${detail(removed)}`);
  if (pathChange && pathChange.from !== pathChange.to) {
    parts.push(`path: ${pathChange.from ?? EMPTY_PATH} → ${pathChange.to ?? EMPTY_PATH}`);
  }
  if (parts.length === 0) return "Tidak ada perubahan isi";
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Bentuk tersimpan catatan: "<alasan> — <bagian otomatis digabung ' · '>". Bagian kosong dibuang.
export function composeNote(reason: string, ...parts: Array<string | null | undefined>): string {
  const rest = parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");
  return rest.length === 0 ? reason : `${reason} — ${rest.join(" · ")}`;
}
