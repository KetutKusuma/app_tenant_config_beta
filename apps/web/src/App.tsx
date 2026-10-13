import { useState, useEffect, useMemo } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { calculateJsonDelta, formatDeltaOutput, DeltaFormat } from "./utils/jsonDiff";
import { 
  Building2, 
  Search, 
  Save, 
  History, 
  CheckCircle2, 
  AlertTriangle, 
  Columns, 
  Layers, 
  FileCode, 
  RotateCcw, 
  RefreshCw, 
  FolderOpen, 
  X, 
  Copy, 
  Check, 
  Plus, 
  Users,
  Edit2,
  FolderSearch,
  FilePlus,
  Download,
  Upload,
  ArrowLeft,
  Zap,
  Database,
  Trash2,
  Braces,
  ChevronDown,
  ChevronUp,
  ArrowLeftRight,
  ChevronRight,
  CircleHelp,
  Workflow,
  GitCompare,
  Sparkles
} from "lucide-react";
import { DocsModal } from "./components/DocsModal";
import { WorkflowDocsModal } from "./components/WorkflowDocsModal";
import { MenuButton, SplitButton, Chip, PromptDialog, ContextMenu, Stepper, type ContextMenuState } from "./components/ui";

interface Tenant {
  tenantId: string;
  groupId: string | null;
  name: string;
  code: string;
  environment: string;
  tags: string[];
  notes: string;
  totalConfigs: number;
}

interface ConfigItem {
  id: string;
  tenant_id: string | null;
  group_id: string | null;
  config_type: string;
  path: string;
  is_default: boolean;
  updated_at: string;
}

interface HistoryItem {
  id: string;
  version: number;
  group_id: string | null;
  config_value: any;
  change_summary: string;
  author_name: string;
  created_at: string;
}

interface ReferenceItem {
  path: string;
  name: string;
  category: string;
}

interface SyncRow {
  configId: string;
  configType: string;
  groupId: string | null;
  dbUpdatedAt: string | null;
  filePath: string | null;
  linkSource: "saved" | "auto" | null;
  status: "identical" | "different" | "no_file" | "file_missing" | "invalid_json";
  pullRequired?: boolean;
  duplicateType?: boolean;
  fileMtime: number | null;
}

interface SyncApplyResult {
  success: boolean;
  direction: "push" | "pull";
  updated: number;
  created: number;
  skipped: number;
  failed: number;
  results: Array<{ configType: string; filePath: string; action: string; error?: string }>;
}

const SYNC_STATUS_BADGE: Record<
  SyncRow["status"],
  { label: string; cls: string }
> = {
  identical: { label: "Sama", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
  different: { label: "Berbeda", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  no_file: { label: "Belum Ada File", cls: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
  file_missing: { label: "File Hilang", cls: "bg-rose-500/10 text-rose-300 border-rose-500/30" },
  invalid_json: { label: "JSON Rusak", cls: "bg-red-500/10 text-red-300 border-red-500/30" }
};

// Domain konfigurasi aktif: menentukan tabel DB yang dipakai BFF (lewat header X-Config-Domain)
type ConfigDomain = "tenant_config" | "workflow_pipeline";
const DOMAIN_LABEL: Record<ConfigDomain, string> = {
  tenant_config: "Tenant Config",
  workflow_pipeline: "Workflow Pipeline"
};
let activeDomain: ConfigDomain = "tenant_config";
const api = (input: string, init: RequestInit = {}) =>
  fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), "X-Config-Domain": activeDomain }
  });

