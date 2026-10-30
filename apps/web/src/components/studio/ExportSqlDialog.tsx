import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { defineStudioTheme, STUDIO_THEME } from "../../lib/monacoTheme";
import { useStudio } from "../../studio/StudioContext";
import { duplicatePathList, isPathOk, markDuplicatePaths, mergeOverrides, overrideToSend, pendingPathReason, showPathField, UUID_RE } from "../../studio/pathRules";
import { MAX_REASON } from "../../studio/useCopyDialog";
import { MANUAL_ENV, type CompareSide, type CopyPreview, type ExportSqlResult, type PathStatus, type PreviewItem, type Tenant } from "../../types";
import { PathOverrideField } from "./PathOverrideField";
import { useDialogEsc } from "./useDialogEsc";

const INPUT = "bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50";
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

/** Satu config tenant_config yang tercentang beserta keadaan path-nya (path sumber atau penggantinya). */
interface PathRow {
  configType: string;
  item: PreviewItem;
  /** path akhir (override menang) */
  path: string | null;
  /** path pengganti sudah beres: tersedia, atau tidak diganti dan tidak bentrok */
  pathOk: boolean;
  /** path akhirnya sama dengan config lain yang tercentang */
  dup: boolean;
  showField: boolean;
}

export function ExportSqlDialog({ left, right, checkedTypes, tenantsFor, loadTenants, onClose }: {
  left: CompareSide;
  right: CompareSide;
  checkedTypes: string[];
  tenantsFor(env: string): Tenant[];
  loadTenants(env: string): Promise<Tenant[]>;
  onClose(): void;
}) {
  const { targetEnvs, setStatusMessage, configDomain } = useStudio();
  const [source, setSource] = useState<"kiri" | "kanan">("kiri");
  const [mode, setMode] = useState<"timpa" | "lewati">("timpa");
  const [targetEnv, setTargetEnv] = useState<string>(() => targetEnvs.find((e) => e.name === right.env)?.name ?? targetEnvs[0]?.name ?? MANUAL_ENV);
  const [targetTenantId, setTargetTenantId] = useState("");
  const [manualTenant, setManualTenant] = useState("");
  const [manualGroup, setManualGroup] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ tenantId: "", groupId: "", clientName: "", clientCode: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportSqlResult | null>(null);
  const [reason, setReason] = useState("");
  // Path tenant_config: pratinjau salin (path akhir + bentrok), path pengganti per config_type, dan hasil cek path-nya
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [overrideStatus, setOverrideStatus] = useState<Record<string, PathStatus>>({});
  const reqId = useRef(0);
  // Muat ulang setelah 409 PATH_CONFLICT: path yang baru ketahuan dipakai tenant lain (null = muat ulang biasa)
  const takenRef = useRef<string[] | null>(null);

  useDialogEsc(() => { if (!busy) onClose(); });

  const isManual = targetEnv === MANUAL_ENV;
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

  // Sumber Kiri → tujuan default Kanan, sumber Kanan → tujuan default Kiri
  const pickSource = (v: "kiri" | "kanan") => {
    setSource(v);
    const dest = v === "kiri" ? right : left;
    const env = targetEnvs.find((e) => e.name === dest.env)?.name;
    if (env) { setTargetEnv(env); setTargetTenantId(dest.tenantId); setShowNew(false); }
    resetResult();
  };

  const resetResult = () => { setResult(null); setError(""); };

  const effTenantId = isManual ? manualTenant.trim() : targetTenantId;
  // Server menerima tujuan manual hanya berupa UUID atau GLOBAL_DEFAULT
  const manualTenantOk = effTenantId === "GLOBAL_DEFAULT" || UUID_RE.test(effTenantId);
  const targetOk = isManual ? manualTenantOk : targetTenantId !== "";
  const sameAsSource = !isManual && targetTenantId !== "" && targetEnv === srcSide.env && targetTenantId === srcSide.tenantId;

  // Hanya tenant_config yang punya path. Tujuan GLOBAL_DEFAULT (tenant_id NULL) tidak punya tenant lain yang bisa bentrok.
  const wantsPreview = configDomain === "tenant_config" && targetOk && !sameAsSource && effTenantId !== "GLOBAL_DEFAULT";

  useEffect(() => {
    const id = ++reqId.current;
    const takenPaths = takenRef.current;
    takenRef.current = null;
    setOverrideStatus({});
    setPreview(null);
    setPreviewError("");
    if (!wantsPreview) { setPreviewLoading(false); setOverrides({}); return; }
    setPreviewLoading(true);
    (async () => {
      try {
        const qs = new URLSearchParams({
          sourceEnv: srcSide.env, sourceTenantId: srcSide.tenantId, targetEnv, targetTenantId: effTenantId, domains: "tenant_config"
        });
        const res = await api(`/api/compare/copy-preview?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (id !== reqId.current) return;
        if (!res.ok) { setPreviewError(json.error || `HTTP ${res.status}`); return; }
        const data: CopyPreview = json.data;
        // Saran path awal untuk baris bentrok; setelah 409, override lama dipertahankan (lihat mergeOverrides)
        const entries = (data.domains.find((d) => d.domain === "tenant_config")?.items ?? []).map((item) => ({ key: item.configType, item }));
        setOverrides((prev) => mergeOverrides(prev, entries, takenPaths));
        setPreview(data);
      } catch (e: any) {
        if (id === reqId.current) setPreviewError(e?.message || "Gagal memuat daftar path");
      } finally {
        if (id === reqId.current) setPreviewLoading(false);
      }
    })();
  }, [wantsPreview, srcSide.env, srcSide.tenantId, targetEnv, effTenantId, reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Path config tercentang ----
  const previewItems = new Map((preview?.domains.find((d) => d.domain === "tenant_config")?.items ?? []).map((i) => [i.configType, i]));
  const pathRows: PathRow[] = checkedTypes.flatMap((configType) => {
    const item = previewItems.get(configType);
    if (!item) return [];
    const override = (overrides[configType] ?? "").trim();
    const pathOk = isPathOk(item, override, overrideStatus[configType] ?? "memeriksa");
    return [{ configType, item, path: override || item.path, pathOk, dup: false, showField: false }];
  });
  // Path akhir sama di antara config tercentang (ATS mencari config lewat path tanpa filter tenant)
  markDuplicatePaths(pathRows);
  // Tujuan manual tidak bisa dibaca (tidak ada pathConflict dari server): path tiap config tetap bisa diubah, SQL yang memeriksa sendiri.
  for (const r of pathRows) r.showField = showPathField({ item: r.item, override: overrides[r.configType], dup: r.dup, alwaysEditable: isManual });
  const shownRows = pathRows.filter((r) => r.showField);
  const pending = pathRows.filter((r) => !r.pathOk);
  const dupPaths = duplicatePathList(pathRows);

  const reasonText = reason.trim();
  const blockReason = (() => {
    if (sameAsSource) return ""; // sudah dijelaskan peringatan di bawah
    if (!targetOk) return isManual ? "Isi tenant_id tujuan (UUID atau GLOBAL_DEFAULT) dulu." : "Pilih tenant tujuan dulu.";
    if (checkedTypes.length === 0) return "Centang minimal satu config.";
    if (wantsPreview) {
      if (previewLoading) return "Memuat daftar path…";
      if (previewError || !preview) return "Daftar path belum berhasil dimuat.";
      if (pending.length > 0) return pendingPathReason(pending.map((r) => overrideStatus[r.configType] ?? "memeriksa"));
      if (dupPaths.length > 0) return `Path ganda dalam pilihan: ${dupPaths.join(", ")}. Ubah path salah satunya.`;
    }
    if (reasonText === "") return "Isi catatan alasan dulu.";
    if (reasonText.length > MAX_REASON) return `Catatan maksimal ${MAX_REASON} karakter.`;
    return "";
  })();
  const canBuild = !busy && !sameAsSource && blockReason === "";

  /** 409 PATH_CONFLICT: tidak ada SQL yang dibuat; muat ulang daftar path supaya baris yang bentrok ditandai. */
  const onPathConflict = (json: any) => {
    setError(`${json.error || "Path sudah dipakai tenant lain di tujuan."}\nDaftar path dimuat ulang; baris yang path-nya bentrok ditandai.`);
    takenRef.current = Array.isArray(json.paths) ? json.paths : [];
    setReloadTick((n) => n + 1);
  };

  const build = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const target = isManual
        ? { kind: "manual", tenantId: manualTenant.trim(), ...(manualGroup.trim() ? { groupId: manualGroup.trim() } : {}) }
        : { kind: "profile", env: targetEnv, tenantId: targetTenantId };
      // Path pengganti hanya untuk tenant_config; yang sama dengan path sumbernya tidak perlu dikirim
      const pathOverrides: Record<string, string> = {};
      for (const r of pathRows) {
        const o = overrideToSend(r.item, overrides[r.configType]);
        if (o) pathOverrides[r.configType] = o;
      }
      const res = await api("/api/compare/export-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEnv: srcSide.env, sourceTenantId: srcSide.tenantId, mode, reason: reasonText, target,
          domains: [{ domain: configDomain, configTypes: checkedTypes, pathOverrides }]
        })
      });
      const json = await res.json().catch(() => ({}));
      if (json.code === "PATH_CONFLICT") { onPathConflict(json); return; }
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
            <Segment value={source} onChange={pickSource} disabled={busy}
              options={[{ v: "kiri", label: "Kiri" }, { v: "kanan", label: "Kanan" }]} />
            <span className="truncate text-slate-500" title={`${srcEnv?.label ?? srcSide.env} · ${tenantsFor(srcSide.env).find((t) => t.tenantId === srcSide.tenantId)?.name ?? srcSide.tenantId}`}>
              {`${srcEnv?.label ?? srcSide.env} · ${tenantsFor(srcSide.env).find((t) => t.tenantId === srcSide.tenantId)?.name ?? srcSide.tenantId}`}
            </span>
          </div>

          <span>Env tujuan</span>
          <select className={`${INPUT} max-w-xs`} value={targetEnv} disabled={busy}
            onChange={(e) => { setTargetEnv(e.target.value); setTargetTenantId(""); setShowNew(false); resetResult(); }}>
            {targetEnvs.map((e) => <option key={e.name} value={e.name}>{e.label}</option>)}
            <option value={MANUAL_ENV}>Production (isi manual)</option>
          </select>

          <span>Tenant tujuan</span>
          {isManual ? (
            <div className="space-y-1 min-w-0">
              <div className="flex gap-2 min-w-0">
                <input className={`${INPUT} flex-1 min-w-0 font-mono`} placeholder="tenant_id (UUID atau GLOBAL_DEFAULT)" value={manualTenant} disabled={busy}
                  onChange={(e) => { setManualTenant(e.target.value); resetResult(); }} />
                <input className={`${INPUT} flex-1 min-w-0 font-mono`} placeholder="group_id (kosong = sama dengan tenant_id)" value={manualGroup} disabled={busy}
                  onChange={(e) => { setManualGroup(e.target.value); resetResult(); }} />
              </div>
              {manualTenant.trim() !== "" && !manualTenantOk && <div className="text-[11px] text-rose-300">tenant_id harus berupa UUID atau GLOBAL_DEFAULT.</div>}
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

        {sameAsSource && (
          <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">Sumber dan tujuan sama (env dan tenant). Pilih tujuan lain.</div>
        )}

        {wantsPreview && previewLoading && (
          <div className="text-xs text-slate-400 rounded-md border border-slate-800 px-3 py-2">Memuat daftar path…</div>
        )}
        {wantsPreview && previewError && (
          <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-md px-3 py-2">
            <span className="flex-1 min-w-0">{`Gagal memuat daftar path: ${previewError}`}</span>
            <button type="button" className={GHOST} disabled={busy} onClick={() => setReloadTick((n) => n + 1)}>Coba lagi</button>
          </div>
        )}
        {shownRows.length > 0 && (
          <section className="rounded-md border border-slate-800">
            <header className="flex items-center gap-2 px-3 py-1.5 bg-slate-950/40 border-b border-slate-800">
              <span className="text-xs font-semibold text-slate-200">Path config</span>
              <span className="text-[10px] text-slate-500">
                {isManual ? "Path tiap config bisa diubah." : "ATS mencari config lewat path tanpa filter tenant, jadi path tujuan harus unik."}
              </span>
            </header>
            <ul className="max-h-60 overflow-y-auto divide-y divide-slate-800/60">
              {shownRows.map((r) => (
                <li key={r.configType} className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-200 break-all">{r.configType}</span>
                    {(r.item.pathConflict || r.dup) && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300">Path bentrok</span>}
                  </div>
                  {r.item.pathConflict && (
                    <div className="mt-1 text-[11px] text-amber-200">
                      {`Path ${r.item.path} sudah dipakai tenant lain di tujuan (${r.item.pathConflict.ownerConfigType}). Ganti dengan path yang unik.`}
                    </div>
                  )}
                  {r.dup && !r.item.pathConflict && (
                    <div className="mt-1 text-[11px] text-amber-200">{`Path ${r.path} juga dipakai config lain yang dipilih. Ganti path salah satunya.`}</div>
                  )}
                  <div className="mt-1.5">
                    <PathOverrideField
                      value={overrides[r.configType] ?? r.item.path ?? ""} targetEnv={targetEnv} targetTenantId={effTenantId}
                      onChange={(v) => { setOverrides((p) => ({ ...p, [r.configType]: v })); resetResult(); }}
                      onStatus={(st) => setOverrideStatus((p) => (p[r.configType] === st ? p : { ...p, [r.configType]: st }))}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {isManual && <p className="px-3 py-2 border-t border-slate-800 text-[11px] text-slate-400">SQL akan batal sendiri bila path sudah dipakai tenant lain.</p>}
          </section>
        )}

        <label className="block text-xs text-slate-400">
          Catatan (alasan)
          <textarea
            className={`${INPUT} mt-1 w-full h-16 resize-none`} maxLength={MAX_REASON} value={reason} disabled={busy}
            placeholder="Kenapa SQL ini dibuat? Tercatat di Riwayat."
            onChange={(e) => { setReason(e.target.value); resetResult(); }}
          />
          <span className="block text-right text-[10px] text-slate-500">{`${reason.length}/${MAX_REASON}`}</span>
        </label>

        {error && <div className="text-xs whitespace-pre-line text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-md px-3 py-2">{error}</div>}

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

        <div className="flex items-center justify-end gap-2">
          {!result && blockReason && !busy && <p className="flex-1 min-w-0 text-[11px] text-amber-200">{blockReason}</p>}
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
