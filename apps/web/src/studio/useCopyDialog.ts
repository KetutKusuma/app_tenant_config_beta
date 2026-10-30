import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  MANUAL_ENV,
  type ConfigDomain, type CopyBatchResult, type CopyDialogDone, type CopyDialogRequest, type CopyPreview,
  type ExportSqlResult, type PathStatus, type PreviewItem, type Tenant
} from "../types";
import { useStudio } from "./StudioContext";

// State dan logika popup "Salin config" (tampilan: components/studio/CopyConfigDialog.tsx).
// Satu popup untuk dua pintu masuk (Salin ke… dari config, Duplikat tenant…): pilih env + tenant tujuan,
// centang config dari pratinjau, isi catatan, lalu Salin langsung atau Unduh SQL (env read-only / Production manual).

export const MAX_REASON = 500;
export const MANUAL_LABEL = "Production (isi manual)";
export const DOMAIN_TITLE: Record<ConfigDomain, string> = { tenant_config: "Tenant Configurations", workflow_pipeline: "Pipeline Workflow" };
// Teks "hasil tidak pasti" mengikuti dialog Salin ke Kanan lama (sudah diganti popup ini); kata "perbandingan" diganti "daftar" karena popup ini juga dipakai di luar layar Bandingkan
export const UNKNOWN_RESULT = "Hasil tidak pasti — koneksi terputus. Muat ulang daftar dan periksa tujuan serta Riwayat.";
const COMMIT_UNCERTAIN = "Hasil tidak pasti — periksa tujuan lalu muat ulang daftar.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Outcome = { kind: "copy"; data: CopyBatchResult } | { kind: "sql"; data: ExportSqlResult };
export interface NewTenantForm { tenantId: string; groupId: string; clientName: string; clientCode: string }
export const EMPTY_TENANT_FORM: NewTenantForm = { tenantId: "", groupId: "", clientName: "", clientCode: "" };

/** Satu baris daftar config beserta keadaan turunannya. */
export interface CopyRow {
  key: string;
  domain: ConfigDomain;
  item: PreviewItem;
  /** path akhir (override menang); null di domain tanpa kolom path */
  path: string | null;
  /** tercentang efektif: dipilih user dan path-nya sudah beres */
  checked: boolean;
  /** boleh dicentang: status bisa disalin dan path-nya beres */
  canCheck: boolean;
  /** dipilih user, tetapi path pengganti belum tersedia (diperiksa / sudah dipakai / kosong) */
  pathPending: boolean;
  /** path akhirnya sama dengan config lain yang tercentang */
  dup: boolean;
  /** tampilkan PathOverrideField */
  showField: boolean;
}

export const itemKey = (domain: ConfigDomain, configType: string) => `${domain}:${configType}`;
const canSelect = (it: PreviewItem) => it.status === "baru" || it.status === "timpa" || it.status === "tidak_dibaca";

