import { useState } from "react";
import { api } from "../lib/api";
import type { SyncApplyResult, SyncRow } from "../types";
import { calculateJsonDelta } from "../utils/jsonDiff";
import type { StudioState } from "./useStudioState";
import type { CoreActions } from "./useCoreActions";

// State & aksi Sync Center (tenant_configurations <-> file preset lokal).
export function useSyncCenter(ctx: StudioState & CoreActions) {
  const {
    activeConfigType, currentGroupId, fetchHistories, fetchReferences, loadConfig, presetDirPath,
    selectedConfigId, selectedTenant, setIsSplitScreen, setLocalFileOriginalContent, setLocalFilePath,
    setSplitJsonContent, setSplitMode, setSplitTitle, setStatusMessage
  } = ctx;

  // Modal State: Sync Center (Granular Synchronizer)
  const [showSyncTenantModal, setShowSyncTenantModal] = useState(false);
  const [syncRows, setSyncRows] = useState<SyncRow[]>([]);
  const [syncUnlinked, setSyncUnlinked] = useState<Array<{ path: string; name: string }>>([]);
  const [syncSelected, setSyncSelected] = useState<Set<string>>(new Set());
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncApplyResult | null>(null);
  // Wizard Sync Center: 1 = pilih, 2 = pratinjau diff, 3 = hasil
  const [syncStep, setSyncStep] = useState<1 | 2 | 3>(1);
  const [syncDirection, setSyncDirection] = useState<"push" | "pull" | null>(null);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncPreview, setSyncPreview] = useState<Array<{
    configType: string;
    filePath: string;
    added: number;
    removed: number;
    modified: number;
    total: number;
    blocked?: string;
    error?: string;
  }>>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Catatan (alasan) wajib untuk push; pull tidak memakainya
  const [syncReason, setSyncReason] = useState("");

  const openSyncCenter = () => {
    setShowSyncTenantModal(true);
    setSyncStep(1);
    setSyncDirection(null);
    setSyncReason("");
    setSyncResult(null);
    setSyncError(null);
    fetchSyncStatus();
  };

  const fetchSyncStatus = async () => {
    if (!selectedTenant) return;
    setSyncLoading(true);
    setSyncError(null);
    try {
      const res = await api(`/api/sync/status?tenantId=${encodeURIComponent(selectedTenant.tenantId)}&dir=${encodeURIComponent(presetDirPath)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengambil status sinkronisasi");
      setSyncRows(json.data || []);
      setSyncUnlinked(json.unlinkedFiles || []);
      const diffKeys = new Set<string>(
        (json.data || [])
          .filter((r: SyncRow) => r.filePath && r.status === "different")
          .map((r: SyncRow) => r.configType)
      );
      setSyncSelected(diffKeys);
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setSyncLoading(false);
    }
  };

  const toggleSyncSelected = (configType: string) => {
    setSyncSelected(prev => {
      const next = new Set(prev);
      if (next.has(configType)) next.delete(configType);
      else next.add(configType);
      return next;
    });
  };

  const handleSyncLink = async (row: SyncRow, newPath: string) => {
    if (!selectedTenant) return;
    try {
      const res = await api("/api/sync/link", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenant.tenantId,
          configType: row.configType,
          filePath: newPath
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengubah tautan file");
      fetchSyncStatus();
    } catch (err: any) {
      alert("Gagal menyimpan link file: " + err.message);
    }
  };

  const handleSyncCompare = async (row: SyncRow) => {
    if (!row.filePath) return;
    try {
      await loadConfig(row.configId, row.configType, row.groupId);
      const res = await api(`/api/references/file?path=${encodeURIComponent(row.filePath)}`);
      const json = await res.json();
      if (json.content) {
        const pretty = JSON.stringify(json.content, null, 2);
        setSplitJsonContent(pretty);
        setLocalFilePath(row.filePath);
        setLocalFileOriginalContent(pretty);
        setSplitTitle(row.filePath.split("/").pop() || row.configType);
        setIsSplitScreen(true);
        setSplitMode("diff");
        setShowSyncTenantModal(false);
      }
    } catch (err: any) {
      alert("Gagal membuka perbandingan: " + err.message);
    }
  };

  // Langkah 2 wizard: hitung perubahan per item sebelum benar-benar menulis apa pun
  const goSyncPreview = async (direction: "push" | "pull") => {
    const rows = syncRows.filter(r => syncSelected.has(r.configType) && r.filePath);
    if (rows.length === 0) {
      alert("Tidak ada item terpilih yang memiliki file lokal!");
      return;
    }
    setSyncDirection(direction);
    setSyncStep(2);
    setSyncPreviewLoading(true);
    const preview = await Promise.all(rows.map(async (row) => {
      const base = { configType: row.configType, filePath: row.filePath!, added: 0, removed: 0, modified: 0, total: 0 };
      try {
        const [dbRes, fileRes] = await Promise.all([
          api(`/api/configs/${row.configId}`).then(r => r.json()),
          api(`/api/references/file?path=${encodeURIComponent(row.filePath!)}`).then(r => r.json())
        ]);
        if (!dbRes.data) return { ...base, error: "Config DB tidak ditemukan" };
        if (fileRes.content === undefined) return { ...base, error: fileRes.error || "File tidak bisa dibaca" };
        const dbValue = dbRes.data.value || {};
        // Baseline = sisi yang akan ditimpa, target = isi barunya
        const delta = direction === "push"
          ? calculateJsonDelta(dbValue, fileRes.content, "DB", "File")
          : calculateJsonDelta(fileRes.content, dbValue, "File", "DB");
        const { addedCount, removedCount, modifiedCount, totalChanges } = delta.summary;
        const blocked = row.duplicateType
          ? "tipe kembar"
          : direction === "push" && row.pullRequired && totalChanges > 0
          ? "perlu pull dulu"
          : undefined;
        return { ...base, added: addedCount, removed: removedCount, modified: modifiedCount, total: totalChanges, blocked };
      } catch (err: any) {
        return { ...base, error: err.message };
      }
    }));
    setSyncPreview(preview);
    setSyncPreviewLoading(false);
  };

  const runSyncApply = async (direction: "push" | "pull") => {
    if (!selectedTenant || syncSelected.size === 0) return;
    const targetItems = syncRows
      .filter(r => syncSelected.has(r.configType) && r.filePath)
      .map(r => ({ configType: r.configType, filePath: r.filePath! }));

    if (targetItems.length === 0) {
      alert("Tidak ada item terpilih yang memiliki file lokal!");
      return;
    }

    const reason = syncReason.trim();
    if (direction === "push" && !reason) {
      alert("Catatan (alasan) wajib diisi untuk push.");
      return;
    }

    // Konfirmasi sudah dilakukan lewat langkah Pratinjau di wizard
    setSyncBusy(true);
    setSyncResult(null);
    try {
      const res = await api("/api/sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenant.tenantId,
          direction,
          items: targetItems,
          groupId: currentGroupId || selectedTenant.groupId,
          ...(direction === "push" ? { reason } : {})
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal melakukan sinkronisasi");
      setSyncResult(json);
      if (direction === "push") setSyncReason("");
      setStatusMessage(`⚡ Sync ${direction === "push" ? "Push" : "Pull"} selesai: ${json.updated} diupdate, ${json.skipped} sama, ${json.failed} gagal`);
      setTimeout(() => setStatusMessage(null), 4000);
      await fetchSyncStatus();
      if (selectedConfigId) {
        fetchHistories(selectedConfigId);
        const activeUpdated = targetItems.some(item => item.configType === activeConfigType);
        if (activeUpdated) {
          loadConfig(selectedConfigId, activeConfigType, currentGroupId);
        }
      }
      fetchReferences(presetDirPath);
    } catch (err: any) {
      alert("Gagal menerapkan sync: " + err.message);
    } finally {
      setSyncBusy(false);
    }
  };

  return {
    showSyncTenantModal, setShowSyncTenantModal, syncRows, setSyncRows, syncUnlinked, setSyncUnlinked,
    syncSelected, setSyncSelected, syncLoading, setSyncLoading, syncBusy, setSyncBusy, syncResult,
    setSyncResult, syncStep, setSyncStep, syncDirection, setSyncDirection, syncPreviewLoading,
    setSyncPreviewLoading, syncPreview, setSyncPreview, syncError, setSyncError, syncReason, setSyncReason, openSyncCenter,
    fetchSyncStatus, toggleSyncSelected, handleSyncLink, handleSyncCompare, goSyncPreview, runSyncApply
  };
}
