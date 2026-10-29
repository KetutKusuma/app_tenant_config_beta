import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { defineStudioTheme, STUDIO_THEME } from "../../lib/monacoTheme";
import { useStudio } from "../../studio/StudioContext";
import type { CompareSide, ExportSqlResult, Tenant } from "../../types";
import { useDialogEsc } from "./useDialogEsc";

const MANUAL = "__manual__";
const INPUT = "bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500";
const GHOST = "px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition disabled:opacity-40";
const PRIMARY = "px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-40";

function Segment<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
      {options.map((o) => (
        <button
          key={o.v} type="button" disabled={disabled} onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 text-xs transition ${value === o.v ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ExportSqlDialog({ left, right, checkedTypes, tenantsFor, loadTenants, onClose }: {
  left: CompareSide;
  right: CompareSide;
  checkedTypes: string[];
  tenantsFor(env: string): Tenant[];
  loadTenants(env: string): Promise<Tenant[]>;
  onClose(): void;
}) {
  const { targetEnvs, setStatusMessage } = useStudio();
  const [source, setSource] = useState<"kiri" | "kanan">("kiri");
  const [mode, setMode] = useState<"timpa" | "lewati">("timpa");
  const [targetEnv, setTargetEnv] = useState<string>(() => targetEnvs.find((e) => e.name === right.env)?.name ?? targetEnvs[0]?.name ?? MANUAL);
  const [targetTenantId, setTargetTenantId] = useState("");
  const [manualTenant, setManualTenant] = useState("");
  const [manualGroup, setManualGroup] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ tenantId: "", groupId: "", clientName: "", clientCode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportSqlResult | null>(null);

  useDialogEsc(() => { if (!busy) onClose(); });

  const isManual = targetEnv === MANUAL;
  const targetInfo = targetEnvs.find((e) => e.name === targetEnv);
  const srcSide = source === "kiri" ? left : right;
  const srcEnv = targetEnvs.find((e) => e.name === srcSide.env);
  const tenants = isManual ? [] : tenantsFor(targetEnv);

  useEffect(() => {
    if (isManual) return;
    let cancelled = false;
    (async () => {
      const list = await loadTenants(targetEnv);
      if (cancelled) return;
      // Default: tenant kanan bila env sama dengan sisi kanan
      setTargetTenantId((cur) => cur || (targetEnv === right.env && list.some((t) => t.tenantId === right.tenantId) ? right.tenantId : ""));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetEnv]);

  const resetResult = () => { setResult(null); setError(""); };

  const targetOk = isManual ? manualTenant.trim() !== "" : targetTenantId !== "";
  const canBuild = !busy && checkedTypes.length > 0 && targetOk;

  const build = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const target = isManual
        ? { kind: "manual", tenantId: manualTenant.trim(), ...(manualGroup.trim() ? { groupId: manualGroup.trim() } : {}) }
        : { kind: "profile", env: targetEnv, tenantId: targetTenantId };
      const res = await api("/api/compare/export-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEnv: srcSide.env, sourceTenantId: srcSide.tenantId, configTypes: checkedTypes, mode, target })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || `HTTP ${res.status}`); return; }
      setResult(json.data);
    } catch (e: any) {
      setError(e?.message || "Gagal membuat SQL");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.sql], { type: "application/sql" }));
    const a = document.createElement("a");
    a.href = url; a.download = result.fileName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.sql); setStatusMessage("📋 SQL disalin ke clipboard"); setTimeout(() => setStatusMessage(null), 2500); }
    catch { setError("Gagal menyalin ke clipboard"); }
  };

  const addTenant = async () => {
    const id = newForm.tenantId.trim();
    if (tenantsFor(targetEnv).some((t) => t.tenantId === id)) {
      setError(`Tenant ini sudah terdaftar di ${targetInfo?.label ?? targetEnv}; pilih dari daftar.`);
      return;
    }
    setBusy(true); setError("");
    try {
      const res = await api("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Target-Env": targetEnv },
        body: JSON.stringify({
          tenantId: newForm.tenantId.trim(), groupId: newForm.groupId.trim(),
          clientName: newForm.clientName.trim(), clientCode: newForm.clientCode.trim(), tags: [], notes: ""
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) { setError(json.message || json.error || `HTTP ${res.status}`); return; }
      await loadTenants(targetEnv);
      setTargetTenantId(newForm.tenantId.trim());
      setShowNew(false);
      setNewForm({ tenantId: "", groupId: "", clientName: "", clientCode: "" });
      resetResult();
    } catch (e: any) {
      setError(e?.message || "Gagal menambah tenant");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{`Export SQL (${checkedTypes.length} config)`}</h3>
          <p className="mt-1 text-[11px] text-slate-400">SQL aman dijalankan ulang: tidak membuat baris ganda.</p>
        </div>

        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 items-center text-xs text-slate-400">
          <span>Sumber</span>
          <div className="flex items-center gap-2 min-w-0">
            <Segment value={source} onChange={(v) => { setSource(v); resetResult(); }} disabled={busy}
              options={[{ v: "kiri", label: "Kiri" }, { v: "kanan", label: "Kanan" }]} />
            <span className="truncate text-slate-500" title={`${srcEnv?.label ?? srcSide.env} · ${tenantsFor(srcSide.env).find((t) => t.tenantId === srcSide.tenantId)?.name ?? srcSide.tenantId}`}>
              {`${srcEnv?.label ?? srcSide.env} · ${tenantsFor(srcSide.env).find((t) => t.tenantId === srcSide.tenantId)?.name ?? srcSide.tenantId}`}
            </span>
          </div>

          <span>Env tujuan</span>
          <select className={`${INPUT} max-w-xs`} value={targetEnv} disabled={busy}
            onChange={(e) => { setTargetEnv(e.target.value); setTargetTenantId(""); setShowNew(false); resetResult(); }}>
            {targetEnvs.map((e) => <option key={e.name} value={e.name}>{e.label}</option>)}
            <option value={MANUAL}>Production (isi manual)</option>
          </select>

          <span>Tenant tujuan</span>
          {isManual ? (
            <div className="flex gap-2 min-w-0">
              <input className={`${INPUT} flex-1 min-w-0 font-mono`} placeholder="tenant_id (UUID atau GLOBAL_DEFAULT)" value={manualTenant} disabled={busy}
                onChange={(e) => { setManualTenant(e.target.value); resetResult(); }} />
              <input className={`${INPUT} flex-1 min-w-0 font-mono`} placeholder="group_id (kosong = sama dengan tenant_id)" value={manualGroup} disabled={busy}
                onChange={(e) => { setManualGroup(e.target.value); resetResult(); }} />
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <select className={`${INPUT} max-w-xs truncate`} value={targetTenantId} disabled={busy}
                onChange={(e) => { setTargetTenantId(e.target.value); resetResult(); }}>
                <option value="">Pilih tenant…</option>
                {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name} ({t.code})</option>)}
              </select>
              <button type="button" className={`${GHOST} truncate`} disabled={busy} onClick={() => setShowNew((v) => !v)}
                title={`Tambah tenant baru di ${targetInfo?.label ?? targetEnv}`}>
                {`+ Tambah tenant baru di ${targetInfo?.label ?? targetEnv}`}
              </button>
            </div>
          )}

          {!isManual && showNew && (
            <>
              <span />
              <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-800 p-2">
                <input className={`${INPUT} font-mono`} placeholder="tenant_id" value={newForm.tenantId} onChange={(e) => setNewForm({ ...newForm, tenantId: e.target.value })} />
                <input className={`${INPUT} font-mono`} placeholder="group_id" value={newForm.groupId} onChange={(e) => setNewForm({ ...newForm, groupId: e.target.value })} />
                <input className={INPUT} placeholder="Nama klien" value={newForm.clientName} onChange={(e) => setNewForm({ ...newForm, clientName: e.target.value })} />
                <input className={`${INPUT} font-mono`} placeholder="Kode klien" value={newForm.clientCode} onChange={(e) => setNewForm({ ...newForm, clientCode: e.target.value })} />
                <div className="col-span-2 flex justify-end gap-2">
                  <button type="button" className={GHOST} disabled={busy} onClick={() => setShowNew(false)}>Batal</button>
                  <button type="button" className={GHOST} onClick={addTenant}
                    disabled={busy || !newForm.tenantId.trim() || !newForm.groupId.trim() || !newForm.clientName.trim() || !newForm.clientCode.trim()}>
                    {busy ? "Menyimpan…" : "Tambah tenant"}
                  </button>
                </div>
              </div>
            </>
          )}

          <span>Jika sudah ada</span>
          <Segment value={mode} onChange={(v) => { setMode(v); resetResult(); }} disabled={busy}
            options={[{ v: "timpa", label: "Timpa" }, { v: "lewati", label: "Lewati" }]} />
        </div>

        {error && <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-md px-3 py-2">{error}</div>}

        {result && (
          <div className="space-y-2">
            {result.warning && (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">{result.warning}</div>
            )}
            {result.beforeSnapshot === "tersimpan" && (
              <div className="text-[11px] text-slate-400">Isi tujuan saat ini sudah dicatat di Riwayat (kondisi saat export, bukan saat SQL dijalankan).</div>
            )}
            <div className="text-xs font-mono text-slate-300 truncate" title={result.fileName}>{result.fileName}</div>
            <div className="h-72 rounded-md overflow-hidden border border-slate-800">
              <Editor
                height="100%" language="sql" theme={STUDIO_THEME} beforeMount={defineStudioTheme} value={result.sql}
                options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, wordWrap: "off" }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Tutup</button>
          {result && <button type="button" className={GHOST} onClick={copy}>Salin</button>}
          {result ? (
            <button type="button" className={PRIMARY} onClick={download}>Unduh .sql</button>
          ) : (
            <button type="button" className={GHOST} onClick={build} disabled={!canBuild}>{busy ? "Membuat…" : "Buat SQL"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
