import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useStudio } from "../../studio/StudioContext";
import type { CompareEntry, CompareSide, Tenant } from "../../types";
import { TypeToConfirmDialog } from "../ui";
import { useDialogEsc } from "./useDialogEsc";

const GHOST = "px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition disabled:opacity-40";
const PRIMARY = "px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-40";

function Group({ label, hint, names }: { label: string; hint: string; names: string[] }) {
  return (
    <details className="rounded-md border border-slate-800 px-3 py-2 text-xs">
      <summary className="cursor-pointer flex items-baseline gap-2 select-none">
        <span className="text-lg font-semibold text-slate-100 tabular-nums">{names.length}</span>
        <span className="text-slate-300">{label}</span>
        <span className="text-[10px] text-slate-500 truncate">{hint}</span>
      </summary>
      {names.length > 0 && (
        <ul className="mt-2 max-h-32 overflow-y-auto space-y-0.5">
          {names.map((n) => <li key={n} className="font-mono text-[11px] text-slate-400 truncate" title={n}>{n}</li>)}
        </ul>
      )}
    </details>
  );
}

export function CopyConfigsDialog({ left, right, leftTenant, rightTenant, entries, onClose, onDone }: {
  left: CompareSide;
  right: CompareSide;
  leftTenant?: Tenant;
  rightTenant?: Tenant;
  entries: CompareEntry[];
  onClose(): void;
  onDone(): void;
}) {
  const { targetEnvs, setStatusMessage } = useStudio();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState<string[] | null>(null);
  const [uncertain, setUncertain] = useState(false);

  const leftEnv = targetEnvs.find((e) => e.name === left.env);
  const rightEnv = targetEnvs.find((e) => e.name === right.env);
  const leftLabel = leftEnv?.label ?? left.env;
  const rightLabel = rightEnv?.label ?? right.env;
  const readonly = Boolean(rightEnv?.readonly);

  const tenantLabel = (side: CompareSide, t?: Tenant) => (t ? `${t.name} (${t.code})` : side.tenantId);
  const rightTenantCode = rightTenant?.code ?? "";
  const [doneWarn, setDoneWarn] = useState(false);

  const plan = useMemo(() => {
    const p = { create: [] as string[], overwrite: [] as string[], same: [] as string[], targetOnly: [] as string[], duplicates: [] as string[] };
    for (const e of entries) {
      if (e.status === "hanya_kiri" && e.left) p.create.push(e.configType);
      else if (e.status === "beda" && e.left && e.right) p.overwrite.push(e.configType);
      else if (e.status === "sama") p.same.push(e.configType);
      else if (e.status === "hanya_kanan") p.targetOnly.push(e.configType);
      else if (e.status === "ganda") p.duplicates.push(e.configType);
    }
    return p;
  }, [entries]);
  const n = plan.create.length + plan.overwrite.length;
  const done = stale !== null || uncertain;

  const closeDialog = () => { if (done || doneWarn) onDone(); else onClose(); };
  useDialogEsc(() => {
    if (busy) return;
    if (confirming) setConfirming(false);
    else closeDialog();
  });

  const run = async () => {
    setConfirming(false);
    setBusy(true); setError(""); setStale(null); setUncertain(false);
    try {
      const expectedTargetVersions: Record<string, string | null> = {};
      for (const e of entries) expectedTargetVersions[e.configType] = e.right?.version_token ?? null;
      const res = await api("/api/compare/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Target-Env": right.env },
        body: JSON.stringify({ sourceEnv: left.env, sourceTenantId: left.tenantId, targetTenantId: right.tenantId, expectedTargetVersions })
      }, rightEnv?.protected ? right.env : undefined);
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const d = json.data;
        setStatusMessage(`✅ Salin selesai: ${d.created.length} dibuat, ${d.overwritten.length} ditimpa`);
        setTimeout(() => setStatusMessage(null), 3500);
        if (d.warnings?.length) {
          setError(d.warnings.join("\n"));
          setUncertain(false);
          setStale(null);
          setDoneWarn(true);
          return;
        }
        onDone();
        return;
      }
      if (json.code === "TARGET_CHANGED") {
        setError(json.error || "Isi tujuan berubah sejak perbandingan dimuat.");
        setStale(json.configTypes ?? []);
      } else if (json.commitUncertain || (res.status >= 500 && !json.error)) {
        setError(json.error || "Hasil tidak pasti — periksa tujuan lalu muat ulang perbandingan.");
        setUncertain(true);
      } else {
        setError(json.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      setError("Hasil tidak pasti — periksa tujuan lalu muat ulang perbandingan.");
      setUncertain(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && !confirming && closeDialog()}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Salin ke Kanan</h3>
          <p className="mt-1 text-xs text-slate-400 truncate" title={`${leftLabel} · ${tenantLabel(left, leftTenant)} → ${rightLabel} · ${tenantLabel(right, rightTenant)}`}>
            {`${leftLabel} · ${tenantLabel(left, leftTenant)} → ${rightLabel} · ${tenantLabel(right, rightTenant)}`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Group label="dibuat baru" hint="hanya di kiri" names={plan.create} />
          <Group label="ditimpa" hint="beda isi" names={plan.overwrite} />
          <Group label="sama · dilewati" hint="" names={plan.same} />
          <Group label={`hanya di ${rightLabel} · dibiarkan`} hint="" names={plan.targetOnly} />
        </div>
        {plan.duplicates.length > 0 && (
          <div className="text-xs text-rose-300">{`${plan.duplicates.length} config ganda dilewati: ${plan.duplicates.join(", ")}`}</div>
        )}
        <p className="text-[11px] text-slate-400">
          {`Isi lama setiap config yang ditimpa disimpan ke History ${rightLabel} sebelum ditulis. Config yang hanya ada di ${rightLabel} tidak dihapus.`}
        </p>
        {readonly && <p className="text-xs text-amber-200">{`${rightLabel} hanya bisa diubah lewat Export SQL.`}</p>}

        {error && (
          <div className={`text-xs whitespace-pre-line rounded-md px-3 py-2 border ${
            doneWarn ? "text-amber-200 bg-amber-500/10 border-amber-500/30" : "text-rose-300 bg-rose-950/40 border-rose-900/50"}`}>
            {uncertain && <div className="font-semibold mb-1">Hasil tidak pasti. Periksa isi tujuan; isi lama sudah disimpan di History.</div>}
            {error}
            {stale && stale.length > 0 && <div className="mt-1 font-mono text-[11px] break-words">{stale.join(", ")}</div>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {done || doneWarn ? (
            <button type="button" className={GHOST} onClick={onDone}>Muat ulang perbandingan</button>
          ) : (
            <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Batal</button>
          )}
          {!readonly && !done && !doneWarn && (
            <button type="button" className={PRIMARY} disabled={busy || n === 0 || !rightTenantCode} onClick={() => setConfirming(true)}>
              {busy ? "Menyalin…" : `Salin ${n} config`}
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <TypeToConfirmDialog
          title={`Tulis ${n} config ke ${rightLabel} · ${tenantLabel(right, rightTenant)}`}
          description={`${plan.overwrite.length} config yang sudah ada akan ditimpa. Isi lamanya dicadangkan ke History lebih dulu.`}
          expected={rightTenantCode}
          confirmLabel="Salin sekarang"
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
