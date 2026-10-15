import { api } from "../lib/api";
import type { ConfigItem, Tenant, TenantSuggestion } from "../types";
import type { StudioState } from "./useStudioState";
import type { CoreActions } from "./useCoreActions";

// Aksi CRUD: metadata tenant, tambah/hapus config, ekspor preset & skill.
export function useCrudActions(ctx: StudioState & CoreActions) {
  const {
    activeConfigType, configToDelete, deleteInputConfirmation, exportScope, exportSubfolder, fetchReferences,
    fetchTenants, includeSkillPreset, jsonContent, loadConfig, newConfigForm, presetDirPath,
    presetSaveFilename, presetSaveTargetDir, savePresetDirPref, selectedConfigId, selectedTenant,
    setActiveConfigType, setConfigToDelete, setConfigs, setDeleteError, setDeleteInputConfirmation,
    setExportScope, setIncludeSkillPreset, setIsDeletingConfig, setIsEditingTenant, setIsExportingSkill,
    setIsSavingPreset, setJsonContent, setOriginalContent, setPresetSaveFilename, setPresetSaveTargetDir,
    setSavePresetStatus, setSelectedConfigId, setShowAddConfigModal, setShowDeleteConfigModal,
    setShowSavePresetModal, setShowTenantModal, setStatusMessage, setTenantForm, setTenantToDelete, tenantForm
  } = ctx;

  const openSavePresetModal = () => {
    const defaultScope = selectedConfigId ? "single" : (selectedTenant ? "current_tenant" : "all_tenants");
    setExportScope(defaultScope);
    const defaultName = activeConfigType ? `${activeConfigType}.json` : "config.json";
    setPresetSaveFilename(defaultName);
    setPresetSaveTargetDir(presetDirPath);
    setIncludeSkillPreset(true);
    setSavePresetStatus(null);
    setShowSavePresetModal(true);
  };

  const handleExportSkillOnly = async () => {
    try {
      setIsExportingSkill(true);
      const res = await api("/api/references/export-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: presetDirPath })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal mengekspor skill");
      setStatusMessage(`✨ ${data.message}`);
      setTimeout(() => setStatusMessage(null), 3500);
    } catch (err: any) {
      alert("Gagal mengekspor skill: " + err.message);
    } finally {
      setIsExportingSkill(false);
    }
  };

  const handleSaveToPreset = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsSavingPreset(true);
    setSavePresetStatus(null);
    try {
      if (exportScope === "single") {
        if (!presetSaveFilename.trim()) {
          setSavePresetStatus({ type: "error", message: "Nama file wajib diisi!" });
          setIsSavingPreset(false);
          return;
        }

        let parsedContent: any;
        try {
          parsedContent = JSON.parse(jsonContent);
        } catch (err: any) {
          setSavePresetStatus({ type: "error", message: "JSON di editor tidak valid: " + err.message });
          setIsSavingPreset(false);
          return;
        }

        const res = await api("/api/references/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dir: presetSaveTargetDir,
            filename: presetSaveFilename,
            content: parsedContent,
            includeSkill: includeSkillPreset
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gagal menyimpan preset");

        setSavePresetStatus({
          type: "success",
          message: data.message
        });
        setStatusMessage(`💾 ${data.message}`);
      } else {
        // Bulk Export: current_tenant atau all_tenants
        const res = await api("/api/references/export-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dir: presetSaveTargetDir,
            scope: exportScope,
            tenantId: selectedTenant?.tenantId,
            namingStrategy: exportSubfolder ? "tenant_folder" : (exportScope === "all_tenants" ? "tenant_folder" : "config_type"),
            overwrite: true,
            includeSkill: includeSkillPreset
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gagal mengekspor semua presets");

        setSavePresetStatus({
          type: "success",
          message: data.message
        });
        setStatusMessage(`💾 ${data.message}`);
      }

      setTimeout(() => setStatusMessage(null), 3500);

      // Refresh katalog presets (folder tujuan ekspor menjadi folder aktif user)
      await fetchReferences(presetSaveTargetDir);
      if (presetSaveTargetDir && presetSaveTargetDir !== presetDirPath) savePresetDirPref(presetSaveTargetDir);

      setTimeout(() => {
        setShowSavePresetModal(false);
      }, 1500);
    } catch (err: any) {
      setSavePresetStatus({ type: "error", message: err.message });
    } finally {
      setIsSavingPreset(false);
    }
  };

  // 7. Add or Edit Tenant Submit Handler
  const handleTenantFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantForm.tenantId || !tenantForm.clientName) {
      alert("Tenant ID dan Nama Klien wajib diisi!");
      return;
    }

    try {
      const tagsArray = tenantForm.tags.split(",").map(s => s.trim()).filter(Boolean);
      const res = await api("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantForm.tenantId,
          groupId: tenantForm.groupId || null,
          clientName: tenantForm.clientName,
          clientCode: tenantForm.clientCode || tenantForm.tenantId.substring(0, 4).toUpperCase(),
          tags: tagsArray,
          notes: tenantForm.notes
        })
      });

      const data = await res.json();
      if (data.success) {
        setShowTenantModal(false);
        setStatusMessage(`✅ ${data.message || `Metadata ${tenantForm.clientName} berhasil disimpan!`}`);
        fetchTenants(data.code || tenantForm.clientCode);
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        alert("Gagal menyimpan tenant: " + (data.error || "Error"));
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const openEditTenantModal = (t: Tenant, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsEditingTenant(true);
    setTenantForm({
      tenantId: t.tenantId,
      groupId: t.groupId || "",
      clientName: t.name,
      clientCode: t.code,
      tags: t.tags ? t.tags.join(", ") : "",
      notes: t.notes || ""
    });
    setShowTenantModal(true);
  };

  // Hapus tenant dari daftar Studio env aktif (metadata saja; config di ats_db tetap utuh)
  const handleDeleteTenant = async (tenant: Tenant) => {
    try {
      const res = await api(`/api/tenants/${encodeURIComponent(tenant.tenantId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTenantToDelete(null);
      setStatusMessage(`🗑️ ${data.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
      // Tenant yang sedang dibuka ikut terhapus: muat ulang daftar & pilih tenant lain
      await fetchTenants(selectedTenant?.tenantId === tenant.tenantId ? undefined : selectedTenant?.code);
    } catch (err: any) {
      alert("Gagal menghapus tenant: " + err.message);
    }
  };

  // Daftarkan klien yang sudah ada di env lain: nama & kode terisi, tenant_id/group_id diisi manual (beda per env)
  const openAddTenantFromSuggestion = (sug: TenantSuggestion) => {
    setIsEditingTenant(false);
    setTenantForm({
      tenantId: sug.tenantId || "",
      groupId: "",
      clientName: sug.name,
      clientCode: sug.baseCode,
      tags: "",
      notes: ""
    });
    setShowTenantModal(true);
  };

  const openAddTenantModal = () => {
    setIsEditingTenant(false);
    setTenantForm({
      tenantId: "",
      groupId: "",
      clientName: "",
      clientCode: "",
      tags: "",
      notes: ""
    });
    setShowTenantModal(true);
  };

  // 8. Add New Configuration Handler
  const handleAddConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) {
      alert("Silakan pilih tenant terlebih dahulu!");
      return;
    }
    if (!newConfigForm.configType.trim()) {
      alert("configType wajib diisi!");
      return;
    }

    try {
      let initialValue: any = { views: [] };
      if (newConfigForm.templateSource === "copy_active") {
        try {
          initialValue = JSON.parse(jsonContent);
        } catch {
          initialValue = { views: [] };
        }
      }

      const res = await api("/api/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenant.tenantId,
          groupId: newConfigForm.groupId || selectedTenant.groupId || null,
          configType: newConfigForm.configType.trim().toUpperCase(),
          path: newConfigForm.path.trim() || null,
          value: initialValue
        })
      });

      const data = await res.json();
      if (data.success) {
        setShowAddConfigModal(false);
        setStatusMessage(`✅ Konfigurasi ${newConfigForm.configType} berhasil ditambahkan!`);
        // Refresh daftar konfigurasi tenant ini
        const cfgRes = await api(`/api/tenants/${selectedTenant.tenantId}/configs`);
        const cfgJson = await cfgRes.json();
        if (cfgJson.data) {
          setConfigs(cfgJson.data);
          loadConfig(data.data.id, newConfigForm.configType.trim().toUpperCase(), newConfigForm.groupId);
        }
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        alert("Gagal menambahkan config: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  // 8b. Delete Configuration Handler
  const openDeleteConfigModal = (config: ConfigItem) => {
    setConfigToDelete(config);
    setDeleteInputConfirmation("");
    setDeleteError(null);
    setShowDeleteConfigModal(true);
  };

  const handleDeleteConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configToDelete) return;

    if (deleteInputConfirmation.trim() !== configToDelete.config_type) {
      setDeleteError(`Nama konfirmasi '${deleteInputConfirmation}' tidak cocok dengan '${configToDelete.config_type}'`);
      return;
    }

    setIsDeletingConfig(true);
    setDeleteError(null);

    try {
      const res = await api(`/api/configs/${configToDelete.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationConfigType: deleteInputConfirmation.trim(),
          authorName: "Studio User"
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menghapus konfigurasi");

      setStatusMessage(`🗑️ ${data.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
      setShowDeleteConfigModal(false);

      // Refresh configs for current tenant
      if (selectedTenant) {
        const cfgRes = await api(`/api/tenants/${selectedTenant.tenantId}/configs`);
        const cfgJson = await cfgRes.json();
        const remainingConfigs: ConfigItem[] = cfgJson.data || [];
        setConfigs(remainingConfigs);

        // Jika config yang dihapus adalah config aktif, beralih atau kosongkan
        if (selectedConfigId === configToDelete.id) {
          if (remainingConfigs.length > 0) {
            loadConfig(remainingConfigs[0].id, remainingConfigs[0].config_type, remainingConfigs[0].group_id);
          } else {
            setSelectedConfigId(null);
            setActiveConfigType("");
            setJsonContent("{}");
            setOriginalContent("{}");
          }
        }

        // Refresh tenant list agar jumlah totalConfigs terupdate
        fetchTenants(selectedTenant.code);
      }
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setIsDeletingConfig(false);
    }
  };

  return {
    openSavePresetModal, handleExportSkillOnly, handleSaveToPreset, handleTenantFormSubmit,
    openEditTenantModal, openAddTenantModal, openAddTenantFromSuggestion, handleDeleteTenant, handleAddConfigSubmit, openDeleteConfigModal,
    handleDeleteConfigSubmit
  };
}
