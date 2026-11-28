import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, Copy, KeyRound, MonitorSmartphone, Pencil, Power, UserPlus, X } from "lucide-react";
import { createUser, listLoginHistory, listUserEvents, listUsers, resetUserPassword, updateUser } from "../../lib/api";
import { DevicesPanel } from "./DevicesPanel";
import { LoginHistoryList } from "./LoginHistoryList";
import type { AdminUserRow, UserEventRow } from "../../types";

// Layar "Kelola Akun" (khusus admin): daftar akun, aksi per akun, dan log aktivitas.

const fieldCls = "mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500";
const ICON_BTN = "p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition";
const GHOST = "px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition";
const PRIMARY = "px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-40";

const ACTION_VERB: Record<UserEventRow["action"], string> = {
  create: "membuat akun",
  update: "mengubah",
  deactivate: "menonaktifkan",
  activate: "mengaktifkan kembali",
  reset_password: "mereset password",
  revoke_session: "mengeluarkan perangkat"
};

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("id-ID") : "-");

function eventLine(e: UserEventRow): string {
  let s = `${e.actorName} ${ACTION_VERB[e.action] ?? e.action} ${e.targetEmail}`;
  const d = e.details ?? {};
  // update: diff {from,to}; create: nilai polos
  if (d.role !== undefined) {
    s += typeof d.role === "object" && d.role !== null ? ` (peran ${d.role.from} → ${d.role.to})` : ` (peran ${d.role})`;
  }
  if (e.action === "revoke_session" && d.device) s += ` (${d.device})`;
  return `${s} · ${fmtTime(e.createdAt)}`;
}

