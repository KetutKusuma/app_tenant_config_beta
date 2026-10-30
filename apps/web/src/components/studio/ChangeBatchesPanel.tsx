import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { DOMAIN_LABEL, type ChangeBatch, type CompareSide, type ConfigDomain } from "../../types";
import { useDialogEsc } from "./useDialogEsc";

const GHOST = "px-2 py-1 rounded-md text-[11px] text-slate-300 hover:bg-slate-800 transition disabled:opacity-40";
const TABLE: Record<string, string> = {
  tenant_config: "tenant_configurations",
  workflow_pipeline: "pipeline_workflow_configurations",
  semua: "semua"
};
const COUNT_LABEL: Record<string, string> = { hanyaTujuan: "hanya tujuan", tidakDipilih: "tidak dipilih" };
const TYPE_PREFIX = /^(tenant_config|workflow_pipeline):(.+)$/;
const STATUS_CLS: Record<string, string> = {
  berhasil: "bg-emerald-500/15 text-emerald-300",
  diekspor: "bg-sky-500/15 text-sky-300",
  gagal: "bg-rose-500/15 text-rose-300",
  menunggu: "bg-amber-500/15 text-amber-300"
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Meniru exportFileName di BFF (tanggal lokal) */
function baseName(b: ChangeBatch): string {
  const d = new Date(b.created_at);
  const code = (b.target_tenant_code ?? "tenant").replace(/[^A-Za-z0-9_-]/g, "_");
  const table = TABLE[b.domain] ?? "config";
  return `${code}_${table}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function saveBlob(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const domainLabel = (d: string) => (d === "semua" ? "Semua" : DOMAIN_LABEL[d as ConfigDomain] ?? d);

/** Angka datar: salin (dibuat, ditimpa, …) atau export (total). `perDomain` (batch dua domain) ditampilkan terpisah. */
function countsText(c: Record<string, unknown> | null | undefined): string {
  const e = Object.entries(c ?? {}).filter((x): x is [string, number] => typeof x[1] === "number");
  return e.length ? e.map(([k, v]) => `${COUNT_LABEL[k] ?? k} ${v}`).join(" · ") : "-";
}

/** Satu baris per domain untuk batch dua domain; kosong bila bukan batch dua domain. */
function perDomainLines(c: ChangeBatch["counts"]): string[] {
  const per = c?.perDomain;
  if (!per || typeof per !== "object") return [];
  return Object.entries(per).map(([d, counts]) => `${domainLabel(d)}: ${countsText(counts)}`);
}

/** config_types per domain; batch "semua" memuat tipe berawalan `domain:` yang ditampilkan tanpa awalan. */
function typeGroups(b: ChangeBatch): Array<{ label: string | null; types: string[] }> {
  if (b.config_types.length === 0) return [];
  if (b.domain !== "semua") return [{ label: null, types: b.config_types }];
  const by = new Map<string, string[]>();
  for (const t of b.config_types) {
    const m = TYPE_PREFIX.exec(t);
    const key = m ? m[1] : "";
    by.set(key, [...(by.get(key) ?? []), m ? m[2] : t]);
  }
  return [...by.entries()].map(([d, types]) => ({ label: d ? domainLabel(d) : "Lainnya", types }));
}

export function ChangeBatchesPanel({ left, right, onClose }: { left: CompareSide; right: CompareSide; onClose(): void }) {
  useDialogEsc(onClose);
  const [scope, setScope] = useState<"pair" | "all">("pair");
  const [rows, setRows] = useState<ChangeBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Daftar tidak memuat before_snapshot; batch yang terbukti kosong ditandai nonaktif setelah dicoba
  const [noOld, setNoOld] = useState<Set<string>>(new Set());
  const pairReady = !!(left.env && left.tenantId && right.env && right.tenantId);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const fetchList = async (qs: URLSearchParams): Promise<ChangeBatch[]> => {
        const res = await api(`/api/compare/batches?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        return json.data ?? [];
      };
      if (scope === "all") {
        setRows(await fetchList(new URLSearchParams({ limit: "100" })));
      } else {
        // Batch yang sumbernya salah satu sisi, ke tujuan apa pun (termasuk export ke Production manual)
        const q = (s: CompareSide) => new URLSearchParams({ sourceEnv: s.env, sourceTenantId: s.tenantId, limit: "100" });
        const [a, b] = await Promise.all([fetchList(q(left)), fetchList(q(right))]);
        const seen = new Set<string>();
        setRows([...a, ...b].filter((r) => !seen.has(r.id) && seen.add(r.id))
          .sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at)));
      }
    } catch (e: any) {
      setError(e?.message || "Gagal memuat riwayat");
    } finally {
      setLoading(false);
    }
  }, [scope, left, right]);

  useEffect(() => { void load(); }, [load]);

  const full = async (id: string): Promise<ChangeBatch | null> => {
    setBusyId(id); setError(null);
    try {
      const res = await api(`/api/compare/batches/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || `HTTP ${res.status}`); return null; }
      return json.data as ChangeBatch;
    } catch (e: any) {
      setError(e?.message || "Gagal memuat batch");
      return null;
    } finally {
      setBusyId(null);
    }
  };
  const downloadSql = async (b: ChangeBatch) => {
    const f = await full(b.id);
    if (!f) return;
    if (!f.sql_text) { setError("SQL batch ini tidak tersedia"); return; }
    saveBlob(f.sql_text, "application/sql", `${baseName(f)}.sql`);
  };
  const downloadOld = async (b: ChangeBatch) => {
    const f = await full(b.id);
    if (!f) return;
    if (f.before_snapshot == null) { setNoOld((p) => new Set(p).add(b.id)); return; }
    saveBlob(JSON.stringify(f.before_snapshot, null, 2), "application/json", `${baseName(f)}_isi-lama.json`);
  };

  return (
    <div className="fixed inset-0 z-[45] flex justify-end bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="w-[420px] max-w-full h-full bg-slate-900 border-l border-slate-800 flex flex-col">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100 flex-1">Riwayat Salin dan Export SQL</span>
          <button onClick={onClose} className="h-7 w-7 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center" title="Tutup (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
            {([["pair", "Pasangan ini"], ["all", "Semua"]] as const).map(([v, label]) => (
              <button
                key={v} type="button" onClick={() => setScope(v)}
                className={`px-2.5 py-1 text-xs transition ${scope === v ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button className={GHOST} onClick={() => void load()} disabled={loading}>{loading ? "Memuat…" : "Muat ulang"}</button>
        </div>
        {error && <div className="mx-3 mt-2 text-xs text-rose-300 bg-rose-500/10 rounded-md px-2 py-1.5">{error}</div>}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {scope === "pair" && !pairReady ? (
            <p className="text-xs text-slate-500">Pilih tenant di kedua sisi, atau lihat "Semua".</p>
          ) : rows.length === 0 && !loading ? (
            <p className="text-xs text-slate-500">Belum ada riwayat.</p>
          ) : rows.map((b) => (
            <div key={b.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-200">{b.kind === "salin" ? "Salin" : "Export SQL"}</span>
                <span className="shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">{domainLabel(b.domain)}</span>
                <span className={`shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] ${STATUS_CLS[b.status] ?? "bg-slate-800 text-slate-300"}`}>{b.status}</span>
                <span className="flex-1" />
                <span className="text-[10px] text-slate-500 tabular-nums">{new Date(b.created_at).toLocaleString()}</span>
              </div>
              {b.note && <div className="text-[11px] text-slate-300 break-words line-clamp-3" title={b.note}>{b.note}</div>}
              <div
                className="text-slate-300 font-mono text-[11px] truncate"
                title={`${b.source_env} · ${b.source_tenant_code ?? b.source_tenant_id} → ${b.target_env} · ${b.target_tenant_code ?? b.target_tenant_id ?? "-"}`}
              >
                {`${b.source_env} · ${b.source_tenant_code ?? b.source_tenant_id} → ${b.target_env} · ${b.target_tenant_code ?? b.target_tenant_id ?? "-"}`}
              </div>
              <div className="text-[11px] text-slate-400 truncate" title={countsText(b.counts)}>{countsText(b.counts)}</div>
              {perDomainLines(b.counts).map((line) => (
                <div key={line} className="text-[11px] text-slate-500 truncate" title={line}>{line}</div>
              ))}
              {b.config_types.length > 0 && (
                <details className="text-[11px] text-slate-400">
                  <summary className="cursor-pointer select-none">{`${b.config_types.length} config`}</summary>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1.5">
                    {typeGroups(b).map((g) => (
                      <div key={g.label ?? ""}>
                        {g.label && <div className="text-[10px] font-semibold text-slate-500">{g.label}</div>}
                        <ul className="space-y-0.5">
                          {g.types.map((t) => <li key={t} className="font-mono text-[11px] text-slate-400 truncate" title={t}>{t}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {b.error && <div className="text-[11px] text-rose-300 truncate" title={b.error}>{b.error}</div>}
              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                <span className="truncate flex-1" title={b.author_name ?? ""}>{b.author_name ?? "-"}</span>
                {b.kind === "export_sql" && (
                  <>
                    <button className={GHOST} disabled={busyId === b.id} onClick={() => void downloadSql(b)}>Unduh SQL lagi</button>
                    <button
                      className={GHOST} disabled={busyId === b.id || noOld.has(b.id)}
                      onClick={() => void downloadOld(b)}
                      title={noOld.has(b.id) ? "Isi lama tidak tersedia" : "Unduh isi lama (.json)"}
                    >
                      Unduh isi lama (.json)
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
