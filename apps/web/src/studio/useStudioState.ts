import { useState } from "react";
import type { ContextMenuState } from "../components/ui";
import { setActiveTargetEnv } from "../lib/api";
import type {
  AppProps, ConfigDomain, ConfigItem, CopyDialogRequest, HistoryItem, ReferenceItem, TargetEnvInfo, Tenant,
  TenantSuggestion
} from "../types";
import type { DeltaFormat } from "../utils/jsonDiff";

// Semua state inti Tenant Studio (editor, tenant, env, split pane, modal).
export function useStudioState({ user, setUser, onLogout }: AppProps) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  // Daftar tenant selalu mengikuti target env aktif: saran klien dari env lain + peringatan DB target
  const [tenantSuggestions, setTenantSuggestions] = useState<TenantSuggestion[]>([]);
  const [tenantsWarning, setTenantsWarning] = useState<string | null>(null);
  // Tenant yang akan dihapus dari daftar env aktif (dialog ketik-kode untuk konfirmasi)
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
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
  const [targetEnvs, setTargetEnvs] = useState<TargetEnvInfo[]>([]);
  const [targetEnvName, setTargetEnvName] = useState<string>(() => {
    const env = user.preferences.lastTargetEnv || "";
    setActiveTargetEnv(env);
    return env;
  });
  const [envConfirm, setEnvConfirm] = useState<null | { env: string; resolve: (ok: boolean) => void }>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  // Dialog alasan perubahan (pengganti window.prompt); resolve(null) = batal.
  // before & after (opsional, keduanya) memunculkan ringkasan otomatis sebagai pratinjau.
  const [promptDialog, setPromptDialog] = useState<null | {
    title: string;
    description?: string;
    before?: any;
    after?: any;
    resolve: (value: string | null) => void;
  }>(null);
  const askReason = (opts: { title: string; description?: string; before?: any; after?: any }) =>
    new Promise<string | null>((resolve) => setPromptDialog({ ...opts, resolve }));
  // Popup "Salin config" global (Salin ke… / Duplikat tenant…); layar Bandingkan antar env memegang popup-nya sendiri
  const [copyDialog, setCopyDialog] = useState<CopyDialogRequest | null>(null);
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

  // Layar Bandingkan antar env (satu tenant di dua env, semua config)
  const [showEnvCompare, setShowEnvCompare] = useState(false);

  // JSON Delta State (Structural JSON Diff)
  const [jsonDeltaFormat, setJsonDeltaFormat] = useState<DeltaFormat>("full");
  const [jsonDeltaDirection, setJsonDeltaDirection] = useState<"left-to-right" | "right-to-left">("left-to-right");
  const [deltaCopied, setDeltaCopied] = useState(false);

  // Local References State & Customizable Folder Path
  // Folder preset per user & per domain; string kosong = BFF memakai preferensi user / default server
  const [presetDirPath, setPresetDirPath] = useState<string>(user.preferences.presetDirTenant || "");
  const [presetInputPath, setPresetInputPath] = useState<string>(user.preferences.presetDirTenant || "");
  const [showChangePassword, setShowChangePassword] = useState(false);
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

  return {
    user, setUser, onLogout, tenants, setTenants, selectedTenant, setSelectedTenant, tenantSuggestions,
    setTenantSuggestions, tenantsWarning, setTenantsWarning, tenantToDelete, setTenantToDelete, searchQuery,
    setSearchQuery, configs, setConfigs, selectedConfigId, setSelectedConfigId, activeConfigType,
    setActiveConfigType, currentGroupId, setCurrentGroupId, jsonContent, setJsonContent, originalContent,
    setOriginalContent, configVersion, setConfigVersion, configDomain, setConfigDomain, targetEnvs,
    setTargetEnvs, targetEnvName, setTargetEnvName, envConfirm, setEnvConfirm, ctxMenu, setCtxMenu,
    promptDialog, setPromptDialog, askReason, copyDialog, setCopyDialog, dbSnapshotVersion,
    setDbSnapshotVersion, isDbNewer, setIsDbNewer, isLoadingConfig, setIsLoadingConfig, isSaving, setIsSaving,
    isSplitScreen, setIsSplitScreen, splitMode, setSplitMode, splitSourceType, setSplitSourceType, splitJsonContent,
    setSplitJsonContent, splitTitle, setSplitTitle, localFilePath, setLocalFilePath,
    localFileOriginalContent, setLocalFileOriginalContent, isSavingLocal, setIsSavingLocal, isLocalDirty,
    compareTenant, setCompareTenant, compareConfigId, setCompareConfigId, compareConfigType,
    setCompareConfigType, compareConfigs, setCompareConfigs, compareTenantOriginalContent,
    setCompareTenantOriginalContent, compareConfigVersion, setCompareConfigVersion, isSavingCompareTenant,
    setIsSavingCompareTenant, isCompareTenantDirty, showCompareTenantModal, setShowCompareTenantModal, showEnvCompare, setShowEnvCompare,
    compareModalTenantId, setCompareModalTenantId, compareModalConfigType, setCompareModalConfigType,
    compareModalMode, setCompareModalMode, jsonDeltaFormat, setJsonDeltaFormat, jsonDeltaDirection,
    setJsonDeltaDirection, deltaCopied, setDeltaCopied, presetDirPath, setPresetDirPath, presetInputPath,
    setPresetInputPath, showChangePassword, setShowChangePassword, references, setReferences, showRefDrawer,
    setShowRefDrawer, validationIssues, setValidationIssues, showValidationPanel, setShowValidationPanel,
    histories, setHistories, showHistoryModal, setShowHistoryModal, showDocsModal, setShowDocsModal,
    statusMessage, setStatusMessage, copiedNotification, setCopiedNotification, copiedTenantId,
    setCopiedTenantId, showTenantModal, setShowTenantModal, isEditingTenant, setIsEditingTenant, tenantForm,
    setTenantForm, showAddConfigModal, setShowAddConfigModal, newConfigForm, setNewConfigForm,
    showDeleteConfigModal, setShowDeleteConfigModal, configToDelete, setConfigToDelete,
    deleteInputConfirmation, setDeleteInputConfirmation, isDeletingConfig, setIsDeletingConfig, deleteError,
    setDeleteError, showSavePresetModal, setShowSavePresetModal, exportScope, setExportScope,
    exportSubfolder, setExportSubfolder, presetSaveFilename, setPresetSaveFilename, presetSaveTargetDir,
    setPresetSaveTargetDir, includeSkillPreset, setIncludeSkillPreset, isExportingSkill, setIsExportingSkill,
    isSavingPreset, setIsSavingPreset, savePresetStatus, setSavePresetStatus
  };
}

export type StudioState = ReturnType<typeof useStudioState>;
