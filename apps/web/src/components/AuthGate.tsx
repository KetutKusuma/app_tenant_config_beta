import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Layers, Lock, LogIn, KeyRound } from "lucide-react";

// Gerbang login Tenant Studio: cek sesi (/api/auth/me), tampilkan form login atau
// form ganti password wajib, lalu render aplikasi dengan user yang sedang login.

export interface StudioUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
  preferences: {
    presetDirTenant: string | null;
    presetDirWorkflow: string | null;
    lastDomain: string | null;
    lastTenantId: string | null;
    lastTargetEnv: string | null;
  };
}

/** Event global yang dipicu wrapper api() saat BFF membalas 401 */
export const UNAUTHORIZED_EVENT = "studio:unauthorized";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 ring-1 ring-inset ring-indigo-500/30">
            <Layers className="w-4 h-4" />
          </div>
          <span className="font-semibold text-slate-200 tracking-wide">Tenant Studio</span>
          <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-300 font-mono ring-1 ring-inset ring-amber-500/30">DEV</span>
        </div>
        <div className="rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5">
          <div>
            <h1 className="text-sm font-semibold text-slate-100">{title}</h1>
            <p className="text-[11px] text-slate-400 mt-1">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500";

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-[11px] text-rose-300 bg-rose-500/10 ring-1 ring-inset ring-rose-500/30 rounded-lg px-3 py-2">{error}</p> : null;
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (u: StudioUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Login gagal");
      onLoggedIn(json.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Masuk" subtitle="Gunakan akun Studio Anda. Preferensi (folder preset, dll.) tersimpan per user.">
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-[11px] text-slate-400">
          Email
          <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </label>
        <label className="block text-[11px] text-slate-400">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </label>
        <ErrorText error={error} />
        <button
          type="submit"
          disabled={busy}
          className="w-full h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition disabled:opacity-50"
        >
          <LogIn className="w-3.5 h-3.5" /> {busy ? "Memproses…" : "Masuk"}
        </button>
      </form>
    </Shell>
  );
}

/** Form ganti password; dipakai di layar wajib (login pertama) maupun dari menu user */
export function ChangePasswordForm({
  forced,
  onDone,
  onCancel
}: {
  forced: boolean;
  onDone: (u: StudioUser) => void;
  onCancel?: () => void;
}) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError("Konfirmasi password tidak sama.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengganti password");
      onDone(json.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {forced && (
        <p className="text-[11px] text-amber-200 bg-amber-500/10 ring-1 ring-inset ring-amber-500/30 rounded-lg px-3 py-2 flex gap-2">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-px" /> Ini login pertama dengan password default. Ganti password untuk melanjutkan.
        </p>
      )}
      <label className="block text-[11px] text-slate-400">
        Password saat ini
        <input type="password" autoComplete="current-password" required autoFocus value={currentPassword} onChange={(e) => setCurrent(e.target.value)} className={inputCls} />
      </label>
      <label className="block text-[11px] text-slate-400">
        Password baru (min. 8 karakter)
        <input type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} className={inputCls} />
      </label>
      <label className="block text-[11px] text-slate-400">
        Ulangi password baru
        <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
      </label>
      <ErrorText error={error} />
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 h-9 rounded-lg text-xs text-slate-300 hover:bg-slate-800 transition">
            Batal
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex-1 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition disabled:opacity-50"
        >
          <KeyRound className="w-3.5 h-3.5" /> {busy ? "Menyimpan…" : "Simpan password"}
        </button>
      </div>
    </form>
  );
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
}

export function AuthGate({
  children
}: {
  children: (props: { user: StudioUser; setUser: (u: StudioUser) => void; onLogout: () => void }) => ReactNode;
}) {
  const [user, setUser] = useState<StudioUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (res) => (res.ok ? (await res.json()).user : null))
      .catch(() => null)
      .then((u) => {
        setUser(u);
        setChecking(false);
      });
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const onLogout = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  if (checking) {
    return <div className="min-h-screen w-screen bg-slate-950 flex items-center justify-center text-xs text-slate-500">Memeriksa sesi…</div>;
  }
  if (!user) return <LoginForm onLoggedIn={setUser} />;
  if (user.mustChangePassword) {
    return (
      <Shell title="Ganti password" subtitle={user.email}>
        <ChangePasswordForm forced onDone={setUser} />
        <button onClick={onLogout} className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition">
          Keluar
        </button>
      </Shell>
    );
  }
  // key = user.id: App di-mount ulang bersih saat ganti user
  return <div key={user.id} className="contents">{children({ user, setUser, onLogout })}</div>;
}
