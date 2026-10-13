import { useMemo } from "react";
import { api } from "../lib/api";
import type { HistoryItem, ReferenceItem } from "../types";
import { calculateJsonDelta, formatDeltaOutput } from "../utils/jsonDiff";
import type { StudioState } from "./useStudioState";
import type { CoreActions } from "./useCoreActions";

// Aksi split pane: preset lokal, riwayat, salin views, dan JSON Delta.
export function useEditorActions(ctx: StudioState & CoreActions) {
  const {
    activeConfigType, compareConfigType, compareTenant, configVersion, fetchHistories, fetchReferences,
    handleStaleConfig, isSplitScreen, jsonContent, jsonDeltaDirection, jsonDeltaFormat,
    localFileOriginalContent, localFilePath, originalContent, presetDirPath, selectedConfigId,
    selectedTenant, setCompareConfigId, setCompareTenant, setConfigVersion, setCopiedNotification,
    setCurrentGroupId, setDeltaCopied, setIsDbNewer, setIsSavingLocal, setIsSplitScreen, setJsonContent,
    setLocalFileOriginalContent, setLocalFilePath, setOriginalContent, setShowHistoryModal, setShowRefDrawer,
    setSplitJsonContent, setSplitMode, setSplitSourceType, setSplitTitle, setStatusMessage, splitJsonContent,
    splitSourceType, splitTitle
  } = ctx;

  // Handler: Terapkan isi Preset ke Window Editor Database (Tanpa auto-save)
  const handleApplyPresetToLive = () => {
    try {
      JSON.parse(splitJsonContent);
      setJsonContent(splitJsonContent);
      setStatusMessage("📥 Isi file preset berhasil diterapkan ke editor live!");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      alert("Isi preset bukan format JSON yang valid: " + err.message);
    }
  };

  // Handler: Sinkronisasi 1 File Preset Langsung ke Database (+ simpan history)
  const handleSyncPresetSingleToDb = async () => {
    if (!selectedConfigId) {
      alert("Silakan pilih konfigurasi aktif di database terlebih dahulu!");
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(splitJsonContent);
    } catch (err: any) {
      alert("Isi file preset bukan JSON yang valid: " + err.message);
      return;
    }

    if (!confirm(`Apakah Anda yakin ingin menyinkronkan file preset '${splitTitle}' langsung ke database untuk ${activeConfigType}? Versi sebelumnya akan otomatis diarsipkan ke history.`)) {
      return;
    }

    try {
      const res = await api("/api/references/sync-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configId: selectedConfigId,
          content: parsed,
          sourceFilename: splitTitle,
          expectedVersion: configVersion
        })
      });
      const data = await res.json();
      if (res.status === 409) {
        handleStaleConfig(data.error);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Gagal sinkronisasi");

      setJsonContent(splitJsonContent);
      setOriginalContent(splitJsonContent);
      setConfigVersion(data.versionToken || null);
      setIsDbNewer(false);
      setStatusMessage(`⚡ ${data.message}`);
      setTimeout(() => setStatusMessage(null), 3500);

      // Refresh histories
      fetchHistories(selectedConfigId);
    } catch (err: any) {
      alert("Gagal sinkronisasi: " + err.message);
    }
  };

  // Handler: Simpan perubahan langsung ke file lokal di disk
  const handleSaveLocalFile = async () => {
    if (!localFilePath) return;
    setIsSavingLocal(true);
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(splitJsonContent);
      } catch (e: any) {
        alert("Isi file lokal bukan JSON yang valid: " + e.message);
        setIsSavingLocal(false);
        return;
      }
      const res = await api("/api/references/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localFilePath, content: parsed })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan file");
      setLocalFileOriginalContent(splitJsonContent);
      setStatusMessage(`💾 ${data.message}`);
      setTimeout(() => setStatusMessage(null), 3500);
      fetchReferences(presetDirPath);
    } catch (err: any) {
      alert("Gagal menyimpan file: " + err.message);
    } finally {
      setIsSavingLocal(false);
    }
  };

  // Handler: Format JSON di editor database live
  const handleFormatMainJson = () => {
    try {
      const parsed = JSON.parse(jsonContent);
      setJsonContent(JSON.stringify(parsed, null, 2));
      setStatusMessage("✨ JSON database berhasil diformat rapi (indent 2 spasi).");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      alert(`Gagal memformat JSON: Sintaks tidak valid (${err.message})`);
    }
  };

  // Handler: Format JSON di editor lokal
  const handleFormatLocal = () => {
    try {
      const parsed = JSON.parse(splitJsonContent);
      setSplitJsonContent(JSON.stringify(parsed, null, 2));
      setStatusMessage("✨ JSON preset lokal berhasil diformat rapi (indent 2 spasi).");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      alert("Gagal merapikan JSON: " + err.message);
    }
  };

  // Handler: Kembalikan isi editor lokal ke isi file terakhir
  const handleRevertLocal = () => {
    if (!localFilePath) return;
    if (confirm("Batalkan semua perubahan dan kembalikan ke isi file terakhir?")) {
      setSplitJsonContent(localFileOriginalContent);
    }
  };

  // Handler: Salin isi database live ke window lokal
  const handleCopyLiveToLocal = () => {
    setSplitJsonContent(jsonContent);
    setStatusMessage("📋 Isi editor database disalin ke window preset lokal.");
    setTimeout(() => setStatusMessage(null), 2500);
  };

  // Bandingkan editor dengan isi saat config pertama dimuat (sebelum diedit)
  const handleCompareWithOriginal = () => {
    setSplitJsonContent(originalContent);
    setLocalFileOriginalContent(originalContent);
    setLocalFilePath(null);
    setCompareTenant(null);
    setCompareConfigId(null);
    setSplitSourceType("history");
    setSplitTitle("Versi Awal (sebelum diedit)");
    setSplitMode("diff");
    setIsSplitScreen(true);
  };

  // 9. Load Reference File into Split Pane
  const handleLoadReferenceToSplit = async (refItem: ReferenceItem) => {
    try {
      const res = await api(`/api/references/file?path=${encodeURIComponent(refItem.path)}`);
      const json = await res.json();
      if (json.content) {
        const pretty = JSON.stringify(json.content, null, 2);
        setSplitJsonContent(pretty);
        setLocalFilePath(refItem.path);
        setLocalFileOriginalContent(pretty);
        setCompareTenant(null);
        setCompareConfigId(null);
        setSplitSourceType("preset");
        setSplitTitle(refItem.name);
        setIsSplitScreen(true);
        setShowRefDrawer(false);
      }
    } catch (err) {
      alert("Gagal memuat file referensi");
    }
  };

  // 10. Restore from History
  const handleRestoreHistory = (historyItem: HistoryItem) => {
    if (confirm(`Pulihkan konfigurasi ke Versi ${historyItem.version}?`)) {
      const pretty = JSON.stringify(historyItem.config_value, null, 2);
      setJsonContent(pretty);
      if (historyItem.group_id) {
        setCurrentGroupId(historyItem.group_id);
      }
      setShowHistoryModal(false);
      setStatusMessage(`Direstore ke Versi ${historyItem.version}. Klik 'Save to DB' untuk menerapkan.`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  // 11. Compare with History in Split Pane
  const handleCompareHistory = (historyItem: HistoryItem) => {
    const pretty = JSON.stringify(historyItem.config_value, null, 2);
    setSplitJsonContent(pretty);
    setLocalFilePath(null);
    setCompareTenant(null);
    setCompareConfigId(null);
    setSplitSourceType("history");
    setLocalFileOriginalContent(pretty);
    setSplitTitle(`History v${historyItem.version}`);
    setIsSplitScreen(true);
    setSplitMode("diff");
    setShowHistoryModal(false);
  };

  // 12. Copy Missing Views from Split Pane to Main Editor
  const handleCopyMissingViews = () => {
    try {
      const main = JSON.parse(jsonContent);
      const ref = JSON.parse(splitJsonContent);

      if (!Array.isArray(ref.views) || !Array.isArray(main.views)) {
        alert("Kedua konfigurasi harus memiliki array 'views'");
        return;
      }

      const existingViews = new Set(main.views.map((v: any) => v.view));
      let addedCount = 0;

      ref.views.forEach((v: any) => {
        if (v.view && !existingViews.has(v.view)) {
          main.views.push(v);
          existingViews.add(v.view);
          addedCount++;
        }
      });

      if (addedCount > 0) {
        setJsonContent(JSON.stringify(main, null, 2));
        setCopiedNotification(true);
        setTimeout(() => setCopiedNotification(false), 3000);
      } else {
        alert("Semua views di referensi sudah ada pada konfigurasi aktif.");
      }
    } catch (e: any) {
      alert("Gagal menyalin views: " + e.message);
    }
  };

  // 13. JSON Delta / Structural Diff Calculation (Reactive & Memoized)
  const { deltaResult, deltaJsonString, deltaError } = useMemo(() => {
    try {
      if (!isSplitScreen) {
        return { deltaResult: null, deltaJsonString: "{}", deltaError: null };
      }

      const leftParsed = JSON.parse(jsonContent);
      const rightParsed = JSON.parse(splitJsonContent);

      const leftLabel = splitSourceType === "tenant"
        ? `${selectedTenant?.name || "Tenant Aktif"} (${activeConfigType || "Live"})`
        : `Live DB (${activeConfigType || "Live"})`;

      const rightLabel = splitSourceType === "tenant"
        ? `${compareTenant?.name || "Tenant Pembanding"} (${compareConfigType || "Config"})`
        : splitSourceType === "history" || splitSourceType === "db"
        ? splitTitle
        : `Preset (${splitTitle})`;

      const baselineObj = jsonDeltaDirection === "left-to-right" ? leftParsed : rightParsed;
      const targetObj = jsonDeltaDirection === "left-to-right" ? rightParsed : leftParsed;
      const baselineLabel = jsonDeltaDirection === "left-to-right" ? leftLabel : rightLabel;
      const targetLabel = jsonDeltaDirection === "left-to-right" ? rightLabel : leftLabel;

      const delta = calculateJsonDelta(baselineObj, targetObj, baselineLabel, targetLabel);
      const formatted = formatDeltaOutput(delta, jsonDeltaFormat, 2);

      return { deltaResult: delta, deltaJsonString: formatted, deltaError: null };
    } catch (err: any) {
      return {
        deltaResult: null,
        deltaJsonString: JSON.stringify({
          error: "Gagal memproses perbandingan JSON",
          message: err?.message || String(err),
          hint: "Pastikan kedua window (kiri dan kanan) berisi JSON yang valid tanpa kesalahan sintaks."
        }, null, 2),
        deltaError: err?.message || "Invalid JSON syntax"
      };
    }
  }, [
    isSplitScreen,
    jsonContent,
    splitJsonContent,
    jsonDeltaDirection,
    jsonDeltaFormat,
    splitSourceType,
    selectedTenant,
    activeConfigType,
    compareTenant,
    compareConfigType,
    splitTitle
  ]);

  const handleCopyJsonDelta = () => {
    navigator.clipboard.writeText(deltaJsonString);
    setDeltaCopied(true);
    setTimeout(() => setDeltaCopied(false), 2000);
  };

  const handleDownloadJsonDelta = () => {
    const blob = new Blob([deltaJsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const nameA = (selectedTenant?.name || "live").toLowerCase().replace(/[^a-z0-9]/g, "-");
    const nameB = (compareTenant?.name || splitTitle || "target").toLowerCase().replace(/[^a-z0-9]/g, "-");
    a.download = `delta-${nameA}-vs-${nameB}-${(activeConfigType || "config").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return {
    handleApplyPresetToLive, handleSyncPresetSingleToDb, handleSaveLocalFile, handleFormatMainJson,
    handleFormatLocal, handleRevertLocal, handleCopyLiveToLocal, handleCompareWithOriginal,
    handleLoadReferenceToSplit, handleRestoreHistory, handleCompareHistory, handleCopyMissingViews,
    deltaResult, deltaJsonString, deltaError, handleCopyJsonDelta, handleDownloadJsonDelta
  };
}
