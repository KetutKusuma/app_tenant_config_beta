import { api } from "../lib/api";
import type { ConfigItem } from "../types";
import type { StudioState } from "./useStudioState";
import type { CoreActions } from "./useCoreActions";

// Aksi perbandingan antar tenant (split kanan = tenant pembanding).
export function useCompareActions(ctx: StudioState & CoreActions) {
  const {
    activeConfigType, askSummary, compareConfigId, compareConfigType, compareConfigVersion, compareConfigs,
    compareModalConfigType, compareModalMode, compareModalTenantId, compareTenant,
    compareTenantOriginalContent, configVersion, jsonContent, originalContent, selectedConfigId,
    selectedTenant, setActiveConfigType, setCompareConfigId, setCompareConfigType, setCompareConfigVersion,
    setCompareConfigs, setCompareModalConfigType, setCompareModalTenantId, setCompareTenant,
    setCompareTenantOriginalContent, setConfigVersion, setConfigs, setCurrentGroupId,
    setIsSavingCompareTenant, setIsSplitScreen, setJsonContent, setLocalFilePath, setOriginalContent,
    setSelectedConfigId, setSelectedTenant, setShowCompareTenantModal, setSplitJsonContent, setSplitMode,
    setSplitSourceType, setSplitTitle, setStatusMessage, splitJsonContent, splitTitle, tenants
  } = ctx;

  // 11b. Cross-Tenant Comparison Handlers
  const openCompareTenantModal = () => {
    if (!selectedTenant) {
      alert("Pilih tenant aktif terlebih dahulu!");
      return;
    }
    const other = tenants.find(t => t.tenantId !== selectedTenant.tenantId) || tenants[0];
    if (other) {
      setCompareModalTenantId(other.tenantId);
      fetchCompareTenantConfigs(other.tenantId, activeConfigType);
    }
    setShowCompareTenantModal(true);
  };

  const fetchCompareTenantConfigs = async (tenantId: string, preferType?: string) => {
    try {
      const res = await api(`/api/tenants/${tenantId}/configs`);
      const json = await res.json();
      const items: ConfigItem[] = json.data || [];
      setCompareConfigs(items);
      if (items.length > 0) {
        const match = items.find(c => c.config_type === (preferType || activeConfigType)) || items[0];
        setCompareModalConfigType(match.config_type);
      } else {
        setCompareModalConfigType("");
      }
    } catch (err) {
      console.error("Gagal mengambil configs tenant pembanding:", err);
    }
  };

  const handleCompareModalTenantChange = (tenantId: string) => {
    setCompareModalTenantId(tenantId);
    fetchCompareTenantConfigs(tenantId, compareModalConfigType || activeConfigType);
  };

  const handleStartTenantComparison = async (targetTenantId?: string, configType?: string, initialMode?: "side-by-side" | "diff" | "json-delta") => {
    const tid = targetTenantId || compareModalTenantId;
    const ctype = configType || compareModalConfigType;
    if (!tid) return;

    try {
      const targetTenant = tenants.find(t => t.tenantId === tid);
      if (!targetTenant) return;

      const cfgRes = await api(`/api/tenants/${tid}/configs`);
      const cfgJson = await cfgRes.json();
      const items: ConfigItem[] = cfgJson.data || [];
      setCompareConfigs(items);

      const targetConfig = items.find(c => c.config_type === ctype) || items[0];
      if (!targetConfig) {
        alert(`Tenant '${targetTenant.name}' belum memiliki konfigurasi '${ctype}'!`);
        return;
      }

      const detailRes = await api(`/api/configs/${targetConfig.id}`);
      const detailJson = await detailRes.json();
      if (detailJson.data && detailJson.data.value) {
        const pretty = JSON.stringify(detailJson.data.value, null, 2);
        setSplitJsonContent(pretty);
        setCompareTenantOriginalContent(pretty);
        setCompareConfigVersion(detailJson.data.version_token || null);
        setLocalFilePath(null);
        setCompareTenant(targetTenant);
        setCompareConfigId(targetConfig.id);
        setCompareConfigType(targetConfig.config_type);
        setSplitTitle(`${targetTenant.name} (${targetTenant.code}) - ${targetConfig.config_type}`);
        setSplitSourceType("tenant");
        setSplitMode(initialMode || compareModalMode || "side-by-side");
        setIsSplitScreen(true);
        setShowCompareTenantModal(false);
        setStatusMessage(`⇄ Split aktif: ${selectedTenant?.name} vs ${targetTenant.name} (${targetConfig.config_type})`);
        setTimeout(() => setStatusMessage(null), 3500);
      }
    } catch (err: any) {
      alert("Gagal memuat konfigurasi tenant pembanding: " + err.message);
    }
  };

  const handleSwitchCompareTenant = async (targetTenantId: string) => {
    const targetTenant = tenants.find(t => t.tenantId === targetTenantId);
    if (!targetTenant) return;

    try {
      const cfgRes = await api(`/api/tenants/${targetTenantId}/configs`);
      const cfgJson = await cfgRes.json();
      const items: ConfigItem[] = cfgJson.data || [];
      setCompareConfigs(items);

      const targetConfig = items.find(c => c.config_type === activeConfigType) || items[0];
      if (targetConfig) {
        const detailRes = await api(`/api/configs/${targetConfig.id}`);
        const detailJson = await detailRes.json();
        if (detailJson.data && detailJson.data.value) {
          const pretty = JSON.stringify(detailJson.data.value, null, 2);
          setSplitJsonContent(pretty);
          setCompareTenantOriginalContent(pretty);
          setCompareConfigVersion(detailJson.data.version_token || null);
          setCompareTenant(targetTenant);
          setCompareConfigId(targetConfig.id);
          setCompareConfigType(targetConfig.config_type);
          setSplitTitle(`${targetTenant.name} (${targetTenant.code}) - ${targetConfig.config_type}`);
        }
      } else {
        setSplitJsonContent("{}");
        setCompareTenantOriginalContent("{}");
        setCompareConfigVersion(null);
        setCompareTenant(targetTenant);
        setCompareConfigId(null);
        setCompareConfigType(null);
        setSplitTitle(`${targetTenant.name} (Tidak ada config)`);
      }
    } catch (err: any) {
      alert("Gagal memuat tenant pembanding: " + err.message);
    }
  };

  const handleSwitchCompareConfig = async (targetConfigId: string) => {
    const targetConfig = compareConfigs.find(c => c.id === targetConfigId);
    if (!targetConfig || !compareTenant) return;

    try {
      const detailRes = await api(`/api/configs/${targetConfig.id}`);
      const detailJson = await detailRes.json();
      if (detailJson.data && detailJson.data.value) {
        const pretty = JSON.stringify(detailJson.data.value, null, 2);
        setSplitJsonContent(pretty);
        setCompareTenantOriginalContent(pretty);
        setCompareConfigVersion(detailJson.data.version_token || null);
        setCompareConfigId(targetConfig.id);
        setCompareConfigType(targetConfig.config_type);
        setSplitTitle(`${compareTenant.name} (${compareTenant.code}) - ${targetConfig.config_type}`);
      }
    } catch (err: any) {
      alert("Gagal memuat detail konfigurasi: " + err.message);
    }
  };

  const handleSwapTenants = async () => {
    if (!compareTenant || !compareConfigId || !selectedTenant || !selectedConfigId) return;

    const prevLeftTenant = selectedTenant;
    const prevLeftConfigId = selectedConfigId;
    const prevLeftConfigType = activeConfigType;
    const prevLeftJson = jsonContent;
    const prevLeftOriginal = originalContent;
    const prevLeftVersion = configVersion;

    const prevRightTenant = compareTenant;
    const prevRightConfigId = compareConfigId;
    const prevRightConfigType = compareConfigType;
    const prevRightJson = splitJsonContent;
    const prevRightOriginal = compareTenantOriginalContent;
    const prevRightVersion = compareConfigVersion;

    // Swap Left to Right
    setSelectedTenant(prevRightTenant);
    setSelectedConfigId(prevRightConfigId);
    setActiveConfigType(prevRightConfigType || "");
    setJsonContent(prevRightJson);
    setOriginalContent(prevRightOriginal);
    setConfigVersion(prevRightVersion);
    setCurrentGroupId(prevRightTenant.groupId || "");

    // Swap Right to Left
    setCompareTenant(prevLeftTenant);
    setCompareConfigId(prevLeftConfigId);
    setCompareConfigType(prevLeftConfigType);
    setSplitJsonContent(prevLeftJson);
    setCompareTenantOriginalContent(prevLeftOriginal);
    setCompareConfigVersion(prevLeftVersion);
    setSplitTitle(`${prevLeftTenant.name} (${prevLeftTenant.code}) - ${prevLeftConfigType}`);

    try {
      const cfgRes = await api(`/api/tenants/${prevRightTenant.tenantId}/configs`);
      const cfgJson = await cfgRes.json();
      if (cfgJson.data) setConfigs(cfgJson.data);

      const rRes = await api(`/api/tenants/${prevLeftTenant.tenantId}/configs`);
      const rJson = await rRes.json();
      if (rJson.data) setCompareConfigs(rJson.data);
    } catch (err) {
      console.error("Gagal refresh configs saat swap:", err);
    }

    setStatusMessage(`⇄ Posisi tenant ditukar: ${prevRightTenant.name} sekarang di kiri (aktif), ${prevLeftTenant.name} di kanan.`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleSaveCompareTenant = async () => {
    if (!compareConfigId || !compareTenant) return;
    try {
      const parsed = JSON.parse(splitJsonContent);
      setIsSavingCompareTenant(true);
      const summary = await askSummary(
        `Simpan ke ${compareTenant.name}`,
        "Update via Cross-Tenant Split Studio",
        `${compareConfigType} · tenant pembanding (window kanan).`
      );
      if (summary === null) {
        setIsSavingCompareTenant(false);
        return;
      }

      const res = await api(`/api/configs/${compareConfigId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: parsed,
          groupId: compareTenant.groupId || null,
          changeSummary: summary,
          authorName: "Studio Developer",
          expectedVersion: compareConfigVersion
        })
      });

      const data = await res.json();
      if (res.status === 409) {
        alert(`Gagal menyimpan ke ${compareTenant.name}: ${data.error}\n\nPilih ulang config tenant pembanding di dropdown untuk memuat versi terbaru.`);
        return;
      }
      if (data.success) {
        setCompareConfigVersion(data.versionToken || null);
        setStatusMessage(`✅ Berhasil disimpan ke ${compareTenant.name}! Versi ${data.version} tercatat.`);
        setCompareTenantOriginalContent(splitJsonContent);
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        alert("Gagal menyimpan ke tenant: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error parsing JSON: " + err.message);
    } finally {
      setIsSavingCompareTenant(false);
    }
  };

  const handleFormatCompareTenant = () => {
    try {
      const parsed = JSON.parse(splitJsonContent);
      setSplitJsonContent(JSON.stringify(parsed, null, 2));
      setStatusMessage("✨ JSON tenant pembanding berhasil diformat rapi.");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      alert("Gagal merapikan JSON: " + err.message);
    }
  };

  const handleRevertCompareTenant = () => {
    if (confirm(`Batalkan semua perubahan dan kembalikan ke konfigurasi awal tenant ${compareTenant?.name}?`)) {
      setSplitJsonContent(compareTenantOriginalContent);
    }
  };

  const handleApplyCompareToLive = () => {
    setJsonContent(splitJsonContent);
    setStatusMessage(`📋 Konfigurasi dari ${compareTenant?.name || splitTitle} diterapkan ke editor live (kiri).`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  return {
    openCompareTenantModal, fetchCompareTenantConfigs, handleCompareModalTenantChange,
    handleStartTenantComparison, handleSwitchCompareTenant, handleSwitchCompareConfig, handleSwapTenants,
    handleSaveCompareTenant, handleFormatCompareTenant, handleRevertCompareTenant, handleApplyCompareToLive
  };
}
