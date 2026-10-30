import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { MANUAL_ENV, type PathStatus } from "../../types";

const DEBOUNCE_MS = 400;

type View =
  | { kind: "memeriksa" }
  | { kind: "tersedia" }
  | { kind: "dipakai"; owner: string }
  | { kind: "kosong" }
  | { kind: "manual" }
  | { kind: "galat"; message: string };

/**
 * Kolom path pengganti satu config. ATS mencari config lewat path tanpa filter tenant, jadi path tujuan harus
 * unik. Setiap ketikan dicek (debounce 400 ms) ke path-check; hasilnya dilaporkan lewat `onStatus`.
 * Cek yang gagal (jaringan / 5xx) dilaporkan sebagai `gagal`: belum terverifikasi, jadi tetap menahan tombol.
 */
export function PathOverrideField({ value, targetEnv, targetTenantId, onChange, onStatus }: {
  value: string;
  targetEnv: string;
  targetTenantId: string;
  onChange(value: string): void;
  onStatus(s: PathStatus): void;
}) {
  const [view, setView] = useState<View>({ kind: "memeriksa" });
  const [attempt, setAttempt] = useState(0);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    const report = (v: View, s: PathStatus) => { setView(v); statusRef.current(s); };
    const path = value.trim();
    // Kosong = tidak ada path pengganti; baris bentrok tetap tertahan (path aslinya yang dipakai tenant lain)
    if (!path) { report({ kind: "kosong" }, "dipakai"); return; }
    // Production isi manual: tujuan tidak bisa dibaca, SQL-nya yang memeriksa sendiri
    if (targetEnv === MANUAL_ENV) { report({ kind: "manual" }, "tersedia"); return; }
    report({ kind: "memeriksa" }, "memeriksa");
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ targetEnv, targetTenantId, path });
        const res = await api(`/api/compare/path-check?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { report({ kind: "galat", message: json.error || `HTTP ${res.status}` }, "gagal"); return; }
        if (json.data?.available) report({ kind: "tersedia" }, "tersedia");
        else report({ kind: "dipakai", owner: json.data?.ownerConfigType ?? "" }, "dipakai");
      } catch (e: any) {
        if (!cancelled) report({ kind: "galat", message: e?.message || "Gagal memeriksa path" }, "gagal");
      }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value, targetEnv, targetTenantId, attempt]);

  const bad = view.kind === "dipakai" || view.kind === "galat" || view.kind === "kosong";
  return (
    <div className="space-y-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label="Path pengganti"
        placeholder="/ats/…"
        className={`w-full bg-slate-950 border rounded-md px-2 py-1 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none ${
          bad ? "border-rose-500/60 focus:border-rose-400" : "border-slate-700 focus:border-indigo-500"}`}
      />
      <div className={`text-[11px] ${view.kind === "tersedia" ? "text-emerald-300" : bad ? "text-rose-300" : "text-slate-400"}`}>
        {view.kind === "memeriksa" && "Memeriksa…"}
        {view.kind === "tersedia" && "Tersedia"}
        {view.kind === "dipakai" && `Sudah dipakai ${view.owner}`.trim()}
        {view.kind === "kosong" && "Path kosong"}
        {view.kind === "manual" && "Tidak dicek, SQL memeriksa sendiri"}
        {view.kind === "galat" && (
          <>
            {`Gagal memeriksa: ${view.message} `}
            <button type="button" className="underline hover:text-rose-200" onClick={() => setAttempt((n) => n + 1)}>Coba lagi</button>
          </>
        )}
      </div>
    </div>
  );
}
