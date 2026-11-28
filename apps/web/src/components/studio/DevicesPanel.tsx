import { useCallback, useEffect, useState } from "react";
import { LogOut, X } from "lucide-react";
import { listLoginHistory, listMyLoginHistory, listMySessions, listUserSessions, revokeMySession, revokeUserSession } from "../../lib/api";
import type { SessionRow } from "../../types";
import { LoginHistoryList } from "./LoginHistoryList";

// Perangkat aktif + riwayat login. Mode "self": akun sendiri; mode "admin": akun lain (Kelola Akun).

export type DevicesMode = { kind: "self" } | { kind: "admin"; userId: string; email: string };

const ICON_BTN = "p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition";
const fmtTime = (iso: string) => new Date(iso).toLocaleString("id-ID");

export function DevicesPanel({ mode, onClose, z = "z-[60]" }: { mode: DevicesMode; onClose: () => void; z?: string }) {
  const [tab, setTab] = useState<"perangkat" | "riwayat">("perangkat");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const userId = mode.kind === "admin" ? mode.userId : undefined;

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(userId ? await listUserSessions(userId) : await listMySessions());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (tab === "perangkat") void loadSessions();
  }, [tab, loadSessions]);

  const loadHistory = useCallback(
    (before?: string) => (userId ? listLoginHistory({ userId, before }) : listMyLoginHistory(before)),
    [userId]
  );

  const revoke = async (s: SessionRow) => {
    if (!window.confirm(`Keluarkan perangkat ${s.deviceLabel}? Perangkat itu harus login ulang.`)) return;
    setError(null);
    try {
      if (userId) await revokeUserSession(userId, s.id);
      else await revokeMySession(s.id);
      await loadSessions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div
      className={`fixed inset-0 ${z} bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-slate-900 border border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-slate-100 mr-3">
              Perangkat & Riwayat Login{mode.kind === "admin" && <span className="ml-2 font-normal text-slate-400">{mode.email}</span>}
            </h3>
            {(["perangkat", "riwayat"] as const).map((t) => (
              <button
                key={t} type="button" onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded-md text-xs transition ${tab === t ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
              >
                {t === "perangkat" ? "Perangkat Aktif" : "Riwayat Login"}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200" title="Tutup"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-3">
          {tab === "perangkat" ? (
            <>
              {error && <p className="text-[11px] text-rose-300 bg-rose-500/10 ring-1 ring-inset ring-rose-500/30 rounded-lg px-3 py-2">{error}</p>}
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 border-b border-slate-800/60 pb-1.5">
                    <span>
                      {s.deviceLabel} · {s.ip ?? "IP tidak diketahui"} · Login {fmtTime(s.createdAt)} · Terakhir aktif {fmtTime(s.lastSeenAt)}
                      {s.current && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/15 text-indigo-300">Perangkat ini</span>}
                    </span>
                    {!s.current && (
                      <button type="button" className={ICON_BTN} title="Keluarkan" onClick={() => void revoke(s)}><LogOut className="w-3.5 h-3.5" /></button>
                    )}
                  </li>
                ))}
                {!loading && sessions.length === 0 && !error && <li className="py-6 text-center text-slate-500">Tidak ada perangkat aktif.</li>}
              </ul>
              {loading && <p className="text-[11px] text-slate-500">Memuat…</p>}
            </>
          ) : (
            <LoginHistoryList load={loadHistory} />
          )}
        </div>
      </div>
    </div>
  );
}