function Overlay({ children, onClose, z = "z-[60]" }: { children: ReactNode; onClose?: () => void; z?: string }) {
  return (
    <div
      className={`fixed inset-0 ${z} bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      onKeyDown={(e) => e.key === "Escape" && onClose?.()}
    >
      {children}
    </div>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-[11px] text-rose-300 bg-rose-500/10 ring-1 ring-inset ring-rose-500/30 rounded-lg px-3 py-2">{error}</p> : null;
}

/** Panel sekali-lihat: password sementara + tombol salin */
function SecretDialog({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      /* clipboard tidak tersedia: user bisa menyalin manual */
    }
  };
  return (
    <Overlay z="z-[70]">
      <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Password sementara</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">{email}</p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-emerald-300 font-mono break-all">{password}</code>
          <button type="button" onClick={copy} className={ICON_BTN} title="Salin">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[11px] text-amber-200 bg-amber-500/10 ring-1 ring-inset ring-amber-500/30 rounded-lg px-3 py-2">
          Berikan ke pemilik akun; wajib diganti saat login pertama. Password ini hanya ditampilkan sekali.
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={PRIMARY}>Selesai</button>
        </div>
      </div>
    </Overlay>
  );
}

function ConfirmDialog({
  title, description, confirmLabel, danger, onConfirm, onCancel
}: {
  title: string; description: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => Promise<void>; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Overlay onClose={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <p className="text-[11px] text-slate-400 mt-1">{description}</p>
        </div>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={GHOST}>Batal</button>
          <button
            type="button" disabled={busy} onClick={run}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold text-white transition disabled:opacity-40 ${danger ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-600 hover:bg-indigo-500"}`}
          >
            {busy ? "Memproses…" : confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Dialog tambah (user = null) atau ubah akun */
function UserFormDialog({
  user, isSelf, onClose, onSaved, onCreated
}: {
  user: AdminUserRow | null; isSelf: boolean; onClose: () => void;
  onSaved: () => void; onCreated: (u: AdminUserRow, tempPassword: string) => void;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState<"admin" | "user">(user?.role ?? "user");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = () => {
    // 16 karakter, rejection sampling (tanpa bias), alfabet sama dengan server (tanpa 0 O I l 1)
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const limit = 256 - (256 % alphabet.length);
    let out = "";
    while (out.length < 16) {
      for (const b of crypto.getRandomValues(new Uint8Array(32))) {
        if (b < limit && out.length < 16) out += alphabet[b % alphabet.length];
      }
    }
    setPassword(out);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await updateUser(user.id, { displayName: displayName.trim(), ...(isSelf ? {} : { role }) });
        onSaved();
      } else {
        const res = await createUser({
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          role,
          password: password || undefined
        });
        onCreated(res.user, res.tempPassword);
      }
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-3">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-semibold text-slate-100">{user ? "Ubah akun" : "Tambah akun"}</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200" title="Tutup"><X className="w-4 h-4" /></button>
        </div>
        <label className="block text-[11px] text-slate-400">
          Email
          <input type="email" required autoFocus={!user} disabled={!!user} value={email} onChange={(e) => setEmail(e.target.value)} className={`${fieldCls} disabled:opacity-60`} />
        </label>
        <label className="block text-[11px] text-slate-400">
          Nama tampilan
          <input required={!!user} autoFocus={!!user} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={fieldCls} />
        </label>
        {!isSelf && (
          <label className="block text-[11px] text-slate-400">
            Peran
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")} className={fieldCls}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
        )}
        {!user && (
          <label className="block text-[11px] text-slate-400">
            Password (opsional)
            <div className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} placeholder="Kosongkan untuk dibuatkan otomatis" className={`${fieldCls} font-mono`} />
              <button type="button" onClick={generate} className={`mt-1 shrink-0 ${GHOST}`}>Buatkan otomatis</button>
            </div>
          </label>
        )}
        <ErrorText error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={GHOST}>Batal</button>
          <button type="submit" disabled={busy} className={PRIMARY}>{busy ? "Menyimpan…" : user ? "Simpan" : "Buat akun"}</button>
        </div>
      </form>
    </Overlay>
  );
}

type Dialog =
  | { kind: "form"; user: AdminUserRow | null }
  | { kind: "reset" | "toggle"; user: AdminUserRow }
  | { kind: "devices"; user: AdminUserRow }
  | { kind: "secret"; email: string; password: string };

export function ManageAccountsModal({ currentUserId, onClose }: { currentUserId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"akun" | "log" | "riwayat">("akun");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [events, setEvents] = useState<UserEventRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listUserEvents(before);
      setEvents((prev) => (before ? [...prev, ...res.data] : res.data));
      setNextBefore(res.nextBefore);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "akun") void loadUsers();
    else if (tab === "log") void loadEvents();
  }, [tab, loadUsers, loadEvents]);

  const loadAllHistory = useCallback((before?: string) => listLoginHistory({ before }), []);

  const afterChange = () => {
    setDialog(null);
    void loadUsers();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !dialog && onClose()}
    >
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl bg-slate-900 border border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-slate-100 mr-3">Kelola Akun</h3>
            {(["akun", "log", "riwayat"] as const).map((t) => (
              <button
                key={t} type="button" onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded-md text-xs transition ${tab === t ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
              >
                {t === "akun" ? "Akun" : t === "log" ? "Log Aktivitas" : "Riwayat Login"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {tab === "akun" && (
              <button type="button" onClick={() => setDialog({ kind: "form", user: null })} className={`${PRIMARY} flex items-center gap-1.5`}>
                <UserPlus className="w-3.5 h-3.5" /> Tambah Akun
              </button>
            )}
            <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200" title="Tutup"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-3">
          <ErrorText error={error} />
          {tab === "akun" ? (
            <table className="w-full text-[11px] text-left">
              <thead className="text-slate-500">
                <tr>
                  {["Nama", "Email", "Peran", "Status", "Login terakhir", "Dibuat oleh", ""].map((h) => (
                    <th key={h} className="font-medium pb-2 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {users.map((u) => {
                  const self = u.id === currentUserId;
                  return (
                    <tr key={u.id} className={`border-t border-slate-800 ${u.isActive ? "" : "opacity-60"}`}>
                      <td className="py-2 pr-3">{u.displayName}</td>
                      <td className="py-2 pr-3 font-mono">{u.email}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${u.role === "admin" ? "bg-indigo-500/15 text-indigo-300" : "bg-slate-800 text-slate-300"}`}>{u.role}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {u.isActive ? "Aktif" : "Nonaktif"}
                        {u.mustChangePassword && <span className="ml-1.5 text-amber-300">· wajib ganti password</span>}
                      </td>
                      <td className="py-2 pr-3">{fmtTime(u.lastLoginAt)}</td>
                      <td className="py-2 pr-3">{u.createdByName ?? "-"}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button type="button" className={ICON_BTN} title="Ubah" onClick={() => setDialog({ kind: "form", user: u })}><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" className={ICON_BTN} title="Perangkat" onClick={() => setDialog({ kind: "devices", user: u })}><MonitorSmartphone className="w-3.5 h-3.5" /></button>
                        {!self && (
                          <>
                            <button type="button" className={ICON_BTN} title="Reset password" onClick={() => setDialog({ kind: "reset", user: u })}><KeyRound className="w-3.5 h-3.5" /></button>
                            <button type="button" className={ICON_BTN} title={u.isActive ? "Nonaktifkan" : "Aktifkan"} onClick={() => setDialog({ kind: "toggle", user: u })}><Power className="w-3.5 h-3.5" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && users.length === 0 && !error && (
                  <tr><td colSpan={7} className="py-6 text-center text-slate-500">Belum ada akun.</td></tr>
                )}
              </tbody>
            </table>
          ) : tab === "riwayat" ? (
            <LoginHistoryList load={loadAllHistory} showEmail />
          ) : (
            <>
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                {events.map((e) => <li key={e.id} className="border-b border-slate-800/60 pb-1.5">{eventLine(e)}</li>)}
                {!loading && events.length === 0 && !error && <li className="py-6 text-center text-slate-500">Belum ada aktivitas.</li>}
              </ul>
              {nextBefore && (
                <button type="button" disabled={loading} onClick={() => void loadEvents(nextBefore)} className={GHOST}>Muat lebih banyak</button>
              )}
            </>
          )}
          {loading && <p className="text-[11px] text-slate-500">Memuat…</p>}
        </div>
      </div>

      {dialog?.kind === "form" && (
        <UserFormDialog
          user={dialog.user}
          isSelf={dialog.user?.id === currentUserId}
          onClose={() => setDialog(null)}
          onSaved={afterChange}
          onCreated={(u, pw) => {
            setDialog({ kind: "secret", email: u.email, password: pw });
            void loadUsers();
          }}
        />
      )}
      {dialog?.kind === "reset" && (
        <ConfirmDialog
          title="Reset password"
          description={`Password ${dialog.user.email} akan diganti dengan password sementara baru. Akun wajib menggantinya saat login berikutnya.`}
          confirmLabel="Reset password"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const res = await resetUserPassword(dialog.user.id);
            setDialog({ kind: "secret", email: dialog.user.email, password: res.tempPassword });
            void loadUsers();
          }}
        />
      )}
      {dialog?.kind === "toggle" && (
        <ConfirmDialog
          title={dialog.user.isActive ? "Nonaktifkan akun" : "Aktifkan akun"}
          description={dialog.user.isActive ? `Nonaktifkan ${dialog.user.email}? Sesi akun ini akan langsung berakhir.` : `Aktifkan kembali ${dialog.user.email}?`}
          confirmLabel={dialog.user.isActive ? "Nonaktifkan" : "Aktifkan"}
          danger={dialog.user.isActive}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            await updateUser(dialog.user.id, { isActive: !dialog.user.isActive });
            afterChange();
          }}
        />
      )}
      {dialog?.kind === "devices" && (
        <DevicesPanel mode={{ kind: "admin", userId: dialog.user.id, email: dialog.user.email }} onClose={() => setDialog(null)} z="z-[70]" />
      )}
      {dialog?.kind === "secret" && <SecretDialog email={dialog.email} password={dialog.password} onClose={() => setDialog(null)} />}
    </div>
  );
}
