import { useEffect, useRef } from "react";
import type { StudioUser } from "../components/AuthGate";
import { api, getActiveDomain, getActiveTargetEnv, setActiveDomain, setActiveTargetEnv, setEnvConfirmHandler } from "../lib/api";
import { type ConfigDomain, type ConfigItem, DOMAIN_LABEL, type TargetEnvInfo, type Tenant } from "../types";
import type { StudioState } from "./useStudioState";

// Aksi inti: muat tenant/config, ganti env/domain, validasi, simpan, shortcut & guard perubahan.
export function useCoreActions(s: StudioState) {
  const {
    activeConfigType, askReason, configDomain, configVersion, currentGroupId, dbSnapshotVersion,
    isCompareTenantDirty, isLocalDirty, isSaving, jsonContent, originalContent, presetDirPath,
    presetInputPath, searchQuery, selectedConfigId, selectedTenant, setActiveConfigType, setCompareConfigId,
    setCompareTenant, setConfigDomain, setConfigVersion, setConfigs, setCopiedTenantId, setCurrentGroupId,
    setDbSnapshotVersion, setEnvConfirm, setHistories, setIsDbNewer, setIsLoadingConfig, setIsSaving,
    setIsSplitScreen, setJsonContent, setLocalFileOriginalContent, setLocalFilePath, setOriginalContent,
    setPresetDirPath, setPresetInputPath, setReferences, setSelectedConfigId, setSelectedTenant,
    setShowValidationPanel, setSplitJsonContent, setSplitMode, setSplitSourceType, setSplitTitle,
    setStatusMessage, setTargetEnvName, setTargetEnvs, setTenantSuggestions, setTenants, setTenantsWarning,
    setUser, setValidationIssues, showEnvCompare,
    splitJsonContent, targetEnvName, targetEnvs, tenants, user
  } = s;

  const copyToClipboard = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedTenantId(text);
    setStatusMessage(`📋 Copied: ${text}`);
    setTimeout(() => {
      setCopiedTenantId(null);
      setStatusMessage(null);
    }, 2500);
  };

  // 1. Fetch Tenant List & Local References on Mount
  useEffect(() => {
    fetchTargetEnvs();
    fetchTenants();
    fetchReferences(presetDirPath);
    setEnvConfirmHandler((env) => new Promise<boolean>((resolve) => setEnvConfirm({ env, resolve })));
    return () => {
      setEnvConfirmHandler(null);
    };
  }, []);

  // Daftar tenant SELALU diganti sesuai env aktif, termasuk saat kosong: jangan biarkan tenant env
  // sebelumnya (tenant_id dev) tetap tampil dan terpakai untuk membaca DB env lain.
  // selectCode boleh kode penuh (IDM_PROD) atau kode dasar (IDM): saat pindah env, tenant yang sama
  // dicari lewat kode dasar karena tenant_id & client_code-nya berbeda di tiap env.
  const fetchTenants = async (selectCode?: string) => {
    try {
      const res = await api("/api/tenants");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const list: Tenant[] = json.data || [];
      setTenants(list);
      setTenantsWarning(json.targetError ? `DB target tidak terjangkau: ${json.targetError}` : null);
      if (list.length === 0) {
        clearSelectedTenant();
        fetchTenantSuggestions();
        return;
      }
      setTenantSuggestions([]);
      const byCode = (code: string) =>
        list.find(t => t.code === code) || list.find(t => (t.baseCode || t.code) === code);
      const target = (selectCode && byCode(selectCode))
        || list.find(t => t.tenantId === user.preferences.lastTenantId)
        || byCode("IDM")
        || list[0];
      selectTenant(target);
    } catch (err: any) {
      console.error("Gagal mengambil tenant list:", err);
      setTenants([]);
      clearSelectedTenant();
      setTenantsWarning(`Gagal memuat daftar tenant: ${err.message}`);
    }
  };

  const clearSelectedTenant = () => {
    setSelectedTenant(null);
    setCurrentGroupId("");
    resetWorkspace();
  };

  const fetchTenantSuggestions = async () => {
    try {
      const res = await api("/api/tenants/catalog");
      const json = await res.json();
      setTenantSuggestions(res.ok ? json.data || [] : []);
    } catch {
      setTenantSuggestions([]);
    }
  };

  const fetchReferences = async (dirToFetch: string) => {
    try {
      const res = await api(`/api/references?dir=${encodeURIComponent(dirToFetch)}`);
      const json = await res.json();
      if (json.data) {
        setReferences(json.data);
        if (json.currentDir) {
          setPresetDirPath(json.currentDir);
          setPresetInputPath(json.currentDir);
        }
      }
    } catch (err) {
      console.error("Gagal mengambil local references:", err);
    }
  };

  // Simpan preferensi user (folder preset per domain, tenant terakhir) ke BFF
  const savePreferences = async (prefs: Partial<StudioUser["preferences"]>) => {
    try {
      const res = await api("/api/me/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs)
      });
      const json = await res.json();
      if (res.ok && json.user) setUser(json.user);
    } catch (err) {
      console.error("Gagal menyimpan preferensi:", err);
    }
  };
  const savePresetDirPref = (dir: string) =>
    savePreferences(getActiveDomain() === "workflow_pipeline" ? { presetDirWorkflow: dir } : { presetDirTenant: dir });

  const handleUpdatePresetDir = (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetInputPath.trim()) return;
    fetchReferences(presetInputPath.trim());
    savePresetDirPref(presetInputPath.trim());
    setStatusMessage(`📁 Folder presets diubah ke: ${presetInputPath.trim()}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // 2. Select Tenant & Fetch configs
  const selectTenant = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    if (user.preferences.lastTenantId !== tenant.tenantId) savePreferences({ lastTenantId: tenant.tenantId });
    setCurrentGroupId(tenant.groupId || "");
    try {
      const res = await api(`/api/tenants/${tenant.tenantId}/configs`);
      const json = await res.json();
      if (json.data) {
        setConfigs(json.data);
        const candidateStable = json.data.find((c: ConfigItem) => c.config_type === "CANDIDATE_STABLE") || json.data[0];
        if (candidateStable) {
          loadConfig(candidateStable.id, candidateStable.config_type, candidateStable.group_id);
        } else {
          setJsonContent("{}");
          setSelectedConfigId(null);
          setActiveConfigType("");
        }
      }
    } catch (err) {
      console.error("Gagal mengambil configs tenant:", err);
    }
  };

  // Ganti domain: Tenant Config <-> Workflow Pipeline (public.pipeline_workflow_configurations)
  // Kosongkan editor & panel saat sumber data berganti (domain atau target env)
  const resetWorkspace = () => {
    setIsSplitScreen(false);
    setValidationIssues([]);
    setShowValidationPanel(false);
    setHistories([]);
    setConfigs([]);
    setSelectedConfigId(null);
    setActiveConfigType("");
    setJsonContent("{}");
    setOriginalContent("{}");
    setConfigVersion(null);
    setIsDbNewer(false);
  };

  // Daftar profil target env (envs/<nama>.env) + status koneksi
  const fetchTargetEnvs = async () => {
    try {
      const res = await api("/api/envs");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal memuat daftar env");
      const list: TargetEnvInfo[] = json.data || [];
      setTargetEnvs(list);
      json.errors?.forEach((e: string) => console.warn("Profil env tidak valid:", e));
      // Preferensi lama menunjuk env yang sudah dihapus: pindah ke default server
      if (!list.some(e => e.name === getActiveTargetEnv())) {
        setActiveTargetEnv(json.defaultEnv);
        setTargetEnvName(json.defaultEnv);
      }
    } catch (err) {
      console.error("Gagal memuat target env:", err);
    }
  };

  const handleSwitchTargetEnv = async (next: string) => {
    if (next === targetEnvName) return;
    if (jsonContent !== originalContent && !confirm("Ada perubahan yang belum disimpan. Pindah env dan buang perubahan tersebut?")) return;
    setActiveTargetEnv(next);
    setTargetEnvName(next);
    resetWorkspace();
    savePreferences({ lastTargetEnv: next });
    await fetchTenants(selectedTenant?.baseCode || selectedTenant?.code);
    const env = targetEnvs.find(e => e.name === next);
    setStatusMessage(`🌐 Target env: ${env?.label || next}${env?.readonly ? " (read-only)" : ""}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleSwitchDomain = async (next: ConfigDomain) => {
    if (next === configDomain) return;
    if (jsonContent !== originalContent && !confirm("Ada perubahan yang belum disimpan. Pindah domain dan buang perubahan tersebut?")) return;
    setActiveDomain(next);
    setConfigDomain(next);
    resetWorkspace();
    // Folder preset mengikuti domain (preferensi user); kosong = default server untuk domain tsb
    const nextDir = next === "workflow_pipeline"
      ? user.preferences.presetDirWorkflow || ""
      : user.preferences.presetDirTenant || "";
    fetchReferences(nextDir);
    // Muat ulang daftar tenant (jumlah config per domain) dan pertahankan tenant yang sedang dipilih
    await fetchTenants(selectedTenant?.baseCode || selectedTenant?.code);
    setStatusMessage(`🔀 Domain aktif: ${DOMAIN_LABEL[next]}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // 3. Load Main Config JSON
  const loadConfig = async (configId: string, configType: string, grpId?: string | null) => {
    setIsLoadingConfig(true);
    setSelectedConfigId(configId);
    setActiveConfigType(configType);
    setCurrentGroupId(grpId || "");
    setConfigVersion(null);
    try {
      const res = await api(`/api/configs/${configId}`);
      const json = await res.json();
      if (json.data && json.data.value) {
        const pretty = JSON.stringify(json.data.value, null, 2);
        setJsonContent(pretty);
        setOriginalContent(pretty);
        setConfigVersion(json.data.version_token || null);
        setIsDbNewer(false);
        if (json.data.group_id) {
          setCurrentGroupId(json.data.group_id);
        }
      }
      fetchHistories(configId);
    } catch (err) {
      console.error("Gagal memuat detail config:", err);
    } finally {
      setIsLoadingConfig(false);
    }
  };

  // 4. Fetch Histories from Neon DB
  const fetchHistories = async (configId: string) => {
    try {
      const res = await api(`/api/configs/${configId}/histories`);
      const json = await res.json();
      if (json.data) {
        setHistories(json.data);
      }
    } catch (err) {
      console.error("Gagal memuat histories:", err);
    }
  };

  // 5. Pre-flight Validator / Linting
  const handleValidate = async (): Promise<boolean> => {
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(jsonContent);
      } catch (e: any) {
        setValidationIssues([
          { severity: "error", message: `Sintaks JSON tidak valid: ${e.message}`, path: "SyntaxError" }
        ]);
        setShowValidationPanel(true);
        setStatusMessage("❌ Sintaks JSON tidak valid! Buka panel validasi di bawah.");
        setTimeout(() => setStatusMessage(null), 4000);
        return false;
      }

      const res = await api("/api/validator/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed })
      });
      const data = await res.json();
      setShowValidationPanel(true);
      if (data.issues && data.issues.length > 0) {
        setValidationIssues(data.issues);
        const errCount = data.issues.filter((i: any) => i.severity === "error").length;
        const warnCount = data.issues.filter((i: any) => i.severity === "warning").length;
        setStatusMessage(`⚠️ Ditemukan ${data.issues.length} catatan linter (${errCount} error, ${warnCount} warning).`);
      } else {
        setValidationIssues([
          { severity: "success", message: "Semua struktur JSON & guardrail ATS valid! Tidak ada kesalahan sintaks atau view yang terdeteksi." }
        ]);
        setStatusMessage("✅ Validasi lolos! Siap disimpan ke database.");
      }
      setTimeout(() => setStatusMessage(null), 4000);
      return !(data.issues || []).some((i: any) => i.severity === "error");
    } catch (err: any) {
      setValidationIssues([{ severity: "error", message: `Error koneksi validator: ${err.message}` }]);
      setShowValidationPanel(true);
      return false;
    }
  };

  // Ambil isi config aktif TERBARU dari database (tanpa menyentuh editor)
  const fetchLatestDbConfig = async (): Promise<{ pretty: string; version: string | null } | null> => {
    if (!selectedConfigId) return null;
    const res = await api(`/api/configs/${selectedConfigId}`);
    const json = await res.json();
    if (!res.ok || !json.data) throw new Error(json.error || "Config tidak ditemukan");
    return { pretty: JSON.stringify(json.data.value || {}, null, 2), version: json.data.version_token || null };
  };

  // Bandingkan isi editor (kanan) dengan versi database terbaru (kiri) dalam Visual Diff
  const handleCompareWithDb = async () => {
    try {
      const latest = await fetchLatestDbConfig();
      if (!latest) return;
      setSplitJsonContent(latest.pretty);
      setLocalFileOriginalContent(latest.pretty);
      setDbSnapshotVersion(latest.version);
      setLocalFilePath(null);
      setCompareTenant(null);
      setCompareConfigId(null);
      setSplitSourceType("db");
      setSplitTitle(`DB Terbaru (${new Date().toLocaleTimeString("id-ID")})`);
      setSplitMode("diff");
      setIsSplitScreen(true);
      setIsDbNewer(latest.version !== configVersion);
      if (latest.pretty === jsonContent) {
        setStatusMessage("✅ Isi editor sama persis dengan database terbaru.");
        setTimeout(() => setStatusMessage(null), 3500);
      }
    } catch (err: any) {
      alert("Gagal mengambil data terbaru dari database: " + err.message);
    }
  };

  // Ganti isi editor dengan snapshot DB yang sedang dibandingkan (ikut memperbarui versi untuk Save)
  const handleApplyDbSnapshot = () => {
    if (jsonContent !== originalContent && !confirm("Perubahan di editor yang belum disimpan akan diganti dengan isi database terbaru. Lanjutkan?")) return;
    setJsonContent(splitJsonContent);
    setOriginalContent(splitJsonContent);
    setConfigVersion(dbSnapshotVersion);
    setIsDbNewer(false);
    setStatusMessage("🔄 Editor diperbarui dengan isi database terbaru.");
    setTimeout(() => setStatusMessage(null), 3500);
  };

  // Muat ulang config aktif dari database (tanpa perlu restart aplikasi)
  const handleReloadFromDb = async () => {
    if (!selectedConfigId) return;
    if (jsonContent !== originalContent && !confirm("Ada perubahan yang belum disimpan. Muat ulang dari database dan buang perubahan tersebut?\n\nTips: pakai 'Bandingkan DB' dulu untuk melihat perbedaannya.")) return;
    await loadConfig(selectedConfigId, activeConfigType, currentGroupId);
    setStatusMessage("🔄 Konfigurasi dimuat ulang dari database.");
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // Cek ringan apakah DB sudah berubah sejak config dimuat: saat tab kembali fokus & tiap 60 detik
  useEffect(() => {
    if (!selectedConfigId || !configVersion) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await api(`/api/configs/${selectedConfigId}`);
        const json = await res.json();
        if (!cancelled && json.data) setIsDbNewer(json.data.version_token !== configVersion);
      } catch {
        /* abaikan: hanya indikator */
      }
    };
    const timer = setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [selectedConfigId, configVersion]);

  // Simpan ditolak karena DB berubah sejak dimuat: tawarkan pull ulang, isi editor diamankan ke clipboard
  const handleStaleConfig = async (message: string) => {
    if (!selectedConfigId) return;
    if (!confirm(`${message}\n\nMuat ulang (pull) versi terbaru dari database sekarang? Isi editor Anda akan disalin ke clipboard terlebih dahulu.`)) return;
    try {
      await navigator.clipboard.writeText(jsonContent);
    } catch {
      /* clipboard tidak tersedia: tetap lanjut, user sudah dikonfirmasi */
    }
    await loadConfig(selectedConfigId, activeConfigType, currentGroupId);
    setStatusMessage("🔄 Versi terbaru dimuat dari database. Isi editor sebelumnya ada di clipboard.");
    setTimeout(() => setStatusMessage(null), 5000);
  };

  // 6. Save Configuration
  const handleSave = async (quick = false) => {
    if (!selectedConfigId) return;
    try {
      const parsed = JSON.parse(jsonContent);
      setIsSaving(true);
      const summary = quick
        ? "Update via Tenant Studio"
        : await askReason({
            title: `Simpan ${activeConfigType}`,
            description: `${DOMAIN_LABEL[configDomain]} · ${selectedTenant?.name || ""}. Versi sebelumnya otomatis diarsipkan ke History.`,
            before: JSON.parse(originalContent),
            after: parsed
          });
      if (summary === null) {
        setIsSaving(false);
        return;
      }

      const res = await api(`/api/configs/${selectedConfigId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: parsed,
          groupId: currentGroupId || null,
          changeSummary: summary,
          authorName: "Studio Developer",
          expectedVersion: configVersion
        })
      });

      const data = await res.json();
      if (res.status === 409) {
        handleStaleConfig(data.error);
        return;
      }
      if (data.success) {
        setStatusMessage(`✅ Berhasil disimpan! Versi ${data.version} tercatat di Neon DB.`);
        setOriginalContent(jsonContent);
        setConfigVersion(data.versionToken || null);
        setIsDbNewer(false);
        fetchHistories(selectedConfigId);
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        alert("Gagal menyimpan: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error parsing JSON sebelum menyimpan: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleValidateAndSave = async () => {
    if (await handleValidate()) {
      handleSave();
    } else {
      alert("Validasi menemukan error. Perbaiki dulu (lihat panel Linter) sebelum menyimpan.");
    }
  };

  const isDirty = jsonContent !== originalContent;
  const isTargetReadonly = !!targetEnvs.find((e) => e.name === targetEnvName)?.readonly;

  // Konfirmasi sebelum pindah tenant/config bila editor punya perubahan yang belum disimpan
  const confirmDiscard = (action: string) =>
    !isDirty || confirm(`Ada perubahan yang belum disimpan. ${action} dan buang perubahan tersebut?`);
  const openTenant = (t: Tenant) => {
    if (confirmDiscard("Pindah tenant")) selectTenant(t);
  };
  const openConfig = (c: ConfigItem) => {
    if (confirmDiscard("Buka konfigurasi lain")) loadConfig(c.id, c.config_type, c.group_id);
  };

  // Peringatan browser saat menutup/refresh tab dengan perubahan yang belum disimpan
  useEffect(() => {
    if (!isDirty && !isLocalDirty && !isCompareTenantDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, isLocalDirty, isCompareTenantDirty]);

  // Shortcut keyboard: Ctrl/⌘+S validasi lalu simpan, Ctrl/⌘+Enter validasi, Ctrl/⌘+K cari tenant.
  // Listener capture-phase supaya tetap jalan saat fokus di Monaco; handler lewat ref agar selalu pakai state terbaru.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shortcutHandlerRef = useRef<(e: KeyboardEvent) => void>();
  shortcutHandlerRef.current = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    const flash = (msg: string) => {
      setStatusMessage(msg);
      setTimeout(() => setStatusMessage(null), 2500);
    };
    // Layar Bandingkan antar env terbuka: editor studio tersembunyi, jangan menyimpan/validasi/fokus cari
    if (showEnvCompare) {
      if (key === "s") e.preventDefault();
      return;
    }
    if (key === "s") {
      e.preventDefault();
      if (!selectedConfigId || isSaving) return;
      if (isTargetReadonly) return flash("🔒 Environment ini read-only, tidak bisa menyimpan.");
      if (!isDirty) return flash("Tidak ada perubahan untuk disimpan.");
      handleValidateAndSave();
    } else if (key === "enter") {
      if (!selectedConfigId) return;
      e.preventDefault();
      e.stopPropagation();
      handleValidate();
    } else if (key === "k" && !(e.target as HTMLElement | null)?.closest?.(".monaco-editor")) {
      // Di dalam Monaco, Ctrl/⌘+K adalah awalan chord (mis. toggle comment), jadi dibiarkan
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => shortcutHandlerRef.current?.(e);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.tenantId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.groupId && t.groupId.toLowerCase().includes(searchQuery.toLowerCase())) ||
    t.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return {
    copyToClipboard, fetchTenants, fetchReferences, savePreferences, savePresetDirPref,
    handleUpdatePresetDir, selectTenant, resetWorkspace, fetchTargetEnvs, handleSwitchTargetEnv,
    handleSwitchDomain, loadConfig, fetchHistories, handleValidate, fetchLatestDbConfig, handleCompareWithDb,
    handleApplyDbSnapshot, handleReloadFromDb, handleStaleConfig, handleSave, handleValidateAndSave, isDirty,
    isTargetReadonly, confirmDiscard, openTenant, openConfig, searchInputRef, shortcutHandlerRef,
    filteredTenants
  };
}

export type CoreActions = ReturnType<typeof useCoreActions>;
