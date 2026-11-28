import { useCallback, useEffect, useState } from "react";
import type { LoginEventRow } from "../../types";

// Daftar riwayat login dengan paginasi "Muat lebih banyak". Dipakai DevicesPanel dan tab admin.

const GHOST = "px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("id-ID");

function kindText(e: LoginEventRow): string {
  switch (e.kind) {
    case "login_berhasil":
      return "Login berhasil";
    case "login_gagal":
      if (e.reason === "tidak_terdaftar") return "Login gagal (email tidak terdaftar)";
      if (e.reason === "nonaktif") return "Login gagal (akun nonaktif)";
      return "Login gagal (password salah)";
    case "login_terkunci":
      return "Login ditolak (terkunci)";
    case "logout":
      return "Logout";
    case "dikeluarkan":
      return `Dikeluarkan oleh ${e.actorName ?? "-"}`;
    default:
      return e.kind;
  }
}

function line(e: LoginEventRow, showEmail: boolean): string {
  const parts = [kindText(e), e.deviceLabel, e.ip ?? "IP tidak diketahui", fmtTime(e.createdAt)];
  if (showEmail) parts.unshift(`${e.email}${e.userRegistered ? "" : " (tidak terdaftar)"}`);
  return parts.join(" · ");
}

export function LoginHistoryList({
  load, showEmail
}: {
  load: (before?: string) => Promise<{ data: LoginEventRow[]; nextBefore: string | null }>;
  showEmail?: boolean;
}) {
  const [events, setEvents] = useState<LoginEventRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await load(before);
      setEvents((prev) => (before ? [...prev, ...res.data] : res.data));
      setNextBefore(res.nextBefore);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  return (
    <div className="space-y-3">
      {error && <p className="text-[11px] text-rose-300 bg-rose-500/10 ring-1 ring-inset ring-rose-500/30 rounded-lg px-3 py-2">{error}</p>}
      <ul className="space-y-1.5 text-[11px] text-slate-300">
        {events.map((e) => <li key={e.id} className="border-b border-slate-800/60 pb-1.5">{line(e, !!showEmail)}</li>)}
        {!loading && events.length === 0 && !error && <li className="py-6 text-center text-slate-500">Belum ada riwayat login.</li>}
      </ul>
      {nextBefore && (
        <button type="button" disabled={loading} onClick={() => void fetchPage(nextBefore)} className={GHOST}>Muat lebih banyak</button>
      )}
      {loading && <p className="text-[11px] text-slate-500">Memuat…</p>}
    </div>
  );
}