export function downloadSql(sql: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([sql], { type: "application/sql" }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function useCopyDialog(request: CopyDialogRequest, cb: { onClose(): void; onDone(r: CopyDialogDone): void }) {
  const { targetEnvs, setStatusMessage } = useStudio();
  const [req] = useState(request); // isi awal dibekukan saat dialog dibuka
  const { source, domains } = req;

  // ---- Tujuan ----
  const [targetEnv, setTargetEnv] = useState<string>(() =>
    req.target?.env ?? (targetEnvs.some((e) => e.name === source.env) ? source.env : targetEnvs[0]?.name ?? MANUAL_ENV));
  const [tenantId, setTenantId] = useState(req.target && req.target.env !== MANUAL_ENV ? req.target.tenantId : "");
  const [manualTenant, setManualTenant] = useState(req.target?.env === MANUAL_ENV ? req.target.tenantId : "");
  const [manualGroup, setManualGroup] = useState("");
  const [tenantsByEnv, setTenantsByEnv] = useState<Record<string, Tenant[]>>({});
  const [tenantErrors, setTenantErrors] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<NewTenantForm>(EMPTY_TENANT_FORM);
  const [regError, setRegError] = useState("");
  const [registering, setRegistering] = useState(false);

  const isManual = targetEnv === MANUAL_ENV;
  const targetInfo = targetEnvs.find((e) => e.name === targetEnv);
  // Profil read-only dan Production manual: hasilnya file SQL (aturan spec §4.2)
  const sqlMode = isManual || Boolean(targetInfo?.readonly);
  const targetLabel = isManual ? MANUAL_LABEL : targetInfo?.label ?? targetEnv;
  const sourceLabel = targetEnvs.find((e) => e.name === source.env)?.label ?? source.env;
  const effTenantId = isManual ? manualTenant.trim() : tenantId;
  const manualTenantOk = UUID_RE.test(manualTenant.trim());
  const manualGroupOk = manualGroup.trim() === "" || UUID_RE.test(manualGroup.trim());
  const sameAsSource = !isManual && tenantId !== "" && targetEnv === source.env && tenantId === source.tenantId;
  const targetReady = isManual ? manualTenantOk : tenantId !== "" && !sameAsSource;

  const loadTenants = async (env: string, force = false) => {
    if (!force && requested.current.has(env)) return;
    requested.current.add(env);
    try {
      const res = await api("/api/tenants", { headers: { "X-Target-Env": env } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setTenantsByEnv((p) => ({ ...p, [env]: json.data || [] }));
      setTenantErrors((p) => ({ ...p, [env]: json.targetError ? `DB target tidak terjangkau: ${json.targetError}` : "" }));
    } catch (e: any) {
      requested.current.delete(env); // boleh dicoba lagi saat env dipilih ulang
      setTenantsByEnv((p) => ({ ...p, [env]: [] }));
      setTenantErrors((p) => ({ ...p, [env]: e?.message || "Gagal memuat daftar tenant" }));
    }
  };
  useEffect(() => { void loadTenants(source.env); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isManual) void loadTenants(targetEnv); }, [targetEnv]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceTenantCode = source.tenantId === "GLOBAL_DEFAULT"
    ? "GLOBAL_DEFAULT"
    : (tenantsByEnv[source.env] ?? []).find((t) => t.tenantId === source.tenantId)?.code ?? source.tenantId;
  // GLOBAL_DEFAULT tidak boleh menjadi tujuan; env + tenant sumber juga disembunyikan
  const tenantOptions = (tenantsByEnv[targetEnv] ?? []).filter((t) =>
    t.tenantId !== "GLOBAL_DEFAULT" && t.code !== "GLOBAL_DEFAULT" && !(targetEnv === source.env && t.tenantId === source.tenantId));
  const tenantsLoaded = isManual || tenantsByEnv[targetEnv] !== undefined;
  const tenantError = isManual ? "" : tenantErrors[targetEnv] ?? "";

  // ---- Umpan balik / hasil ----
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState<string[] | null>(null);
  // "commit" = server memastikan cadangan tersimpan; "unknown" = koneksi putus / respons bukan JSON, tidak ada yang pasti
  const [uncertain, setUncertain] = useState<null | "commit" | "unknown">(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const clearFeedback = () => { setError(""); setStale(null); setUncertain(null); setOutcome(null); setConfirming(false); };

  // ---- Pratinjau + pilihan ----
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [wish, setWish] = useState<Set<string>>(new Set()); // pilihan user (config bentrok baru tercentang efektif saat path-nya tersedia)
  const [overrides, setOverrides] = useState<Record<string, string>>({}); // `domain:type` → path pengganti
  const [overrideStatus, setOverrideStatus] = useState<Record<string, PathStatus>>({});
  const reqId = useRef(0);
  // Muat ulang yang mempertahankan pilihan (TARGET_CHANGED / PATH_CONFLICT); tanpa ini pilihan dihitung ulang dari `preselect`
  const keepRef = useRef<{ drop: string[]; takenPaths: string[] } | null>(null);

  const reloadPreview = (keep: { drop?: string[]; takenPaths?: string[] }) => {
    keepRef.current = { drop: keep.drop ?? [], takenPaths: keep.takenPaths ?? [] };
    setReloadTick((n) => n + 1);
  };

  const applyPreview = (data: CopyPreview, keep: { drop: string[]; takenPaths: string[] } | null) => {
    const pre = req.preselect === "all" ? null : new Set(req.preselect.map((p) => itemKey(p.domain, p.configType)));
    const all = data.domains.flatMap((d) => d.items.map((item) => ({ key: itemKey(d.domain, item.configType), item })));
    setWish((prev) => {
      const next = new Set<string>();
      for (const { key, item } of all) {
        if (!canSelect(item)) continue;
        if (keep) { if (prev.has(key) && !keep.drop.includes(item.configType)) next.add(key); }
        else if (!pre || pre.has(key)) next.add(key);
      }
      return next;
    });
    setOverrides((prev) => {
      const next: Record<string, string> = {};
      for (const { key, item } of all) {
        const old = keep ? prev[key] : undefined;
        // Path pengganti lama yang kini dipakai tenant lain: baris bentrok mendapat saran baru; baris lain
        // mempertahankannya supaya cek path menandainya "Sudah dipakai".
        const taken = old !== undefined && keep!.takenPaths.includes(old.trim());
        if (old !== undefined && !(taken && item.pathConflict)) next[key] = old;
        else if (item.pathConflict) next[key] = item.pathConflict.suggestion; // saran awal
      }
      return next;
    });
    setPreview(data);
  };

  useEffect(() => {
    const id = ++reqId.current;
    const keep = keepRef.current;
    keepRef.current = null;
    setOverrideStatus({});
    setPreview(null);
    setPreviewError("");
    if (!targetReady) {
      setPreviewLoading(false); setWish(new Set()); setOverrides({});
      return;
    }
    setPreviewLoading(true);
    (async () => {
      try {
        const qs = new URLSearchParams({
          sourceEnv: source.env, sourceTenantId: source.tenantId, targetEnv, targetTenantId: effTenantId, domains: domains.join(",")
        });
        const res = await api(`/api/compare/copy-preview?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (id !== reqId.current) return;
        if (!res.ok) {
          // 502: pesan server sudah menyebut env dan sisinya; selain itu sebut sumber dan tujuan
          setPreviewError(res.status === 502 && json.error
            ? json.error
            : `Gagal memuat daftar config dari ${sourceLabel} ke ${targetLabel}: ${json.error || `HTTP ${res.status}`}`);
          return;
        }
        applyPreview(json.data, keep);
      } catch (e: any) {
        if (id === reqId.current) setPreviewError(`Gagal memuat daftar config dari ${sourceLabel} ke ${targetLabel}: ${e?.message || "koneksi gagal"}`);
      } finally {
        if (id === reqId.current) setPreviewLoading(false);
      }
    })();
  }, [targetReady, targetEnv, effTenantId, reloadTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Baris turunan ----
  const rows = useMemo<CopyRow[]>(() => {
    const list: CopyRow[] = [];
    for (const dom of preview?.domains ?? []) {
      for (const item of dom.items) {
        const key = itemKey(dom.domain, item.configType);
        const override = (overrides[key] ?? "").trim();
        const st = overrideStatus[key] ?? "memeriksa";
        // Bentrok: wajib punya path pengganti yang tersedia. Bukan bentrok: override (bila diisi) harus tersedia.
        const pathOk = item.pathConflict ? override !== "" && st === "tersedia" : override === "" || st === "tersedia";
        const selectable = canSelect(item);
        const wished = selectable && wish.has(key);
        list.push({
          key, domain: dom.domain, item,
          path: dom.domain === "tenant_config" ? override || item.path : null,
          checked: wished && pathOk, canCheck: selectable && pathOk, pathPending: wished && !pathOk, dup: false, showField: false
        });
      }
    }
    // Path akhir sama di antara config tercentang (ATS mencari config lewat path tanpa filter tenant)
    const byPath = new Map<string, CopyRow[]>();
    for (const r of list) if (r.checked && r.path) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
    for (const g of byPath.values()) if (g.length > 1) g.forEach((r) => { r.dup = true; });
    // Kolom tetap tampil begitu ada override, supaya tidak hilang saat user mengetik.
    // Production isi manual: tujuan tidak bisa dibaca (tidak ada pathConflict dari server), jadi path setiap
    // config tenant_config yang bisa disalin tetap bisa diedit; SQL-nya yang memeriksa sendiri (spec §8).
    for (const r of list) {
      const manualEditable = isManual && r.domain === "tenant_config" && canSelect(r.item);
      r.showField = r.item.pathConflict !== null || overrides[r.key] !== undefined || r.dup || manualEditable;
    }
    return list;
  }, [preview, wish, overrides, overrideStatus, isManual]);

  const groups = useMemo(() => {
    const byDomain = new Map<ConfigDomain, CopyRow[]>();
    for (const r of rows) byDomain.set(r.domain, [...(byDomain.get(r.domain) ?? []), r]);
    return [...byDomain.entries()].map(([domain, list]) => {
      const ordered = [...list.filter((r) => r.item.status !== "hanya_tujuan"), ...list.filter((r) => r.item.status === "hanya_tujuan")];
      const addable = list.filter((r) => r.canCheck);
      return { domain, rows: ordered, addable: addable.length, checkedCount: addable.filter((r) => r.checked).length };
    });
  }, [rows]);

  const checkedRows = rows.filter((r) => r.checked);
  const n = checkedRows.length;
  const nBaru = checkedRows.filter((r) => r.item.status === "baru").length;
  const nTimpa = checkedRows.filter((r) => r.item.status === "timpa").length;
  const nUnread = checkedRows.filter((r) => r.item.status === "tidak_dibaca").length;
  const nSkipped = rows.filter((r) => r.item.status !== "hanya_tujuan").length - n;
  const dupPaths = [...new Set(rows.filter((r) => r.dup).map((r) => r.path as string))].sort();
  const pending = rows.filter((r) => r.pathPending);
  const pendingChecking = pending.some((r) => (overrideStatus[r.key] ?? "memeriksa") === "memeriksa");
  const pendingFailed = pending.some((r) => overrideStatus[r.key] === "gagal");
  const targetCode = preview?.targetTenantCode ?? tenantOptions.find((t) => t.tenantId === tenantId)?.code ?? "";

  const reasonText = reason.trim();
  const blockReason = (() => {
    if (sameAsSource) return "Sumber dan tujuan sama (env dan tenant). Pilih tujuan lain.";
    if (!targetReady) return isManual ? "Isi tenant_id tujuan dulu." : "Pilih tenant tujuan dulu.";
    if (isManual && !manualGroupOk) return "group_id harus berupa UUID.";
    if (previewLoading) return "Memuat daftar config…";
    if (previewError || !preview) return "Daftar config belum berhasil dimuat.";
    if (stale) return "Muat ulang daftar config dulu.";
    if (pending.length > 0) {
      if (pendingFailed) return "Cek path gagal; coba lagi.";
      return pendingChecking ? "Path pengganti masih diperiksa." : "Path pengganti sudah dipakai atau kosong; ubah path-nya.";
    }
    if (dupPaths.length > 0) return `Path ganda dalam pilihan: ${dupPaths.join(", ")}. Ubah path salah satunya atau kurangi centang.`;
    if (n === 0) return "Centang minimal satu config.";
    if (reasonText === "") return "Isi catatan alasan dulu.";
    if (reasonText.length > MAX_REASON) return `Catatan maksimal ${MAX_REASON} karakter.`;
    if (!sqlMode && !targetCode) return "Kode tenant tujuan belum diketahui.";
    return "";
  })();
  const locked = busy || registering || outcome !== null || uncertain !== null;
  const canSubmit = !locked && blockReason === "";

  // ---- Pilihan ----
  const toggle = (key: string) => setWish((p) => { const next = new Set(p); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleGroup = (domain: ConfigDomain) => {
    const list = rows.filter((r) => r.domain === domain);
    const addable = list.filter((r) => r.canCheck);
    const allChecked = addable.length > 0 && addable.every((r) => r.checked);
    setWish((p) => {
      const next = new Set(p);
      for (const r of list) { if (allChecked) next.delete(r.key); else if (r.canCheck) next.add(r.key); }
      return next;
    });
  };
  const setOverride = (key: string, value: string) => setOverrides((p) => ({ ...p, [key]: value }));
  const setOverrideState = (key: string, s: PathStatus) => setOverrideStatus((p) => (p[key] === s ? p : { ...p, [key]: s }));

  const pickEnv = (env: string) => {
    setTargetEnv(env); setTenantId(""); setShowNew(false); setRegError(""); clearFeedback();
  };
  const pickTenant = (id: string) => { setTenantId(id); clearFeedback(); };
  const typeManualTenant = (v: string) => { setManualTenant(v); clearFeedback(); };

  const registerTenant = async () => {
    const id = newForm.tenantId.trim();
    if (!UUID_RE.test(id)) { setRegError("tenant_id harus berupa UUID."); return; }
    if ((tenantsByEnv[targetEnv] ?? []).some((t) => t.tenantId.toLowerCase() === id.toLowerCase())) {
      setRegError(`Tenant ini sudah terdaftar di ${targetLabel}; pilih dari daftar.`);
      return;
    }
    setRegistering(true); setRegError("");
    try {
      const res = await api("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Target-Env": targetEnv },
        body: JSON.stringify({ tenantId: id, groupId: newForm.groupId.trim(), clientName: newForm.clientName.trim(), clientCode: newForm.clientCode.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) { setRegError(json.message || json.error || `HTTP ${res.status}`); return; }
      await loadTenants(targetEnv, true);
      pickTenant(id);
      setShowNew(false);
      setNewForm(EMPTY_TENANT_FORM);
    } catch (e: any) {
      setRegError(e?.message || "Gagal mendaftarkan tenant");
    } finally {
      setRegistering(false);
    }
  };

  // ---- Kirim ----
  const selection = () => (preview?.domains ?? [])
    .map((d) => ({ domain: d.domain, items: d.items, sel: rows.filter((r) => r.domain === d.domain && r.checked) }))
    .filter((d) => d.sel.length > 0);
  // Path pengganti hanya untuk tenant_config; override yang sama dengan path aslinya tidak perlu dikirim
  const pathOverridesOf = (domain: ConfigDomain, sel: CopyRow[]) => {
    const out: Record<string, string> = {};
    if (domain !== "tenant_config") return out;
    for (const r of sel) {
      const o = (overrides[r.key] ?? "").trim();
      if (o && o !== r.item.path) out[r.item.configType] = o;
    }
    return out;
  };

  /** 409 PATH_CONFLICT (copy maupun export): tidak ada yang ditulis; muat ulang pratinjau supaya baris bentrok ditandai. */
  const onPathConflict = (json: any) => {
    setError(`${json.error || "Path sudah dipakai tenant lain di tujuan."}\nDaftar config dimuat ulang; baris yang path-nya bentrok ditandai.`);
    reloadPreview({ takenPaths: Array.isArray(json.paths) ? json.paths : [] });
  };

  const runCopy = async () => {
    setConfirming(false);
    setBusy(true); setError(""); setStale(null); setUncertain(null);
    try {
      const body = {
        sourceEnv: source.env, sourceTenantId: source.tenantId, targetTenantId: effTenantId, reason: reasonText,
        domains: selection().map(({ domain, items, sel }) => ({
          domain,
          expectedTargetVersions: Object.fromEntries(items.map((i) => [i.configType, i.targetVersion])),
          confirmedCreate: sel.filter((r) => r.item.status === "baru").map((r) => r.item.configType),
          confirmedOverwrite: sel.filter((r) => r.item.status === "timpa").map((r) => r.item.configType),
          pathOverrides: pathOverridesOf(domain, sel)
        }))
      };
      const res = await api("/api/compare/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Target-Env": targetEnv },
        body: JSON.stringify(body)
      }, targetInfo?.protected ? targetEnv : undefined);
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const d: CopyBatchResult = json.data;
        setOutcome({ kind: "copy", data: d });
        const sum = (pick: (x: CopyBatchResult["domains"][number]) => number) => d.domains.reduce((t, x) => t + pick(x), 0);
        setStatusMessage(`✅ Salin selesai: ${sum((x) => x.created.length)} dibuat, ${sum((x) => x.overwritten.length)} ditimpa`);
        setTimeout(() => setStatusMessage(null), 3500);
      } else if (json.code === "PATH_CONFLICT") {
        onPathConflict(json);
      } else if (json.code === "TARGET_CHANGED") {
        setError(json.error || "Isi tujuan berubah sejak daftar config dimuat.");
        setStale(json.configTypes ?? []);
      } else if (json.commitUncertain) {
        setError(json.error || COMMIT_UNCERTAIN);
        setUncertain("commit");
      } else if (res.status >= 500 && !json.error) {
        setError(UNKNOWN_RESULT);
        setUncertain("unknown");
      } else {
        setError(json.error || `HTTP ${res.status}`);
      }
    } catch {
      setError(UNKNOWN_RESULT);
      setUncertain("unknown");
    } finally {
      setBusy(false);
    }
  };

  const runExport = async () => {
    setBusy(true); setError("");
    try {
      const target = isManual
        ? { kind: "manual", tenantId: effTenantId, ...(manualGroup.trim() ? { groupId: manualGroup.trim() } : {}) }
        : { kind: "profile", env: targetEnv, tenantId };
      const res = await api("/api/compare/export-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEnv: source.env, sourceTenantId: source.tenantId, mode: "timpa", reason: reasonText, target,
          domains: selection().map(({ domain, sel }) => ({
            domain, configTypes: sel.map((r) => r.item.configType), pathOverrides: pathOverridesOf(domain, sel)
          }))
        })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const d: ExportSqlResult = json.data;
        setOutcome({ kind: "sql", data: d });
        downloadSql(d.sql, d.fileName);
      } else if (json.code === "PATH_CONFLICT") {
        onPathConflict(json);
      } else {
        setError(json.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      setError(e?.message || "Gagal membuat SQL");
    } finally {
      setBusy(false);
    }
  };

  /** Tombol utama: Unduh SQL langsung; Salin minta ketik kode tenant tujuan dulu. */
  const submit = () => { if (sqlMode) void runExport(); else setConfirming(true); };
  /** "Muat ulang" setelah TARGET_CHANGED: config yang berubah harus dicentang ulang user. */
  const reloadAfterStale = () => {
    const drop = stale ?? [];
    setError(""); setStale(null);
    reloadPreview({ drop });
  };

  // ---- Tutup ----
  const done = (wrote: boolean): CopyDialogDone => ({ target: { env: targetEnv, tenantId: effTenantId }, wrote });
  // Hasil tidak pasti dihitung "mungkin menulis" supaya pemanggil memuat ulang
  const close = () => {
    if (outcome?.kind === "copy" || uncertain) cb.onDone(done(true));
    else if (outcome?.kind === "sql") cb.onDone(done(false));
    else cb.onClose();
  };
  const onEsc = () => {
    if (busy || registering || showHistory) return; // panel Riwayat menutup dirinya sendiri
    if (confirming) setConfirming(false);
    else close();
  };

  return {
    source, domains, sourceLabel, sourceTenantCode,
    envOptions: targetEnvs, targetEnv, targetInfo, targetLabel, isManual, sqlMode, locked, targetLocked: locked || Boolean(req.lockTarget),
    pickEnv, pickTenant, tenantId, tenantOptions, tenantsLoaded, tenantError, effTenantId, manualTenant, typeManualTenant,
    manualGroup, setManualGroup, manualTenantOk, manualGroupOk,
    showNew, setShowNew, newForm, setNewForm, regError, registering, registerTenant,
    preview, previewLoading, previewError, groups, targetReady,
    toggle, toggleGroup, overrides, setOverride, setOverrideState,
    n, nBaru, nTimpa, nUnread, nSkipped,
    reason, setReason, reasonText, blockReason, canSubmit, busy, submit,
    confirming, setConfirming, runCopy, targetCode,
    error, stale, uncertain, outcome, reloadAfterStale,
    showHistory, setShowHistory, close, onEsc
  };
}