export default function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [activeConfigType, setActiveConfigType] = useState<string>("");
  const [currentGroupId, setCurrentGroupId] = useState<string>("");

  const [jsonContent, setJsonContent] = useState<string>("{}");
  const [originalContent, setOriginalContent] = useState<string>("{}");
  // Versi DB (updated_at) saat config terakhir dimuat; wajib dikirim saat menyimpan (optimistic locking)
  const [configVersion, setConfigVersion] = useState<string | null>(null);
  const [configDomain, setConfigDomain] = useState<ConfigDomain>("tenant_config");
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  // Dialog catatan commit (pengganti window.prompt); resolve(null) = batal
  const [promptDialog, setPromptDialog] = useState<null | {
    title: string;
    description?: string;
    defaultValue: string;
    resolve: (value: string | null) => void;
  }>(null);
  const askSummary = (title: string, defaultValue: string, description?: string) =>
    new Promise<string | null>((resolve) => setPromptDialog({ title, description, defaultValue, resolve }));
  // Snapshot DB terbaru yang sedang dibandingkan (split "db") dan penanda DB sudah lebih baru dari editor
  const [dbSnapshotVersion, setDbSnapshotVersion] = useState<string | null>(null);
  const [isDbNewer, setIsDbNewer] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Split Screen & Comparison State
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [splitMode, setSplitMode] = useState<"side-by-side" | "diff" | "json-delta">("side-by-side");
  const [splitSourceType, setSplitSourceType] = useState<"preset" | "tenant" | "history" | "db">("preset");
  const [splitJsonContent, setSplitJsonContent] = useState<string>("{}");
  const [splitTitle, setSplitTitle] = useState<string>("Reference / Comparison");
  const [localFilePath, setLocalFilePath] = useState<string | null>(null);
  const [localFileOriginalContent, setLocalFileOriginalContent] = useState<string>("{}");
  const [isSavingLocal, setIsSavingLocal] = useState(false);
  const isLocalDirty = Boolean(localFilePath && splitJsonContent !== localFileOriginalContent);

  // Cross-Tenant Comparison State
  const [compareTenant, setCompareTenant] = useState<Tenant | null>(null);
  const [compareConfigId, setCompareConfigId] = useState<string | null>(null);
  const [compareConfigType, setCompareConfigType] = useState<string | null>(null);
  const [compareConfigs, setCompareConfigs] = useState<ConfigItem[]>([]);
  const [compareTenantOriginalContent, setCompareTenantOriginalContent] = useState<string>("{}");
  const [compareConfigVersion, setCompareConfigVersion] = useState<string | null>(null);
  const [isSavingCompareTenant, setIsSavingCompareTenant] = useState(false);
  const isCompareTenantDirty = Boolean(compareTenant && splitJsonContent !== compareTenantOriginalContent);

  // Modal: Cross-Tenant Compare Picker
  const [showCompareTenantModal, setShowCompareTenantModal] = useState(false);
  const [compareModalTenantId, setCompareModalTenantId] = useState<string>("");
  const [compareModalConfigType, setCompareModalConfigType] = useState<string>("");
  const [compareModalMode, setCompareModalMode] = useState<"side-by-side" | "diff" | "json-delta">("side-by-side");

  // JSON Delta State (Structural JSON Diff)
  const [jsonDeltaFormat, setJsonDeltaFormat] = useState<DeltaFormat>("full");
  const [jsonDeltaDirection, setJsonDeltaDirection] = useState<"left-to-right" | "right-to-left">("left-to-right");
  const [deltaCopied, setDeltaCopied] = useState(false);

  // Local References State & Customizable Folder Path
  const [presetDirPath, setPresetDirPath] = useState<string>("/Users/ketutkusuma/Python/test_redis_stream/stable");
  const [presetInputPath, setPresetInputPath] = useState<string>("/Users/ketutkusuma/Python/test_redis_stream/stable");
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [showRefDrawer, setShowRefDrawer] = useState(false);

  // Validation & History State
  const [validationIssues, setValidationIssues] = useState<Array<{ severity: string; message: string; path?: string }>>([]);
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const [histories, setHistories] = useState<HistoryItem[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [copiedTenantId, setCopiedTenantId] = useState<string | null>(null);

  // Modal: Add / Edit Tenant Label
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [isEditingTenant, setIsEditingTenant] = useState(false);
  const [tenantForm, setTenantForm] = useState({
    tenantId: "",
    groupId: "",
    clientName: "",
    clientCode: "",
    tags: "",
    notes: ""
  });

  // Modal: Add New Configuration
  const [showAddConfigModal, setShowAddConfigModal] = useState(false);
  const [newConfigForm, setNewConfigForm] = useState({
    configType: "",
    path: "",
    groupId: "",
    templateSource: "empty" // "empty" | "copy_active" | "preset"
  });

  // Modal: Delete Configuration with Confirmation
  const [showDeleteConfigModal, setShowDeleteConfigModal] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<ConfigItem | null>(null);
  const [deleteInputConfirmation, setDeleteInputConfirmation] = useState("");
  const [isDeletingConfig, setIsDeletingConfig] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal: Save / Export to Local Preset File
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [exportScope, setExportScope] = useState<"single" | "current_tenant" | "all_tenants">("single");
  const [exportSubfolder, setExportSubfolder] = useState<boolean>(false);
  const [presetSaveFilename, setPresetSaveFilename] = useState("");
  const [presetSaveTargetDir, setPresetSaveTargetDir] = useState(presetDirPath);
  const [includeSkillPreset, setIncludeSkillPreset] = useState<boolean>(true);
  const [isExportingSkill, setIsExportingSkill] = useState<boolean>(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [savePresetStatus, setSavePresetStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

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

      // Refresh katalog presets
      await fetchReferences(presetSaveTargetDir);

      setTimeout(() => {
        setShowSavePresetModal(false);
      }, 1500);
    } catch (err: any) {
      setSavePresetStatus({ type: "error", message: err.message });
    } finally {
      setIsSavingPreset(false);
    }
  };

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

  const openSyncCenter = () => {
    setShowSyncTenantModal(true);
    setSyncStep(1);
    setSyncDirection(null);
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
          authorName: "Sync Center"
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal melakukan sinkronisasi");
      setSyncResult(json);
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
    fetchTenants();
    fetchReferences(presetDirPath);
  }, []);

  const fetchTenants = async (selectCode?: string) => {
    try {
      const res = await api("/api/tenants");
      const json = await res.json();
      if (json.data && json.data.length > 0) {
        setTenants(json.data);
        const target = selectCode 
          ? json.data.find((t: Tenant) => t.code === selectCode) 
          : (json.data.find((t: Tenant) => t.code === "IDM") || json.data[0]);
        if (target) {
          selectTenant(target);
        }
      }
    } catch (err) {
      console.error("Gagal mengambil tenant list:", err);
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

  const handleUpdatePresetDir = (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetInputPath.trim()) return;
    fetchReferences(presetInputPath.trim());
    setStatusMessage(`📁 Folder presets diubah ke: ${presetInputPath.trim()}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // 2. Select Tenant & Fetch configs
  const selectTenant = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
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
  const handleSwitchDomain = async (next: ConfigDomain) => {
    if (next === configDomain) return;
    if (jsonContent !== originalContent && !confirm("Ada perubahan yang belum disimpan. Pindah domain dan buang perubahan tersebut?")) return;
    activeDomain = next;
    setConfigDomain(next);
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
    // Muat ulang daftar tenant (jumlah config per domain) dan pertahankan tenant yang sedang dipilih
    await fetchTenants(selectedTenant?.code);
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
        : await askSummary(
            `Simpan ${activeConfigType}`,
            "Update via Tenant Studio",
            `${DOMAIN_LABEL[configDomain]} · ${selectedTenant?.name || ""}. Versi sebelumnya otomatis diarsipkan ke History.`
          );
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
        setStatusMessage(`✅ Metadata ${tenantForm.clientName} berhasil disimpan!`);
        fetchTenants(tenantForm.clientCode);
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

  // 9. Load Reference File into Split Pane
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

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.tenantId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.groupId && t.groupId.toLowerCase().includes(searchQuery.toLowerCase())) ||
    t.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Header: brand · breadcrumb (domain › tenant › config) · aksi */}
      <header className="relative z-30 h-11 border-b border-slate-800 px-3 flex items-center gap-4 bg-slate-900/95 shrink-0 text-xs shadow-[0_4px_12px_-6px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1 rounded bg-indigo-600/20 text-indigo-400 ring-1 ring-inset ring-indigo-500/30">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-slate-200 text-xs tracking-wide">Tenant Studio</span>
          <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-300 font-mono ring-1 ring-inset ring-amber-500/30">DEV</span>
        </div>

        {/* Breadcrumb: selalu menunjukkan apa yang sedang diedit */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 flex-1 text-[11px] whitespace-nowrap overflow-hidden">
          <span className={`shrink-0 font-medium ${configDomain === "workflow_pipeline" ? "text-teal-300" : "text-indigo-300"}`}>
            {DOMAIN_LABEL[configDomain]}
          </span>
          <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
          {selectedTenant ? (() => {
            const isSameGroup = !currentGroupId || currentGroupId === selectedTenant.tenantId;
            const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);
            return (
              <span className="group flex items-center gap-1.5 min-w-0">
                <span className="font-medium text-slate-200 truncate">{selectedTenant.name}</span>
                <button
                  onClick={(e) => copyToClipboard(selectedTenant.tenantId, e)}
                  className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-slate-500 hover:text-slate-200 transition"
                  title={`Copy tenant_id: ${selectedTenant.tenantId}${isSameGroup ? " (sama dengan group_id)" : ""}`}
                >
                  {shortId(selectedTenant.tenantId)}
                  {copiedTenantId === selectedTenant.tenantId ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                </button>
                {!isSameGroup && (
                  <button
                    onClick={(e) => copyToClipboard(currentGroupId, e)}
                    className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-amber-400/80 hover:text-amber-200 transition"
                    title={`group_id berbeda, klik untuk copy: ${currentGroupId}`}
                  >
                    G:{shortId(currentGroupId)}
                    {copiedTenantId === currentGroupId ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                  </button>
                )}
                <button
                  onClick={(e) => openEditTenantModal(selectedTenant, e)}
                  className="shrink-0 p-0.5 rounded text-slate-500 hover:text-indigo-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                  title="Edit Nama / Label Tenant"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </span>
            );
          })() : (
            <span className="text-slate-500">Pilih tenant</span>
          )}
          <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
          <span className={`font-mono truncate ${activeConfigType ? "text-slate-100" : "text-slate-500"}`}>
            {activeConfigType || "Pilih config"}
          </span>
        </nav>

        {/* Aksi: 2 dropdown sekunder, 2 ikon, 1 aksi utama */}
        <div className="flex items-center gap-1 shrink-0">
          <MenuButton
            label="Bandingkan"
            icon={<GitCompare className="w-3.5 h-3.5 text-purple-400" />}
            active={isSplitScreen}
            title="Bandingkan editor dengan sumber lain (Side-by-Side / Visual Diff / JSON Delta)"
            items={[
              {
                key: "tenant",
                label: "Dengan tenant lain…",
                hint: "Config yang sama di tenant berbeda",
                icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
                disabled: !selectedTenant,
                onSelect: openCompareTenantModal
              },
              {
                key: "db",
                label: "Dengan database terbaru",
                hint: "Lihat perubahan orang/proses lain",
                icon: <Database className="w-3.5 h-3.5" />,
                disabled: !selectedConfigId,
                onSelect: handleCompareWithDb
              },
              {
                key: "original",
                label: "Dengan versi awal",
                hint: "Isi sebelum Anda mengedit",
                icon: <RotateCcw className="w-3.5 h-3.5" />,
                disabled: !selectedConfigId,
                onSelect: handleCompareWithOriginal
              },
              {
                key: "preset",
                label: "Dengan preset lokal…",
                hint: "Pilih file dari katalog presets",
                icon: <FolderOpen className="w-3.5 h-3.5" />,
                onSelect: () => setShowRefDrawer(true)
              },
              {
                key: "history",
                label: "Dengan versi History…",
                hint: `${histories.length} versi tersimpan`,
                icon: <History className="w-3.5 h-3.5" />,
                disabled: !selectedConfigId,
                onSelect: () => setShowHistoryModal(true)
              },
              ...(isSplitScreen
                ? (["divider", {
                    key: "close",
                    label: "Tutup perbandingan",
                    icon: <X className="w-3.5 h-3.5" />,
                    onSelect: () => setIsSplitScreen(false)
                  }] as const)
                : [])
            ]}
          />

          <MenuButton
            label="Presets"
            icon={<FolderOpen className="w-3.5 h-3.5 text-amber-400" />}
            title="Katalog, ekspor, dan sinkronisasi preset lokal"
            items={[
              {
                key: "catalog",
                label: "Katalog presets",
                hint: `${references.length} file di folder preset`,
                icon: <FolderSearch className="w-3.5 h-3.5" />,
                onSelect: () => setShowRefDrawer(true)
              },
              {
                key: "export",
                label: "Ekspor preset…",
                hint: "1 config, tenant ini, atau seluruh DB",
                icon: <Download className="w-3.5 h-3.5" />,
                onSelect: openSavePresetModal
              },
              {
                key: "sync",
                label: "Sync Center…",
                hint: "Push / pull file lokal ↔ database",
                icon: <Upload className="w-3.5 h-3.5" />,
                disabled: !selectedTenant,
                onSelect: openSyncCenter
              }
            ]}
          />

          <span className="w-px h-5 bg-slate-800 mx-1" />

          <button
            onClick={() => setShowHistoryModal(!showHistoryModal)}
            disabled={!selectedConfigId}
            className="relative h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/70 transition disabled:opacity-40"
            title={`History (${histories.length} versi)`}
          >
            <History className="w-3.5 h-3.5" />
            {histories.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-slate-700 text-[8px] font-semibold text-slate-200 flex items-center justify-center">
                {histories.length > 99 ? "99+" : histories.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowDocsModal(true)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/70 transition"
            title={configDomain === "workflow_pipeline" ? "Panduan Workflow Pipeline (executor, DTO, ctx)" : "Panduan & dokumentasi Tenant Configuration"}
          >
            <CircleHelp className="w-3.5 h-3.5" />
          </button>

          <span className="w-1" />

          <SplitButton
            label={isSaving ? "Saving..." : "Save"}
            icon={<Save className="w-3.5 h-3.5" />}
            onClick={() => handleSave()}
            disabled={isSaving || !selectedConfigId}
            items={[
              {
                key: "validate",
                label: "Validasi saja",
                hint: "Cek sintaks JSON & guardrail",
                icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                onSelect: () => { handleValidate(); }
              },
              {
                key: "validate-save",
                label: "Validasi lalu simpan",
                hint: "Simpan hanya jika tidak ada error",
                icon: <Sparkles className="w-3.5 h-3.5" />,
                onSelect: handleValidateAndSave
              },
              "divider",
              {
                key: "quick",
                label: "Simpan cepat",
                hint: "Tanpa catatan perubahan",
                icon: <Zap className="w-3.5 h-3.5" />,
                onSelect: () => handleSave(true)
              }
            ]}
          />
        </div>
      </header>

      {/* Notifikasi status: toast di pojok kanan bawah, tidak memakan ruang header */}
      {statusMessage && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-sm px-3 py-2 rounded-lg bg-slate-900 ring-1 ring-slate-700 shadow-xl shadow-black/50 text-[11px] text-slate-200">
          {statusMessage}
        </div>
      )}

      {ctxMenu && <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />}

      {promptDialog && (
        <PromptDialog
          title={promptDialog.title}
          description={promptDialog.description}
          label="Catatan perubahan (commit summary)"
          defaultValue={promptDialog.defaultValue}
          onConfirm={(v) => {
            promptDialog.resolve(v);
            setPromptDialog(null);
          }}
          onCancel={() => {
            promptDialog.resolve(null);
            setPromptDialog(null);
          }}
        />
      )}

      {/* Main Studio Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Tenant Directory */}
        <aside className="w-72 border-r border-slate-800 flex flex-col bg-slate-900/40 shrink-0">
          {/* Domain switch: menentukan isi daftar tenant & config di bawahnya */}
          <div className="p-2 border-b border-slate-800">
            <div role="tablist" aria-label="Domain konfigurasi" className="grid grid-cols-2 gap-0.5 p-0.5 rounded-lg bg-slate-950/80 ring-1 ring-inset ring-slate-800">
              {([
                { key: "tenant_config", icon: <Layers className="w-3.5 h-3.5" />, title: "public.tenant_configurations (ats_db)" },
                { key: "workflow_pipeline", icon: <Workflow className="w-3.5 h-3.5" />, title: "public.pipeline_workflow_configurations (ats_db)" }
              ] as const).map(d => {
                const active = configDomain === d.key;
                return (
                  <button
                    key={d.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleSwitchDomain(d.key)}
                    title={d.title}
                    className={`h-7 rounded-md flex items-center justify-center gap-1.5 text-[11px] font-medium transition ${
                      active
                        ? d.key === "workflow_pipeline"
                          ? "bg-teal-600/90 text-white shadow-sm"
                          : "bg-indigo-600/90 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {d.icon}
                    {DOMAIN_LABEL[d.key]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tenant Search & Header */}
          <div className="p-2 border-b border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Tenants ({filteredTenants.length})</span>
              <button 
                onClick={openAddTenantModal}
                className="flex items-center gap-1 text-[10px] bg-indigo-600 hover:bg-indigo-500 px-1.5 py-0.5 rounded text-white font-medium transition"
              >
                <Plus className="w-3 h-3" /> Tambah Tenant
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari tenant / group ID..." 
                  className="w-full bg-slate-950 border border-slate-800 rounded pl-7 pr-2 py-1 text-[11px] focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button onClick={() => fetchTenants()} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Tenant List */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {filteredTenants.map((t) => {
              const isSelected = selectedTenant?.tenantId === t.tenantId;
              const shortId = t.tenantId.length > 12 ? `${t.tenantId.slice(0, 8)}…${t.tenantId.slice(-4)}` : t.tenantId;
              const tenantMenu = (e: React.MouseEvent) => {
                e.preventDefault();
                setCtxMenu({
                  x: e.clientX,
                  y: e.clientY,
                  title: t.name,
                  items: [
                    { key: "open", label: "Buka tenant", icon: <Building2 className="w-3.5 h-3.5" />, disabled: isSelected, onSelect: () => selectTenant(t) },
                    {
                      key: "compare",
                      label: "Bandingkan dengan tenant aktif",
                      hint: activeConfigType || undefined,
                      icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
                      disabled: isSelected || !selectedConfigId,
                      onSelect: () => handleStartTenantComparison(t.tenantId, activeConfigType || "CANDIDATE_STABLE")
                    },
                    { key: "edit", label: "Edit nama / label…", icon: <Edit2 className="w-3.5 h-3.5" />, onSelect: () => openEditTenantModal(t) },
                    "divider",
                    { key: "copy-id", label: "Copy tenant_id", icon: <Copy className="w-3.5 h-3.5" />, onSelect: () => copyToClipboard(t.tenantId) },
                    ...(t.groupId
                      ? [{ key: "copy-group", label: "Copy group_id", icon: <Users className="w-3.5 h-3.5" />, onSelect: () => copyToClipboard(t.groupId!) }]
                      : [])
                  ]
                });
              };
              return (
                <div 
                  key={t.tenantId}
                  onClick={() => selectTenant(t)}
                  onContextMenu={tenantMenu}
                  className={`group relative w-full text-left px-2.5 py-2 rounded-md transition cursor-pointer ${
                    isSelected 
                      ? "bg-indigo-600/10 ring-1 ring-inset ring-indigo-500/40" 
                      : "hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[11px] font-medium truncate ${isSelected ? "text-indigo-200" : "text-slate-300 group-hover:text-slate-100"}`}>
                      {t.name}
                    </span>
                    <span className="shrink-0 text-[9px] px-1 rounded bg-slate-800 text-slate-400 font-mono">{t.code}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono text-slate-500 min-w-0">
                    <span className="truncate" title={t.tenantId}>{shortId}</span>
                    <span className="text-slate-700">·</span>
                    <span className="shrink-0">{t.totalConfigs} {configDomain === "workflow_pipeline" ? "workflow" : "config"}</span>
                    {t.groupId && t.groupId !== t.tenantId && (
                      <span className="shrink-0 flex items-center gap-0.5 text-amber-400/70" title={`group_id: ${t.groupId}`}>
                        <Users className="w-2.5 h-2.5" /> group
                      </span>
                    )}
                  </div>

                  {/* Aksi kartu: hanya muncul saat hover / fokus agar sidebar tetap tenang */}
                  <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-slate-900/95 ring-1 ring-slate-700/70 shadow-lg px-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                    {!isSelected && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartTenantComparison(t.tenantId, activeConfigType || "CANDIDATE_STABLE");
                        }}
                        disabled={!selectedConfigId}
                        className="p-1 rounded text-slate-400 hover:text-purple-300 hover:bg-slate-800 transition disabled:opacity-30"
                        title={`Bandingkan ${activeConfigType || "config"} dengan ${t.name}`}
                      >
                        <ArrowLeftRight className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => copyToClipboard(t.tenantId, e)}
                      className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
                      title={`Copy tenant_id: ${t.tenantId}`}
                    >
                      {copiedTenantId === t.tenantId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={(e) => openEditTenantModal(t, e)}
                      className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
                      title="Edit nama/label tenant"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Config Types List with "+ Tambah Config" Button */}
          <div className="border-t border-slate-800 p-2 max-h-56 overflow-y-auto bg-slate-950/70">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {configDomain === "workflow_pipeline" ? "Workflow" : "Konfigurasi"} ({configs.length})
              </span>
              <button 
                onClick={() => {
                  if (!selectedTenant) {
                    alert("Pilih tenant terlebih dahulu!");
                    return;
                  }
                  setShowAddConfigModal(true);
                }}
                className="flex items-center gap-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 px-1.5 py-0.5 rounded border border-slate-700 transition"
                title="Tambah Konfigurasi Baru untuk Tenant Ini"
              >
                <FilePlus className="w-3 h-3" /> Tambah Config
              </button>
            </div>
            <div className="space-y-0.5">
              {configs.map((c) => {
                const isConfigActive = selectedConfigId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => loadConfig(c.id, c.config_type, c.group_id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        title: c.config_type,
                        items: [
                          { key: "open", label: "Buka", icon: <FileCode className="w-3.5 h-3.5" />, disabled: isConfigActive, onSelect: () => loadConfig(c.id, c.config_type, c.group_id) },
                          { key: "db", label: "Bandingkan dengan DB terbaru", icon: <Database className="w-3.5 h-3.5" />, disabled: !isConfigActive, hint: isConfigActive ? undefined : "buka dulu", onSelect: handleCompareWithDb },
                          { key: "tenant", label: "Bandingkan dengan tenant lain…", icon: <ArrowLeftRight className="w-3.5 h-3.5" />, disabled: !isConfigActive, hint: isConfigActive ? undefined : "buka dulu", onSelect: openCompareTenantModal },
                          { key: "export", label: "Ekspor sebagai preset…", icon: <Download className="w-3.5 h-3.5" />, disabled: !isConfigActive, hint: isConfigActive ? undefined : "buka dulu", onSelect: openSavePresetModal },
                          "divider",
                          { key: "copy-type", label: "Copy nama config", icon: <Copy className="w-3.5 h-3.5" />, onSelect: () => copyToClipboard(c.config_type) },
                          { key: "copy-id", label: "Copy ID", icon: <Copy className="w-3.5 h-3.5" />, onSelect: () => copyToClipboard(c.id) },
                          "divider",
                          { key: "delete", label: "Hapus…", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onSelect: () => openDeleteConfigModal(c) }
                        ]
                      });
                    }}
                    className={`w-full group text-left px-2 py-1 rounded text-[11px] flex items-center justify-between transition cursor-pointer ${
                      isConfigActive
                        ? "bg-slate-800 text-white font-medium border border-slate-700"
                        : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {configDomain === "workflow_pipeline"
                        ? <Workflow className="w-3 h-3 text-teal-400 shrink-0" />
                        : <FileCode className="w-3 h-3 text-indigo-400 shrink-0" />}
                      <span className="truncate">{c.config_type || "UNNAMED_CONFIG"}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      {c.is_default && (
                        <span className="text-[8px] bg-slate-700 px-1 py-0.2 rounded text-slate-300">DEF</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDeleteConfigModal(c);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded transition shrink-0"
                        title={`Hapus konfigurasi ${c.config_type}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Center Workspace (Primary Editor + Optional Split Pane) */}
        <main className="flex-1 flex flex-col bg-slate-950 min-w-0 min-h-0 overflow-hidden">
          {/* Toolbar editor: identitas config + status (chips) di kiri, aksi ikon di kanan */}
          <div className="h-9 border-b border-slate-800 px-3 flex items-center justify-between gap-3 bg-slate-900/40 text-xs shrink-0 whitespace-nowrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[11px] font-medium text-slate-100 truncate">
                {activeConfigType || "Belum ada config dipilih"}
              </span>

              {/* Group ID Input (Optional) */}
              <label className="flex items-center gap-1 h-6 px-2 rounded-md bg-slate-950/60 ring-1 ring-inset ring-slate-800 focus-within:ring-indigo-500/60 text-[10px] shrink-0">
                <span className="text-slate-500">group_id</span>
                <input 
                  type="text" 
                  value={currentGroupId}
                  onChange={(e) => setCurrentGroupId(e.target.value)}
                  placeholder="opsional"
                  className="bg-transparent text-amber-300 font-mono text-[10px] focus:outline-none w-32"
                />
              </label>

              {jsonContent !== originalContent && <Chip tone="amber">Modified</Chip>}
              {isDbNewer && (
                <Chip
                  tone="rose"
                  onClick={handleCompareWithDb}
                  title="Database sudah diubah (oleh orang/proses lain) sejak config ini dimuat. Klik untuk melihat perbedaannya."
                >
                  <AlertTriangle className="w-2.5 h-2.5" /> DB lebih baru
                </Chip>
              )}
              {validationIssues.length > 0 && (() => {
                const errors = validationIssues.filter(i => i.severity === "error").length;
                const warnings = validationIssues.filter(i => i.severity === "warning").length;
                return (
                  <Chip
                    tone={errors ? "rose" : warnings ? "amber" : "emerald"}
                    onClick={() => setShowValidationPanel(!showValidationPanel)}
                    title={showValidationPanel ? "Sembunyikan panel validasi" : "Buka hasil validasi"}
                  >
                    {errors ? <AlertTriangle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                    {errors || warnings ? `${errors} error · ${warnings} warning` : "Valid"}
                    {showValidationPanel ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronUp className="w-2.5 h-2.5" />}
                  </Chip>
                );
              })()}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {isSplitScreen && (
                <div className="flex items-center gap-0.5 p-0.5 mr-2 rounded-md bg-slate-950/60 ring-1 ring-inset ring-slate-800">
                  {([
                    { key: "side-by-side", label: "Side-by-Side" },
                    { key: "diff", label: "Visual Diff" },
                    { key: "json-delta", label: "JSON Delta" }
                  ] as const).map(m => (
                    <button
                      key={m.key}
                      onClick={() => setSplitMode(m.key)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                        splitMode === m.key ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              {([
                { key: "format", icon: <Braces className="w-3.5 h-3.5" />, title: "Format JSON (indent 2 spasi)", onClick: handleFormatMainJson },
                { key: "validate", icon: <CheckCircle2 className="w-3.5 h-3.5" />, title: "Validasi sintaks & guardrail", onClick: () => { handleValidate(); } },
                { key: "reset", icon: <RotateCcw className="w-3.5 h-3.5" />, title: "Reset ke isi awal (buang edit)", onClick: () => setJsonContent(originalContent) },
                { key: "reload", icon: <RefreshCw className="w-3.5 h-3.5" />, title: "Muat ulang dari database", onClick: handleReloadFromDb }
              ]).map(b => (
                <button
                  key={b.key}
                  onClick={b.onClick}
                  disabled={!selectedConfigId}
                  className="h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/70 transition disabled:opacity-30"
                  title={b.title}
                >
                  {b.icon}
                </button>
              ))}

              {selectedConfigId && (
                <>
                  <span className="w-px h-4 bg-slate-800 mx-1" />
                  <button
                    type="button"
                    onClick={() => {
                      const currentCfg = configs.find(c => c.id === selectedConfigId);
                      if (currentCfg) openDeleteConfigModal(currentCfg);
                    }}
                    className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition"
                    title={`Hapus konfigurasi aktif (${activeConfigType})`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Editor Area */}
          <div className="flex-1 relative flex min-h-0 overflow-hidden">
            {isLoadingConfig ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-10 text-xs text-slate-400">
                Memuat konfigurasi...
              </div>
            ) : isSplitScreen ? (
              splitMode === "diff" ? (
                /* Monaco Diff Editor */
                <div className="w-full h-full flex flex-col">
                  <div className="relative z-10 h-9 shrink-0 bg-slate-900 border-b border-slate-800/80 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] px-3 flex items-center justify-between gap-4 text-[11px] whitespace-nowrap">
                    {/* Kiri vs Kanan: label ringkas, detail di tooltip */}
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                      {splitSourceType === "tenant" ? (
                        <span
                          className="flex items-center gap-1.5 min-w-0"
                          title={`Tenant Pembanding (Kiri): ${compareTenant?.name || splitTitle} — ${compareConfigType}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                          <span className="font-medium text-purple-200 truncate">{compareTenant?.name || splitTitle}</span>
                          <span className="font-mono text-[10px] text-slate-500 truncate">{compareConfigType}</span>
                        </span>
                      ) : (
                        <span
                          className="flex items-center gap-1.5 min-w-0"
                          title={`${splitSourceType === "preset" ? "Preset Lokal" : "Snapshot"} (Kiri): ${splitTitle}`}
                        >
                          {splitSourceType === "preset" ? (
                            <FolderOpen className="w-3 h-3 text-amber-400 shrink-0" />
                          ) : (
                            <History className="w-3 h-3 text-emerald-400 shrink-0" />
                          )}
                          <span className={`font-medium truncate ${splitSourceType === "preset" ? "text-amber-200" : "text-emerald-200"}`}>{splitTitle}</span>
                        </span>
                      )}
                      <span className="text-slate-600 text-[10px] shrink-0">vs</span>
                      <span
                        className="flex items-center gap-1.5 min-w-0"
                        title={splitSourceType === "tenant"
                          ? `Tenant Aktif (Kanan): ${selectedTenant?.name} — ${activeConfigType}`
                          : `${splitSourceType === "preset" ? "Database Live" : "Editor Anda"} (Kanan): ${activeConfigType}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                        <span className="font-medium text-indigo-200 truncate">
                          {splitSourceType === "tenant" ? selectedTenant?.name : splitSourceType === "preset" ? "Database Live" : "Editor Anda"}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 truncate">{activeConfigType}</span>
                      </span>
                    </div>

                    {/* Aksi: satu tombol utama, sisanya ghost / icon-only */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={
                          splitSourceType === "tenant" ? handleApplyCompareToLive
                          : splitSourceType === "db" ? handleApplyDbSnapshot
                          : handleApplyPresetToLive
                        }
                        className="h-6 px-2.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-medium flex items-center gap-1.5 shadow-sm shadow-cyan-950/50 transition"
                        title={splitSourceType === "tenant"
                          ? "Terapkan isi tenant pembanding ke tenant aktif (sebelah kanan)"
                          : splitSourceType === "db"
                          ? "Ganti isi editor dengan versi database terbaru (sebelah kiri)"
                          : "Terapkan isi file preset ini ke konfigurasi database live (sebelah kanan)"}
                      >
                        <ArrowLeft className="w-3 h-3" /> {splitSourceType === "db" ? "Pakai Versi DB" : "Terapkan ke Live"}
                      </button>
                      {splitSourceType === "tenant" ? (
                        <>
                          <button
                            onClick={handleCopyMissingViews}
                            className="h-6 px-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 text-[11px] flex items-center gap-1.5 transition"
                            title="Salin views yang belum ada dari tenant pembanding ke tenant aktif"
                          >
                            <Copy className="w-3 h-3" /> Missing Views
                          </button>
                          <button
                            onClick={handleSwapTenants}
                            className="h-6 w-6 rounded-md text-slate-400 hover:text-indigo-300 hover:bg-slate-800 flex items-center justify-center transition"
                            title="Tukar posisi tenant (kiri <-> kanan)"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : splitSourceType === "preset" && (
                        <button
                          onClick={handleSyncPresetSingleToDb}
                          className="h-6 px-2 rounded-md text-emerald-300 hover:text-emerald-200 hover:bg-slate-800 text-[11px] flex items-center gap-1.5 transition"
                          title="Langsung sinkronkan file preset ini ke database untuk config aktif (+ rekam history)"
                        >
                          <Zap className="w-3 h-3" /> Sync ke DB
                        </button>
                      )}
                      <span className="w-px h-4 bg-slate-700/70 mx-1" />
                      <button
                        onClick={() => setIsSplitScreen(false)}
                        className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                        title="Tutup split perbandingan"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0">
                    <DiffEditor
                      height="100%"
                      language="json"
                      theme="vs-dark"
                      original={splitJsonContent}
                      modified={jsonContent}
                      options={{
                        fontSize: 13,
                        minimap: { enabled: false },
                        renderSideBySide: true,
                        readOnly: false
                      }}
                    />
                  </div>
                </div>
              ) : splitMode === "json-delta" ? (
                /* JSON Delta Inspector */
                <div className="w-full h-full flex flex-col min-h-0 overflow-hidden bg-slate-950">
                  {/* Top Bar for JSON Delta — baris 1: arah + aksi, baris 2: format + statistik */}
                  {(() => {
                    const liveLabel = splitSourceType === "tenant" ? `${selectedTenant?.name || "Tenant Aktif"}` : "Live DB";
                    const compareLabel = compareTenant?.name || splitTitle;
                    const baselineLabel = jsonDeltaDirection === "left-to-right" ? liveLabel : compareLabel;
                    const targetLabel = jsonDeltaDirection === "left-to-right" ? compareLabel : liveLabel;
                    const formats: { key: typeof jsonDeltaFormat; label: string; title: string }[] = [
                      { key: "full", label: "Full", title: "Lengkap: metadata, rangkuman, analisis views, selisih path, dan patch" },
                      { key: "compact", label: "Compact", title: "Ringkas: hanya objek added, removed, dan modified" },
                      { key: "patch", label: "RFC 6902", title: "Array spesifikasi standar RFC 6902 JSON Patch" },
                      { key: "views", label: "Views", title: "Khusus analisis perbedaan array Views Tenant ATS" }
                    ];
                    return (
                      <div className="relative z-10 shrink-0 bg-slate-900 border-b border-slate-800/80 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] text-[11px] whitespace-nowrap">
                        <div className="h-9 px-3 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 min-w-0 overflow-hidden" title={`Baseline: ${baselineLabel} → Target: ${targetLabel} (${activeConfigType})`}>
                            <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                            <span className="text-slate-500 shrink-0">Baseline</span>
                            <span className="font-medium text-slate-200 truncate">{baselineLabel}</span>
                            <span className="text-cyan-400 shrink-0">→</span>
                            <span className="text-slate-500 shrink-0">Target</span>
                            <span className="font-medium text-cyan-300 truncate">{targetLabel}</span>
                            <span className="font-mono text-[10px] text-slate-500 truncate">{activeConfigType}</span>
                            <button
                              onClick={() => setJsonDeltaDirection(prev => prev === "left-to-right" ? "right-to-left" : "left-to-right")}
                              className="h-6 w-6 shrink-0 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 flex items-center justify-center transition"
                              title="Tukar arah baseline dan target pembanding"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={handleCopyJsonDelta}
                              className="h-6 px-2.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-medium flex items-center gap-1.5 shadow-sm shadow-cyan-950/50 transition"
                              title="Salin hasil JSON delta ke clipboard"
                            >
                              {deltaCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              {deltaCopied ? "Tersalin!" : "Salin JSON"}
                            </button>
                            <button
                              onClick={handleDownloadJsonDelta}
                              className="h-6 px-2 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 text-[11px] flex items-center gap-1.5 transition"
                              title="Unduh dokumen perbedaan sebagai file .json"
                            >
                              <Download className="w-3 h-3" /> Unduh
                            </button>
                            <span className="w-px h-4 bg-slate-700/70 mx-1" />
                            <button
                              onClick={() => setIsSplitScreen(false)}
                              className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                              title="Tutup perbandingan"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="h-8 px-3 flex items-center justify-between gap-4 border-t border-slate-800/60">
                          <div className="flex items-center gap-0.5 bg-slate-950/60 p-0.5 rounded-md shrink-0">
                            {formats.map(f => (
                              <button
                                key={f.key}
                                onClick={() => setJsonDeltaFormat(f.key)}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                                  jsonDeltaFormat === f.key ? "bg-slate-700 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                                }`}
                                title={f.title}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>

                          {deltaResult && (
                            <div className="flex items-center gap-3 min-w-0 overflow-hidden text-[10px] font-mono">
                              <span className="text-emerald-400" title="Ditambahkan">+{deltaResult.summary.addedCount}</span>
                              <span className="text-rose-400" title="Dihapus">−{deltaResult.summary.removedCount}</span>
                              <span className="text-amber-400" title="Diubah">~{deltaResult.summary.modifiedCount}</span>
                              {deltaResult.summary.viewsDiff && (
                                <>
                                  <span className="w-px h-3 bg-slate-700/70" />
                                  <span className="text-purple-300 truncate" title="Perbedaan pada views array (hanya di baseline / hanya di target / diubah)">
                                    {deltaResult.summary.viewsDiff.onlyInBaseline + deltaResult.summary.viewsDiff.onlyInTarget + deltaResult.summary.viewsDiff.modifiedViews} views berbeda
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Warning banner if JSON parsing failed */}
                  {deltaError && (
                    <div className="bg-rose-950/40 border-b border-rose-500/30 px-3 py-1 flex items-center gap-2 text-[11px] text-rose-300">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span>Syntax Error pada salah satu konfigurasi: {deltaError}. Perbaiki format JSON untuk menampilkan perbedaan.</span>
                    </div>
                  )}

                  {/* Monaco Editor showing the Delta JSON */}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <Editor
                      height="100%"
                      defaultLanguage="json"
                      theme="vs-dark"
                      value={deltaJsonString}
                      options={{
                        readOnly: true,
                        minimap: { enabled: true },
                        fontSize: 13,
                        wordWrap: "on",
                        automaticLayout: true,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false
                      }}
                    />
                  </div>
                </div>
              ) : (
                /* Two Monaco Editors Side by Side */
                <div className="w-full h-full flex min-h-0 overflow-hidden">
                  {/* Left: Window Database Live (ats_db) */}
                  <div className="flex-1 flex flex-col border-r-2 border-indigo-500/40 min-h-0 overflow-hidden">
                    <div className="relative z-10 h-8 shrink-0 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] whitespace-nowrap bg-indigo-950/40 border-b border-indigo-500/30 px-3 flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-2">
                        <Database className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="font-semibold text-indigo-200">Window Database (Live)</span>
                        <span className="bg-indigo-600/30 text-indigo-300 px-1.5 py-0.2 rounded font-mono text-[9px] border border-indigo-500/40">
                          {activeConfigType || "No Config"}
                        </span>
                        {jsonContent !== originalContent && (
                          <span className="bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded font-mono text-[9px]">
                            Modified
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {copiedNotification && (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1 mr-1">
                            <Check className="w-2.5 h-2.5" /> Views Disalin!
                          </span>
                        )}
                        <button
                          onClick={() => setSplitMode("json-delta")}
                          className="px-1.5 py-0.2 rounded bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/60 border border-cyan-500/30 text-[10px] flex items-center gap-1 transition"
                          title="Lihat perbedaan kedua window dalam dokumen JSON terstruktur"
                        >
                          <FileCode className="w-2.5 h-2.5 text-cyan-400" /> JSON Delta
                        </button>
                        <button
                          onClick={handleFormatMainJson}
                          className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] flex items-center gap-1 transition"
                          title="Rapikan format JSON database live (indent 2 spasi)"
                        >
                          <Braces className="w-2.5 h-2.5 text-cyan-400" /> Format
                        </button>
                        <button
                          onClick={() => handleSave()}
                          disabled={isSaving || !selectedConfigId}
                          className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium flex items-center gap-1 shadow-sm transition disabled:opacity-40"
                          title="Simpan perubahan langsung ke database"
                        >
                          <Save className="w-2.5 h-2.5" />
                          {isSaving ? "Saving..." : "Save to DB"}
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <Editor
                        height="100%"
                        defaultLanguage="json"
                        theme="vs-dark"
                        value={jsonContent}
                        onChange={(val) => setJsonContent(val || "")}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          wordWrap: "on",
                          formatOnPaste: true,
                          automaticLayout: true
                        }}
                      />
                    </div>
                  </div>

                  {/* Right: Window Either Cross-Tenant (Live DB) OR Local Preset (File Disk) */}
                  <div className="flex-1 flex flex-col bg-slate-950 min-h-0 overflow-hidden">
                    {splitSourceType === "tenant" ? (
                      /* Header for Cross-Tenant Comparison */
                      <div className="relative z-10 h-8 shrink-0 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] whitespace-nowrap bg-purple-950/30 border-b border-purple-500/30 px-3 flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ArrowLeftRight className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <span className="font-semibold text-purple-200 shrink-0">Tenant Pembanding:</span>
                          <select
                            value={compareTenant?.tenantId || ""}
                            onChange={(e) => handleSwitchCompareTenant(e.target.value)}
                            className="bg-slate-900 border border-purple-500/40 rounded px-1.5 py-0.2 text-purple-300 font-medium text-[10px] focus:outline-none max-w-[130px] truncate"
                            title="Ganti tenant pembanding"
                          >
                            {tenants.map(t => (
                              <option key={t.tenantId} value={t.tenantId}>
                                {t.name} ({t.code})
                              </option>
                            ))}
                          </select>
                          <select
                            value={compareConfigId || ""}
                            onChange={(e) => handleSwitchCompareConfig(e.target.value)}
                            className="bg-slate-900 border border-purple-500/40 rounded px-1.5 py-0.2 text-purple-300 font-mono text-[9px] focus:outline-none max-w-[140px] truncate"
                            title="Ganti jenis konfigurasi"
                          >
                            {compareConfigs.map(c => (
                              <option key={c.id} value={c.id}>
                                {c.config_type} {c.is_default ? "[DEF]" : ""}
                              </option>
                            ))}
                          </select>
                          {isCompareTenantDirty && (
                            <span className="bg-rose-500/20 text-rose-300 px-1 py-0.2 rounded font-mono text-[9px] shrink-0" title="Ada perubahan pada window ini">
                              Modified
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto">
                          <button
                            onClick={handleSaveCompareTenant}
                            disabled={!compareConfigId || !isCompareTenantDirty || isSavingCompareTenant}
                            className="px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-medium flex items-center gap-1 shadow-sm transition disabled:opacity-40"
                            title={`Simpan perubahan langsung ke database tenant ${compareTenant?.name}`}
                          >
                            <Save className="w-2.5 h-2.5" />
                            {isSavingCompareTenant ? "Menyimpan..." : "Save to Tenant"}
                          </button>
                          <button
                            onClick={handleFormatCompareTenant}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px]"
                            title="Rapikan format JSON (indent 2 spasi)"
                          >
                            {"{ }"}
                          </button>
                          <button
                            onClick={handleRevertCompareTenant}
                            disabled={!isCompareTenantDirty}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] flex items-center disabled:opacity-30"
                            title="Batalkan perubahan ke isi awal tenant ini"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                          </button>
                          <span className="w-px h-4 bg-slate-700" />
                          <button
                            onClick={handleApplyCompareToLive}
                            className="px-2 py-0.5 rounded bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/40 border border-cyan-500/40 text-[10px] flex items-center gap-1 transition"
                            title="Terapkan isi window tenant ini ke editor live sebelah kiri"
                          >
                            <ArrowLeft className="w-2.5 h-2.5" /> Terapkan ke Live
                          </button>
                          <button
                            onClick={handleCopyMissingViews}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] flex items-center gap-1"
                            title="Salin views yang ada di tenant ini tetapi belum ada di tenant aktif"
                          >
                            <Copy className="w-2.5 h-2.5" /> Missing Views
                          </button>
                          <button
                            onClick={handleSwapTenants}
                            className="px-2 py-0.5 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 border border-indigo-500/40 text-[10px] flex items-center gap-1 font-medium transition"
                            title="Tukar posisi tenant (kiri <-> kanan)"
                          >
                            <ArrowLeftRight className="w-2.5 h-2.5 text-indigo-400" /> Swap
                          </button>
                          <button
                            onClick={() => {
                              if (isCompareTenantDirty && !confirm("Window tenant pembanding punya perubahan yang belum disimpan. Tutup split screen?")) return;
                              setIsSplitScreen(false);
                            }}
                            className="text-slate-400 hover:text-slate-200 p-0.5"
                            title="Tutup split perbandingan"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ) : splitSourceType === "db" || splitSourceType === "history" ? (
                      /* Header for read-only snapshot (DB terbaru / History) */
                      <div className="relative z-10 h-8 shrink-0 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] whitespace-nowrap bg-emerald-950/30 border-b border-emerald-500/30 px-3 flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <History className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="font-semibold text-emerald-200 truncate">{splitTitle}</span>
                          <span className="text-slate-500 shrink-0">snapshot, tidak disimpan</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={splitSourceType === "db" ? handleApplyDbSnapshot : handleApplyPresetToLive}
                            className="px-2 py-0.5 rounded bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/40 border border-cyan-500/40 text-[10px] flex items-center gap-1 transition"
                            title="Ganti isi editor dengan snapshot ini"
                          >
                            <ArrowLeft className="w-2.5 h-2.5" /> {splitSourceType === "db" ? "Pakai Versi DB" : "Terapkan ke Live"}
                          </button>
                          {splitSourceType === "db" && (
                            <button
                              onClick={handleCompareWithDb}
                              className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] flex items-center"
                              title="Ambil ulang versi terbaru dari database"
                            >
                              <RefreshCw className="w-2.5 h-2.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setIsSplitScreen(false)}
                            className="text-slate-400 hover:text-slate-200 p-0.5"
                            title="Tutup split"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Header for Local Preset */
                      <div className="relative z-10 h-8 shrink-0 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] whitespace-nowrap bg-amber-950/30 border-b border-amber-500/30 px-3 flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="font-semibold text-amber-200 shrink-0">Window Preset Lokal:</span>
                          <span className="font-mono text-amber-300 truncate max-w-[170px] bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20 text-[9px]" title={localFilePath || splitTitle}>
                            {splitTitle}
                          </span>
                          {isLocalDirty && (
                            <span className="bg-rose-500/20 text-rose-300 px-1 py-0.2 rounded font-mono text-[9px] shrink-0" title="Ada perubahan yang belum disimpan ke file">
                              Belum disimpan
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto">
                          <button
                            onClick={handleSaveLocalFile}
                            disabled={!localFilePath || !isLocalDirty || isSavingLocal}
                            className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-medium flex items-center gap-1 shadow-sm transition disabled:opacity-40"
                            title={localFilePath ? `Simpan ke ${localFilePath} (versi lama jadi .bak)` : "Buka file dari katalog Presets untuk mengedit file lokal"}
                          >
                            <Save className="w-2.5 h-2.5" />
                            {isSavingLocal ? "Menyimpan..." : "Simpan File"}
                          </button>
                          <button
                            onClick={handleFormatLocal}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px]"
                            title="Rapikan format JSON (indent 2 spasi)"
                          >
                            {"{ }"}
                          </button>
                          <button
                            onClick={handleRevertLocal}
                            disabled={!isLocalDirty}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] flex items-center disabled:opacity-30"
                            title="Batalkan perubahan, kembali ke isi file terakhir"
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={handleCopyLiveToLocal}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] flex items-center"
                            title="Salin isi window Database ke window lokal (belum menyimpan file)"
                          >
                            <Download className="w-2.5 h-2.5" />
                          </button>
                          <span className="w-px h-4 bg-slate-700" />
                          <button
                            onClick={handleApplyPresetToLive}
                            className="px-2 py-0.5 rounded bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/40 border border-cyan-500/40 text-[10px] flex items-center gap-1 transition"
                            title="Terapkan isi window lokal ke editor database live (sebelah kiri) untuk di-review"
                          >
                            <ArrowLeft className="w-2.5 h-2.5" /> Terapkan ke Live
                          </button>
                          <button
                            onClick={handleSyncPresetSingleToDb}
                            className="px-2 py-0.5 rounded bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 border border-emerald-500/40 text-[10px] flex items-center gap-1 font-semibold transition"
                            title="Kirim isi window lokal ke database untuk config aktif (+ catat history)"
                          >
                            <Zap className="w-2.5 h-2.5 text-emerald-400" /> Sync ke DB
                          </button>
                          <button
                            onClick={handleCopyMissingViews}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 text-[10px] flex items-center gap-1"
                            title="Salin views yang belum ada dari preset ke editor"
                          >
                            <Copy className="w-2.5 h-2.5" /> Missing Views
                          </button>
                          <button
                            onClick={() => {
                              if (isLocalDirty && !confirm("Window lokal punya perubahan yang belum disimpan ke file. Tutup dan buang perubahan?")) return;
                              setIsSplitScreen(false);
                            }}
                            className="text-slate-400 hover:text-slate-200 p-0.5"
                            title="Tutup window preset"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <Editor
                        height="100%"
                        defaultLanguage="json"
                        theme="vs-dark"
                        value={splitJsonContent}
                        onChange={(val) => setSplitJsonContent(val || "")}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          wordWrap: "on",
                          formatOnPaste: true,
                          automaticLayout: true
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* Single Monaco Editor */
              <div className="flex-1 w-full h-full min-h-0 overflow-hidden">
                <Editor
                  height="100%"
                  defaultLanguage="json"
                  theme="vs-dark"
                  value={jsonContent}
                  onChange={(val) => setJsonContent(val || "")}
                  options={{
                    minimap: { enabled: true },
                    fontSize: 13,
                    wordWrap: "on",
                    formatOnPaste: true,
                    automaticLayout: true
                  }}
                />
              </div>
            )}
          </div>

          {/* Validation & Linter Inspector Bottom Panel */}
          {showValidationPanel && validationIssues.length > 0 && (
            <div className="border-t-2 border-slate-700 bg-slate-900/95 text-xs flex flex-col max-h-56 shrink-0 shadow-2xl backdrop-blur z-20">
              <div className="px-3 py-2 bg-slate-800/80 border-b border-slate-700/60 flex items-center justify-between text-xs shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" /> Hasil Linter & Guardrails
                  </span>
                  <div className="flex items-center gap-1">
                    {validationIssues.filter(i => i.severity === "error").length > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-medium flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
                        {validationIssues.filter(i => i.severity === "error").length} Error
                      </span>
                    )}
                    {validationIssues.filter(i => i.severity === "warning").length > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-medium flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                        {validationIssues.filter(i => i.severity === "warning").length} Peringatan
                      </span>
                    )}
                    {validationIssues.every(i => i.severity === "success") && (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium flex items-center gap-1">
                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                        Semua Valid
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowValidationPanel(false)}
                    className="text-slate-400 hover:text-slate-200 p-0.5 rounded hover:bg-slate-700/50"
                    title="Tutup panel validasi"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="p-2 space-y-1.5 overflow-y-auto max-h-44">
                {validationIssues.map((issue, idx) => (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-2 p-2 rounded text-[11px] ${
                      issue.severity === "error" 
                        ? "bg-rose-950/30 text-rose-200 border border-rose-500/30" 
                        : issue.severity === "warning"
                        ? "bg-amber-950/30 text-amber-200 border border-amber-500/30"
                        : "bg-emerald-950/30 text-emerald-200 border border-emerald-500/30"
                    }`}
                  >
                    {issue.severity === "error" ? (
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-mono text-[9px] font-bold shrink-0 mt-0.5">
                        ERROR
                      </span>
                    ) : issue.severity === "warning" ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[9px] font-bold shrink-0 mt-0.5">
                        WARN
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[9px] font-bold shrink-0 mt-0.5">
                        VALID
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      {issue.path && (
                        <div className="font-mono text-[10px] text-slate-400 font-semibold mb-0.5 flex items-center gap-1">
                          <span className="text-slate-500">Path:</span>
                          <span className="bg-slate-800/80 px-1 py-0.2 rounded text-indigo-300">{issue.path}</span>
                        </div>
                      )}
                      <div className="leading-relaxed">{issue.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Local References Drawer with Customizable Path */}
        {showRefDrawer && (
          <aside className="w-80 border-l border-slate-800 flex flex-col bg-slate-900/90 backdrop-blur shrink-0">
            <div className="p-2.5 border-b border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                  Local Presets Katalog
                </span>
                <button onClick={() => setShowRefDrawer(false)} className="text-slate-400 hover:text-slate-200">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Form Ganti Path Folder Preset */}
              <form onSubmit={handleUpdatePresetDir} className="space-y-1">
                <label className="text-[10px] text-slate-400 block">Path Folder Preset:</label>
                <div className="flex items-center gap-1">
                  <input 
                    type="text" 
                    value={presetInputPath}
                    onChange={(e) => setPresetInputPath(e.target.value)}
                    placeholder="Masukkan path folder..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                  <button 
                    type="submit"
                    className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                    title="Muat Folder"
                  >
                    <FolderSearch className="w-3 h-3" />
                  </button>
                </div>
              </form>

              <div className="grid grid-cols-2 gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={openSavePresetModal}
                  className="flex items-center justify-center gap-1 py-1 px-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded text-[10px] font-medium transition"
                  title="Ekspor preset lokal & skill tenant_config"
                >
                  <Download className="w-3 h-3 text-cyan-400" />
                  <span>Ekspor Preset</span>
                </button>
                <button
                  type="button"
                  onClick={openSyncCenter}
                  disabled={!selectedTenant}
                  className="flex items-center justify-center gap-1 py-1 px-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded text-[10px] font-medium transition disabled:opacity-40"
                  title="Sinkronisasi seluruh konfigurasi tenant ini dari folder presets ke database"
                >
                  <Upload className="w-3 h-3 text-emerald-400" />
                  <span>Sync ke DB</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportSkillOnly}
                  disabled={isExportingSkill}
                  className="col-span-2 flex items-center justify-center gap-1 py-1 px-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[10px] font-medium transition disabled:opacity-40"
                  title="Salin/update file SKILL.md tenant-configuration ke folder preset ini untuk AI Agent"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>{isExportingSkill ? "Mengekspor Skill..." : "Ekspor Skill tenant_config Saja"}</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {references.length === 0 ? (
                <p className="text-xs text-slate-500 p-2">Tidak ditemukan file .json.</p>
              ) : (
                references.map((ref, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleLoadReferenceToSplit(ref)}
                    className="w-full text-left p-1.5 rounded hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50 transition flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-200 truncate">{ref.name}</span>
                      <span className="text-[8px] bg-slate-800 px-1 py-0.2 rounded text-amber-300 font-mono">
                        {ref.category}
                      </span>
                    </div>
                    <span className="text-[9px] text-slate-500 font-mono truncate">{ref.path}</span>
                  </button>
                ))
              )}
            </div>
          </aside>
        )}

        {/* Neon History Modal */}
        {showHistoryModal && (
          <aside className="w-80 border-l border-slate-800 flex flex-col bg-slate-900/90 backdrop-blur shrink-0">
            <div className="p-2.5 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-amber-400" />
                Riwayat Versi (Neon DB)
              </span>
              <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {histories.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada riwayat snapshot.</p>
              ) : (
                histories.map((h) => (
                  <div key={h.id} className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-400 text-[11px]">Versi {h.version}</span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        {new Date(h.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {h.group_id && (
                      <div className="text-[9px] text-amber-400 font-mono truncate">
                        Group: {h.group_id}
                      </div>
                    )}
                    <p className="text-slate-300 text-[10px]">{h.change_summary}</p>
                    <div className="flex items-center justify-between text-[9px] text-slate-500 pt-1 border-t border-slate-900">
                      <span>{h.author_name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCompareHistory(h)}
                          className="hover:text-indigo-300 text-slate-400 px-1"
                        >
                          Diff
                        </button>
                        <button
                          onClick={() => handleRestoreHistory(h)}
                          className="hover:text-amber-300 text-slate-400 px-1"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Modal: Tambah / Edit Label Tenant */}
      {showTenantModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-400" /> 
                {isEditingTenant ? "Edit Label & Nama Tenant" : "Daftarkan Tenant Baru"}
              </h3>
              <button onClick={() => setShowTenantModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleTenantFormSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nama Klien / Perusahaan *</label>
                <input 
                  type="text" 
                  required
                  placeholder="Contoh: Indomaret (PT Indomarco Prismatama)"
                  value={tenantForm.clientName}
                  onChange={(e) => setTenantForm({ ...tenantForm, clientName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Tenant ID (UUID) *</label>
                <input 
                  type="text" 
                  required
                  readOnly={isEditingTenant}
                  placeholder="Contoh: 019fa680-855c-7de7-8707-0831d5761922"
                  value={tenantForm.tenantId}
                  onChange={(e) => setTenantForm({ ...tenantForm, tenantId: e.target.value })}
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${
                    isEditingTenant ? "opacity-60 cursor-not-allowed" : "focus:border-indigo-500"
                  }`}
                />
                {isEditingTenant && <span className="text-[10px] text-slate-500">Tenant ID merupakan primary key dan tidak dapat diubah.</span>}
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Group ID (Opsional)</label>
                <input 
                  type="text" 
                  placeholder="Contoh: 019fa680-855c-7de7-8707-0831d5761922"
                  value={tenantForm.groupId}
                  onChange={(e) => setTenantForm({ ...tenantForm, groupId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500">Dapat dikosongkan jika tenant tidak memiliki group induk terpisah.</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Kode Singkat (Code)</label>
                  <input 
                    type="text" 
                    placeholder="Contoh: IDM"
                    value={tenantForm.clientCode}
                    onChange={(e) => setTenantForm({ ...tenantForm, clientCode: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 uppercase focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Environment</label>
                  <input 
                    type="text" 
                    readOnly
                    value="development"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-amber-300 font-mono text-xs cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Tags (Pisahkan koma)</label>
                <input 
                  type="text" 
                  placeholder="retail, stable-v2, priority"
                  value={tenantForm.tags}
                  onChange={(e) => setTenantForm({ ...tenantForm, tags: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Catatan Tambahan (Notes)</label>
                <textarea 
                  rows={2}
                  placeholder="Catatan mengenai konfigurasi tenant ini..."
                  value={tenantForm.notes}
                  onChange={(e) => setTenantForm({ ...tenantForm, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button"
                  onClick={() => setShowTenantModal(false)}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Batal
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/20"
                >
                  {isEditingTenant ? "Simpan Perubahan" : "Daftarkan Tenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Tambah Tenant Configuration Baru */}
      {showAddConfigModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <FilePlus className="w-4 h-4 text-indigo-400" /> 
                Tambah {configDomain === "workflow_pipeline" ? "Workflow Pipeline" : "Konfigurasi"} untuk {selectedTenant?.name}
              </h3>
              <button onClick={() => setShowAddConfigModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddConfigSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Config Type (Tipe Konfigurasi) *</label>
                <input 
                  type="text" 
                  required
                  placeholder={configDomain === "workflow_pipeline"
                    ? "Contoh: CREATE_SCHEDULE_INTERVIEW, ADD_FINAL_DECISION"
                    : "Contoh: CANDIDATE_STABLE, VACANCY_STABLE, APPLICANT_STABLE"}
                  value={newConfigForm.configType}
                  onChange={(e) => setNewConfigForm({ ...newConfigForm, configType: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 uppercase font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              {configDomain === "tenant_config" && (
                <div>
                  <label className="block text-slate-400 mb-1">Path (Opsional)</label>
                  <input 
                    type="text" 
                    placeholder="Contoh: candidate-stable atau rules.validation"
                    value={newConfigForm.path}
                    onChange={(e) => setNewConfigForm({ ...newConfigForm, path: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">Group ID (Opsional)</label>
                <input 
                  type="text" 
                  placeholder={selectedTenant?.groupId || "Opsional (UUID group)"}
                  value={newConfigForm.groupId}
                  onChange={(e) => setNewConfigForm({ ...newConfigForm, groupId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Template Nilai Awal</label>
                <select 
                  value={newConfigForm.templateSource}
                  onChange={(e) => setNewConfigForm({ ...newConfigForm, templateSource: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="empty">Template Kosong (&#123; views: [] &#125;)</option>
                  <option value="copy_active">Salin dari Konfigurasi yang Sedang Dibuka di Editor</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button"
                  onClick={() => setShowAddConfigModal(false)}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Batal
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/20"
                >
                  Buat Konfigurasi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Hapus Konfigurasi dengan Validasi Ketik Nama */}
      {showDeleteConfigModal && configToDelete && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-rose-300 flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-500" />
                Hapus Konfigurasi: {configToDelete.config_type}
              </h3>
              <button 
                onClick={() => setShowDeleteConfigModal(false)} 
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 p-3 rounded-lg text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Peringatan Tindakan Kritis</span>
              </div>
              <p className="text-[11px] text-rose-200/90 leading-normal">
                Konfigurasi <strong className="font-mono text-white">{configToDelete.config_type}</strong> milik tenant <strong>{selectedTenant?.name}</strong> akan dihapus dari database.
              </p>
              <p className="text-[10px] text-slate-400">
                Kondisi terakhir sebelum dihapus akan dicatat ke riwayat audit Neon DB untuk keperluan pemulihan/audit.
              </p>
            </div>

            <form onSubmit={handleDeleteConfigSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">
                  Ketik nama konfigurasi <span className="font-mono text-rose-400 select-all font-bold">"{configToDelete.config_type}"</span> untuk mengonfirmasi:
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={deleteInputConfirmation}
                  onChange={(e) => setDeleteInputConfirmation(e.target.value)}
                  placeholder={`Ketik ${configToDelete.config_type}`}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-rose-500"
                />
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  {deleteInputConfirmation.trim() === configToDelete.config_type ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-medium">
                      <Check className="w-3 h-3" /> Nama cocok! Tombol hapus aktif.
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      Nama harus cocok persis (case-sensitive)
                    </span>
                  )}
                  <span className="font-mono text-[9px] text-slate-500">
                    {deleteInputConfirmation.length} / {configToDelete.config_type.length} karakter
                  </span>
                </div>
              </div>

              {deleteError && (
                <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-[11px]">
                  {deleteError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfigModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={deleteInputConfirmation.trim() !== configToDelete.config_type || isDeletingConfig}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    deleteInputConfirmation.trim() === configToDelete.config_type && !isDeletingConfig
                      ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 cursor-pointer"
                      : "bg-slate-800/80 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-50"
                  }`}
                  title={
                    deleteInputConfirmation.trim() !== configToDelete.config_type
                      ? "Ketik nama konfigurasi yang cocok untuk mengaktifkan tombol ini"
                      : "Hapus konfigurasi"
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeletingConfig ? "Menghapus..." : "Hapus Konfigurasi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Simpan / Export ke File Preset Lokal */}
      {showSavePresetModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100 text-sm">Simpan ke Preset File Lokal</h3>
                  <p className="text-[11px] text-slate-400">
                    Ekspor isi konfigurasi aktif ke file JSON pada disk komputer Anda.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowSavePresetModal(false)}
                className="text-slate-400 hover:text-slate-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveToPreset} className="space-y-3.5 text-xs">
              {/* Pilihan Scope Ekspor */}
              <div>
                <label className="block text-slate-400 mb-1.5 font-medium">Pilihan Yang Ingin Diekspor:</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setExportScope("single")}
                    className={`p-2 rounded-lg border text-left flex flex-col gap-1 transition ${
                      exportScope === "single"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-sm"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <span className="font-semibold text-[11px] flex items-center gap-1">
                      📄 1 Config Aktif
                    </span>
                    <span className="text-[10px] opacity-75 truncate">{activeConfigType || "Config ini"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportScope("current_tenant")}
                    className={`p-2 rounded-lg border text-left flex flex-col gap-1 transition ${
                      exportScope === "current_tenant"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-sm"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <span className="font-semibold text-[11px] flex items-center gap-1">
                      📂 Semua Tenant Ini
                    </span>
                    <span className="text-[10px] opacity-75">{configs.length} file konfigurasi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportScope("all_tenants")}
                    className={`p-2 rounded-lg border text-left flex flex-col gap-1 transition ${
                      exportScope === "all_tenants"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-sm"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <span className="font-semibold text-[11px] flex items-center gap-1">
                      🌐 Seluruh Database
                    </span>
                    <span className="text-[10px] opacity-75">Semua tenant (ats_db)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Folder Tujuan (Preset Directory)</label>
                <input 
                  type="text" 
                  required
                  value={presetSaveTargetDir}
                  onChange={(e) => setPresetSaveTargetDir(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Mode: 1 Config Aktif */}
              {exportScope === "single" && (
                <>
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">Nama File (.json)</label>
                    <input 
                      type="text" 
                      required
                      placeholder="Contoh: CANDIDATE.json"
                      value={presetSaveFilename}
                      onChange={(e) => setPresetSaveFilename(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {(() => {
                    const normName = presetSaveFilename.trim().endsWith(".json") 
                      ? presetSaveFilename.trim() 
                      : presetSaveFilename.trim() + ".json";
                    const isExisting = references.some(r => r.name.toLowerCase() === normName.toLowerCase());

                    if (presetSaveFilename.trim()) {
                      if (isExisting) {
                        return (
                          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 px-3 py-2 rounded-lg text-[11px] flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                            <div>
                              <span className="font-semibold block">File sudah ada!</span>
                              <span>File <code className="font-mono text-amber-200">{normName}</code> sudah ada. Menyimpan akan <strong>memperbarui (update/overwrite)</strong> isi file tersebut.</span>
                            </div>
                          </div>
                        );
                      } else {
                        return (
                          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-3 py-2 rounded-lg text-[11px] flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                            <div>
                              <span className="font-semibold block">File baru</span>
                              <span>File baru <code className="font-mono text-emerald-200">{normName}</code> belum ada dan akan <strong>dibuat baru</strong> di folder preset.</span>
                            </div>
                          </div>
                        );
                      }
                    }
                    return null;
                  })()}
                </>
              )}

              {/* Mode: Semua Konfigurasi Tenant ini */}
              {exportScope === "current_tenant" && (
                <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-lg p-3 space-y-2 text-[11px] text-slate-300">
                  <p>
                    Akan mengekspor seluruh <strong>{configs.length} konfigurasi</strong> milik tenant <strong>{selectedTenant?.name || "Aktif"}</strong> langsung dari database ke folder preset.
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer pt-1 text-slate-300">
                    <input 
                      type="checkbox" 
                      checked={exportSubfolder} 
                      onChange={(e) => setExportSubfolder(e.target.checked)} 
                      className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0"
                    />
                    <span>Kelompokkan ke dalam subfolder tenant (<code className="font-mono text-indigo-300">{selectedTenant?.code || "tenant"}/&lt;config_type&gt;.json</code>)</span>
                  </label>
                </div>
              )}

              {/* Mode: Seluruh Database */}
              {exportScope === "all_tenants" && (
                <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-lg p-3 space-y-1.5 text-[11px] text-slate-300">
                  <p className="font-medium text-indigo-200">
                    🌐 Ekspor Masal Seluruh Database (87 Konfigurasi)
                  </p>
                  <p className="text-slate-400">
                    Akan mengekspor semua konfigurasi dari semua tenant di tabel <code className="font-mono text-slate-200">public.tenant_configurations</code> dan otomatis dikelompokkan rapi ke subfolder masing-masing nama tenant.
                  </p>
                </div>
              )}

              {/* Opsi Tambahan: Sertakan Skill tenant_config */}
              <div className="bg-slate-950/70 border border-slate-800 hover:border-slate-700/80 rounded-lg p-2.5 transition">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={includeSkillPreset} 
                    onChange={(e) => setIncludeSkillPreset(e.target.checked)} 
                    className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0 mt-0.5"
                  />
                  <div className="text-[11px] space-y-0.5">
                    <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      Sertakan Skill tenant_config (SKILL.md & Panduan)
                    </span>
                    <p className="text-slate-400 text-[10px] leading-relaxed">
                      Menyertakan file spesifikasi AI Agent <code className="text-indigo-200 font-mono">skills/tenant-configuration/SKILL.md</code> dan panduan teknis ke folder ekspor agar AI (Antigravity/Gemini) otomatis memahami struktur, schema, dan validasi preset.
                    </p>
                  </div>
                </label>
              </div>

              {savePresetStatus && (
                <div className={`p-2.5 rounded-lg text-[11px] border ${
                  savePresetStatus.type === "success" 
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" 
                    : "bg-red-500/10 text-red-300 border-red-500/30"
                }`}>
                  {savePresetStatus.message}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button 
                  type="button"
                  onClick={() => setShowSavePresetModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  Batal
                </button>
                <button 
                  type="submit"
                  disabled={isSavingPreset || (exportScope === "single" && !presetSaveFilename.trim())}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/20 transition flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  {isSavingPreset 
                    ? "Sedang Mengekspor..." 
                    : exportScope === "single" 
                    ? `Simpan File${includeSkillPreset ? " + Skill" : ""}` 
                    : exportScope === "current_tenant"
                    ? `Ekspor ${configs.length} File Tenant Ini${includeSkillPreset ? " + Skill" : ""}`
                    : `Ekspor Seluruh Database${includeSkillPreset ? " + Skill" : ""}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal: Sync Center (tenant_configurations <-> file preset lokal) */}
      {showSyncTenantModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-100 text-sm truncate">
                    Sync Center — {selectedTenant?.name}
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">
                    Bandingkan setiap config di database dengan file preset lokal, lalu pilih arah sinkronisasinya.
                  </p>
                </div>
              </div>
              <button onClick={() => setShowSyncTenantModal(false)} className="text-slate-400 hover:text-slate-200 transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-slate-800 shrink-0">
              <Stepper steps={["Pilih config", "Pratinjau perubahan", "Hasil"]} current={syncStep} />
            </div>

            {syncStep === 1 && (
              <>
            <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between gap-3 text-[11px] shrink-0">
              <div className="flex items-center gap-1.5 min-w-0 text-slate-400">
                <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="shrink-0">Folder preset:</span>
                <code className="font-mono text-amber-200 truncate" title={presetDirPath}>{presetDirPath}</code>
                <span className="text-slate-500 shrink-0">(ubah lewat panel Presets)</span>
              </div>
              <button
                onClick={fetchSyncStatus}
                disabled={syncLoading}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition disabled:opacity-40 shrink-0"
              >
                <RefreshCw className={`w-3 h-3 ${syncLoading ? "animate-spin" : ""}`} /> Muat ulang
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px]">
              {syncError && (
                <div className="m-3 p-2.5 rounded-lg text-[11px] border bg-red-500/10 text-red-300 border-red-500/30">{syncError}</div>
              )}
              {!syncError && syncRows.length === 0 && !syncLoading && (
                <p className="p-6 text-center text-xs text-slate-500">Tenant ini belum memiliki konfigurasi di database.</p>
              )}
              {syncRows.length > 0 && (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="w-8 p-2">
                        <input
                          type="checkbox"
                          className="rounded bg-slate-900 border-slate-700"
                          checked={syncRows.some(r => r.filePath) && syncRows.filter(r => r.filePath).every(r => syncSelected.has(r.configType))}
                          onChange={(e) =>
                            setSyncSelected(e.target.checked ? new Set(syncRows.filter(r => r.filePath).map(r => r.configType)) : new Set())
                          }
                          title="Pilih semua yang punya file"
                        />
                      </th>
                      <th className="text-left p-2 font-medium">Config (Database)</th>
                      <th className="text-left p-2 font-medium">File Preset Lokal</th>
                      <th className="text-left p-2 font-medium w-28">Status</th>
                      <th className="text-left p-2 font-medium w-36">Diubah (DB)</th>
                      <th className="p-2 w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncRows.map((row) => {
                      const badge = SYNC_STATUS_BADGE[row.status];
                      const inRefs = row.filePath ? references.some(r => r.path === row.filePath) : false;
                      return (
                        <tr key={row.configId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              className="rounded bg-slate-900 border-slate-700"
                              checked={syncSelected.has(row.configType)}
                              onChange={() => toggleSyncSelected(row.configType)}
                            />
                          </td>
                          <td className="p-2">
                            <span className="font-mono text-slate-200">{row.configType}</span>
                            {row.groupId && row.groupId !== selectedTenant?.tenantId && (
                              <span className="block text-[9px] text-amber-300 font-mono truncate max-w-[200px]" title={row.groupId}>G: {row.groupId}</span>
                            )}
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={row.filePath || ""}
                                onChange={(e) => e.target.value && handleSyncLink(row, e.target.value)}
                                className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                              >
                                <option value="" disabled>— pilih file —</option>
                                {row.filePath && !inRefs && <option value={row.filePath}>{row.filePath}</option>}
                                {references.map((r) => (
                                  <option key={r.path} value={r.path}>
                                    {r.category === "root" ? "" : r.category + "/"}{r.name}
                                  </option>
                                ))}
                              </select>
                              {row.linkSource === "auto" && (
                                <span className="text-[9px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded px-1 py-0.5 shrink-0" title="Cocok otomatis berdasarkan nama file. Pilih file di dropdown untuk menyimpan link.">saran</span>
                              )}
                              {row.linkSource === "saved" && (
                                <span className="text-[9px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-1 py-0.5 shrink-0" title="Link tersimpan">link</span>
                              )}
                            </div>
                          </td>
                          <td className="p-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${badge.cls}`}>{badge.label}</span>
                            {row.duplicateType && (
                              <span
                                className="block mt-0.5 text-[9px] text-amber-300"
                                title="Ada lebih dari 1 config aktif dengan tipe ini; push/pull per-tipe akan ditolak."
                              >
                                Tipe kembar
                              </span>
                            )}
                            {row.pullRequired && (
                              <span
                                className="block mt-0.5 text-[9px] text-rose-300"
                                title="File belum di-pull dari versi database saat ini. Push akan ditolak sampai Anda melakukan Pull."
                              >
                                Perlu Pull dulu
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-slate-400 font-mono text-[10px]">
                            {row.dbUpdatedAt ? new Date(row.dbUpdatedAt).toLocaleString("id-ID") : "-"}
                          </td>
                          <td className="p-2 text-right">
                            <button
                              onClick={() => handleSyncCompare(row)}
                              disabled={!row.filePath || row.status === "file_missing"}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] transition disabled:opacity-30"
                              title="Buka kedua window dalam mode Diff"
                            >
                              Bandingkan
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {syncUnlinked.length > 0 && (
                <p className="px-4 py-2 text-[10px] text-slate-500 border-t border-slate-800/60">
                  {syncUnlinked.length} file di folder preset belum terhubung ke config tenant ini dan tidak akan disentuh. Pilih manual lewat dropdown jika ingin dihubungkan.
                </p>
              )}
            </div>

              </>
            )}

            {syncStep === 2 && (
              <div className="flex-1 overflow-y-auto min-h-[200px] p-4 space-y-2">
                <p className="text-[11px] text-slate-400">
                  {syncDirection === "push"
                    ? "Pratinjau PUSH: isi file lokal akan menggantikan config di database. Angka menunjukkan perubahan yang akan terjadi di DB."
                    : "Pratinjau PULL: isi database akan menimpa file lokal (file lama dicadangkan sebagai .bak). Angka menunjukkan perubahan pada file."}
                </p>
                {syncPreviewLoading && <p className="text-xs text-slate-500 py-6 text-center">Menghitung perbedaan…</p>}
                {!syncPreviewLoading && syncPreview.map((item) => (
                  <div key={item.configType} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-950/50 ring-1 ring-inset ring-slate-800">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-slate-100 truncate">{item.configType}</div>
                      <div className="font-mono text-[10px] text-slate-500 truncate" title={item.filePath}>{item.filePath}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.error ? (
                        <Chip tone="rose">{item.error}</Chip>
                      ) : item.blocked ? (
                        <Chip tone="rose" title="Server akan menolak item ini">Akan ditolak: {item.blocked}</Chip>
                      ) : item.total === 0 ? (
                        <Chip tone="slate">Tidak ada perubahan · dilewati</Chip>
                      ) : (
                        <>
                          <Chip tone="emerald">+{item.added}</Chip>
                          <Chip tone="rose">−{item.removed}</Chip>
                          <Chip tone="amber">~{item.modified}</Chip>
                        </>
                      )}
                      {!item.error && (
                        <button
                          onClick={() => {
                            const row = syncRows.find(r => r.configType === item.configType);
                            if (row) handleSyncCompare(row);
                          }}
                          className="ml-1 px-2 py-0.5 rounded-md text-[10px] text-slate-300 hover:text-white hover:bg-slate-800 transition"
                          title="Buka Visual Diff untuk item ini (menutup Sync Center)"
                        >
                          Lihat diff
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {syncStep === 3 && (
              <div className="flex-1 overflow-y-auto min-h-[200px] p-4">
                {syncBusy && <p className="text-xs text-slate-500 py-6 text-center">Memproses sinkronisasi…</p>}
                {syncResult && (
                  <div className={`p-3 rounded-lg text-[11px] ring-1 ring-inset space-y-1.5 ${
                    syncResult.failed > 0 ? "bg-amber-500/10 text-amber-200 ring-amber-500/30" : "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                  }`}>
                    <p className="font-semibold">
                      {syncResult.direction === "push" ? "Push file → DB" : "Pull DB → file"}: {syncResult.updated} diperbarui
                      {syncResult.created > 0 ? `, ${syncResult.created} dibuat` : ""}, {syncResult.skipped} sudah sama, {syncResult.failed} gagal
                    </p>
                    {syncResult.results.map((r, i) => (
                      <p key={i} className={`font-mono text-[10px] ${r.action === "failed" ? "text-red-300" : "text-slate-300"}`}>
                        {r.action === "failed" ? "✗" : r.action === "skipped" ? "–" : "✓"} {r.configType}: {r.error || r.action}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 p-4 border-t border-slate-800 shrink-0">
              {syncStep === 1 && (
                <>
                  <span className="text-[11px] text-slate-400">
                    {syncSelected.size} dipilih · hanya item yang dipilih yang diproses
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => goSyncPreview("pull")}
                      disabled={syncSelected.size === 0}
                      className="px-3 py-1.5 rounded-lg text-amber-200 hover:bg-amber-500/10 ring-1 ring-inset ring-amber-500/40 transition flex items-center gap-1.5 disabled:opacity-40"
                      title="Pratinjau: timpa file lokal dengan isi database"
                    >
                      <Download className="w-3.5 h-3.5" /> Pratinjau Pull ke Lokal
                    </button>
                    <button
                      onClick={() => goSyncPreview("push")}
                      disabled={syncSelected.size === 0}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm transition flex items-center gap-1.5 disabled:opacity-40"
                      title="Pratinjau: timpa config di database dengan isi file lokal"
                    >
                      <Zap className="w-3.5 h-3.5" /> Pratinjau Push ke DB
                    </button>
                  </div>
                </>
              )}
              {syncStep === 2 && syncDirection && (() => {
                const runnable = syncPreview.filter(p => !p.error && !p.blocked && p.total > 0).length;
                return (
                  <>
                    <button onClick={() => setSyncStep(1)} className="px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition flex items-center gap-1.5">
                      <ArrowLeft className="w-3.5 h-3.5" /> Kembali
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400">{runnable} dari {syncPreview.length} item akan diubah</span>
                      <button
                        onClick={() => {
                          setSyncStep(3);
                          runSyncApply(syncDirection);
                        }}
                        disabled={syncPreviewLoading || syncBusy}
                        className={`px-3 py-1.5 rounded-lg text-white font-medium shadow-sm transition flex items-center gap-1.5 disabled:opacity-40 ${
                          syncDirection === "push" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-amber-600 hover:bg-amber-500"
                        }`}
                      >
                        {syncDirection === "push" ? <Zap className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                        {syncDirection === "push" ? "Jalankan Push ke DB" : "Jalankan Pull ke Lokal"}
                      </button>
                    </div>
                  </>
                );
              })()}
              {syncStep === 3 && (
                <>
                  <button
                    onClick={() => setSyncStep(1)}
                    disabled={syncBusy}
                    className="px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke daftar
                  </button>
                  <button
                    onClick={() => setShowSyncTenantModal(false)}
                    disabled={syncBusy}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition disabled:opacity-40"
                  >
                    Selesai
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bandingkan Antar Tenant */}
      {showCompareTenantModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <ArrowLeftRight className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Bandingkan Konfigurasi Antar Tenant
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Buka split screen atau diff visual untuk membandingkan dua tenant secara langsung.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowCompareTenantModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              {/* Tenant Kiri (Aktif) */}
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold block">Window Kiri (Tenant Aktif):</span>
                <div className="p-2 rounded bg-indigo-950/30 border border-indigo-500/30">
                  <div className="font-medium text-indigo-200 truncate">{selectedTenant?.name}</div>
                  <div className="font-mono text-[10px] text-indigo-400">{selectedTenant?.code} · {activeConfigType || "No Config"}</div>
                </div>
              </div>

              {/* Tenant Kanan (Pembanding) */}
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-semibold block">Window Kanan (Target Pembanding):</span>
                <div className="p-2 rounded bg-purple-950/30 border border-purple-500/30">
                  <div className="font-medium text-purple-200 truncate">
                    {tenants.find(t => t.tenantId === compareModalTenantId)?.name || "Pilih Tenant..."}
                  </div>
                  <div className="font-mono text-[10px] text-purple-400">
                    {tenants.find(t => t.tenantId === compareModalTenantId)?.code} · {compareModalConfigType || "Pilih Config"}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">1. Pilih Tenant Pembanding:</label>
                <select
                  value={compareModalTenantId}
                  onChange={(e) => handleCompareModalTenantChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="" disabled>-- Pilih Tenant --</option>
                  {tenants.map(t => (
                    <option key={t.tenantId} value={t.tenantId}>
                      {t.name} ({t.code}) {t.tenantId === selectedTenant?.tenantId ? "— (Tenant Aktif Saat Ini)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">2. Pilih Jenis Konfigurasi Target:</label>
                <select
                  value={compareModalConfigType}
                  onChange={(e) => setCompareModalConfigType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                >
                  {compareConfigs.length === 0 ? (
                    <option value="">(Tenant ini belum memiliki config)</option>
                  ) : (
                    compareConfigs.map(c => (
                      <option key={c.id} value={c.config_type}>
                        {c.config_type} {c.is_default ? "[DEFAULT]" : ""} {c.group_id ? `(Group: ${c.group_id})` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">3. Mode Tampilan:</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCompareModalMode("side-by-side")}
                    className={`p-2 rounded-lg border text-left transition flex items-center gap-2 ${
                      compareModalMode === "side-by-side"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-200"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <Columns className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-[11px]">Side-by-Side</div>
                      <div className="text-[10px] text-slate-400">Dua editor mandiri</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompareModalMode("diff")}
                    className={`p-2 rounded-lg border text-left transition flex items-center gap-2 ${
                      compareModalMode === "diff"
                        ? "bg-indigo-600/20 border-indigo-500 text-indigo-200"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <GitCompare className="w-4 h-4 text-purple-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-[11px]">Diff Visual</div>
                      <div className="text-[10px] text-slate-400">Highlight baris</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompareModalMode("json-delta")}
                    className={`p-2 rounded-lg border text-left transition flex items-center gap-2 ${
                      compareModalMode === "json-delta"
                        ? "bg-cyan-600/20 border-cyan-500 text-cyan-200"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-[11px]">JSON Delta</div>
                      <div className="text-[10px] text-slate-400">Dokumen JSON selisih</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCompareTenantModal(false)}
                className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs transition"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!compareModalTenantId || !compareModalConfigType}
                onClick={() => handleStartTenantComparison(compareModalTenantId, compareModalConfigType, compareModalMode)}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-lg shadow-indigo-500/20 transition disabled:opacity-40"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" /> Buka Split Perbandingan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Buku Panduan & Dokumentasi Tenant Configuration */}
      {/* Panduan mengikuti domain aktif: tenant_configurations vs pipeline_workflow_configurations */}
      <DocsModal isOpen={showDocsModal && configDomain === "tenant_config"} onClose={() => setShowDocsModal(false)} />
      <WorkflowDocsModal isOpen={showDocsModal && configDomain === "workflow_pipeline"} onClose={() => setShowDocsModal(false)} />
    </div>
  );
}
