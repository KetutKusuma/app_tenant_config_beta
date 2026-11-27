import {
  ArrowLeftRight, Check, CheckCircle2, ChevronRight, CircleHelp, Copy, Database, Download, Edit2, FolderOpen,
  FolderSearch, GitCompare, History, KeyRound, Layers, LogOut, RefreshCw, RotateCcw, Save, Sparkles, Upload,
  Users, X, Zap
} from "lucide-react";
import { Chip, MenuButton, SplitButton } from "../ui";
import { DOMAIN_LABEL, ENV_DOT, SERVICE_DEFAULT_DB, SERVICE_LABEL, SERVICE_TONE } from "../../types";
import { useStudio } from "../../studio/StudioContext";

export function StudioHeader() {
  const {
    activeConfigType, configDomain, handleSwitchTargetService, targetServiceKey, copiedTenantId, copyToClipboard, currentGroupId, fetchTargetEnvs,
    handleCompareWithDb, handleCompareWithOriginal, handleSave, handleSwitchTargetEnv, handleValidate,
    handleValidateAndSave, histories, isSaving, isSplitScreen, isTargetReadonly, jsonContent, onLogout,
    openCompareTenantModal, setShowEnvCompare, openEditTenantModal, openSavePresetModal, openSyncCenter, originalContent,
    presetDirPath, references, selectedConfigId, selectedTenant, setIsSplitScreen, setShowChangePassword, setShowManageAccounts,
    setShowDocsModal, setShowHistoryModal, setShowRefDrawer, showHistoryModal, targetEnvName, targetEnvs,
    user
  } = useStudio();
  return (
    <>
      {/* Top Header: brand · breadcrumb (domain › tenant › config) · aksi */}
      <header className={`relative z-30 h-11 border-b ${targetEnvs.find(e => e.name === targetEnvName)?.protected ? "border-rose-500/60" : "border-slate-800"} px-3 flex items-center gap-4 bg-slate-900/95 shrink-0 text-xs shadow-[0_4px_12px_-6px_rgba(0,0,0,0.6)]`}>
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1 rounded bg-indigo-600/20 text-indigo-400 ring-1 ring-inset ring-indigo-500/30">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-slate-200 text-xs tracking-wide">Tenant Studio</span>

          {/* Pemilih target env (ats_db): 1 profil = 1 file envs/<nama>.env */}
          {(() => {
            const cur = targetEnvs.find(e => e.name === targetEnvName);
            return (
              <MenuButton
                align="left"
                label={cur?.label || targetEnvName || "…"}
                title={cur ? `${cur.source} · ${cur.hostMasked}` : "Target database"}
                icon={<span className={`w-2 h-2 rounded-full ${ENV_DOT[cur?.color || "slate"] || ENV_DOT.slate} ${cur?.status && !cur.status.ok ? "ring-2 ring-rose-500" : ""}`} />}
                items={[
                  ...targetEnvs.map(e => ({
                    key: e.name,
                    label: `${e.label}${e.name === targetEnvName ? "  ✓" : ""}`,
                    hint: `${e.hostMasked} · ${e.status?.ok ? `${e.status.ms} ms` : `gagal: ${e.status?.error || "?"}`}${e.readonly ? " · read-only" : ""}${e.protected ? " · dilindungi" : ""}`,
                    icon: <span className={`w-2 h-2 rounded-full ${ENV_DOT[e.color] || ENV_DOT.slate}`} />,
                    onSelect: () => handleSwitchTargetEnv(e.name)
                  })),
                  "divider" as const,
                  {
                    key: "reload",
                    label: "Muat ulang daftar env",
                    hint: "Tambah file envs/<nama>.env lalu klik ini",
                    icon: <RefreshCw className="w-3.5 h-3.5" />,
                    onSelect: fetchTargetEnvs
                  }
                ]}
              />
            );
          })()}
          {/* Pemilih layanan (ats_db, hris_db, ...): selalu terlihat agar tidak salah database */}
          {(() => {
            const services = targetEnvs.find(e => e.name === targetEnvName)?.services || [];
            const cur = services.find(x => x.key === targetServiceKey);
            const db = cur?.dbName || SERVICE_DEFAULT_DB[targetServiceKey];
            return (
              <MenuButton
                align="left"
                label={`${SERVICE_LABEL[targetServiceKey]} · ${db}`}
                title={`Sedang membuka database ${db} (layanan ${SERVICE_LABEL[targetServiceKey]}). Klik untuk ganti layanan.`}
                icon={<Database className="w-3.5 h-3.5" />}
                tone={SERVICE_TONE[targetServiceKey].badge}
                items={services.map(x => ({
                  key: x.key,
                  icon: <span className={`w-2 h-2 rounded-full ${SERVICE_TONE[x.key].dot}`} />,
                  label: `${x.label} · ${x.dbName ?? "-"}${x.key === targetServiceKey ? "  ✓" : ""}`,
                  hint: x.available ? undefined : x.reason || "Tidak tersedia di env ini",
                  disabled: !x.available && !x.unreachable,
                  onSelect: () => handleSwitchTargetService(x.key)
                }))}
              />
            );
          })()}
          {targetEnvs.find(e => e.name === targetEnvName)?.readonly && <Chip tone="amber">Read-only</Chip>}
          {targetEnvs.find(e => e.name === targetEnvName)?.protected && <Chip tone="rose">Dilindungi</Chip>}
        </div>

        {/* Breadcrumb: selalu menunjukkan apa yang sedang diedit */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 flex-1 text-[11px] whitespace-nowrap overflow-hidden">
          <span className="w-px h-4 bg-slate-800 mr-1 shrink-0" />
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
                key: "env",
                label: "Antar env / semua config…",
                hint: "Satu tenant di dua env, semua config",
                icon: <Layers className="w-3.5 h-3.5" />,
                onSelect: () => setShowEnvCompare(true)
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
            disabled={isSaving || !selectedConfigId || isTargetReadonly}
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
                hint: "Simpan hanya jika tidak ada error · Ctrl/⌘+S",
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

          <span className="w-px h-5 bg-slate-800 mx-1" />

          {/* Menu user: identitas, preferensi folder, ganti password, keluar */}
          <MenuButton
            label={user.displayName}
            icon={
              <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-200 text-[9px] font-bold flex items-center justify-center uppercase">
                {user.displayName.slice(0, 2)}
              </span>
            }
            title={user.email}
            items={[
              {
                key: "who",
                label: user.email,
                hint: "Perubahan dicatat di History atas nama Anda",
                icon: <Users className="w-3.5 h-3.5" />,
                disabled: true,
                onSelect: () => {}
              },
              "divider",
              {
                key: "folder",
                label: "Folder preset…",
                hint: presetDirPath || "default server",
                icon: <FolderOpen className="w-3.5 h-3.5" />,
                onSelect: () => setShowRefDrawer(true)
              },
              {
                key: "password",
                label: "Ganti password…",
                icon: <KeyRound className="w-3.5 h-3.5" />,
                onSelect: () => setShowChangePassword(true)
              },
              ...(user.role === "admin"
                ? [{
                    key: "accounts",
                    label: "Kelola Akun",
                    icon: <Users className="w-3.5 h-3.5" />,
                    onSelect: () => setShowManageAccounts(true)
                  }]
                : []),
              "divider",
              {
                key: "logout",
                label: "Keluar",
                icon: <LogOut className="w-3.5 h-3.5" />,
                danger: true,
                onSelect: () => {
                  if (jsonContent !== originalContent && !confirm("Ada perubahan yang belum disimpan. Tetap keluar?")) return;
                  onLogout();
                }
              }
            ]}
          />
        </div>
      </header>
    </>
  );
}
