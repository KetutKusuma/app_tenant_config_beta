import {
  AlertTriangle, ArrowLeftRight, Building2, Check, Copy, CopyPlus, Database, Download, Edit2, FileCode, FilePlus,
  Layers, Plus, RefreshCw, Search, Trash2, Users, Workflow
} from "lucide-react";
import { DOMAIN_LABEL, ENV_DOT, SERVICE_DEFAULT_DB, serviceInEnv } from "../../types";
import { useStudio } from "../../studio/StudioContext";

export function Sidebar() {
  const {
    activeConfigType, configDomain, configs, copiedTenantId, copyToClipboard, fetchTenants, filteredTenants,
    handleCompareWithDb, handleStartTenantComparison, handleSwitchDomain, openAddTenantFromSuggestion,
    openAddTenantModal, openCompareTenantModal, openConfig, openDeleteConfigModal, openEditTenantModal,
    openSavePresetModal, openTenant, searchInputRef, searchQuery, selectedConfigId, selectedTenant, setCopyDialog,
    setCtxMenu, setSearchQuery, setShowAddConfigModal, setTenantToDelete, targetEnvName, targetEnvs, tenants,
    tenantSuggestions, tenantsWarning, targetServiceKey
  } = useStudio();
  // Daftar tenant milik target env aktif saja (tenant_id berbeda di dev / staging / production)
  const activeEnv = targetEnvs.find(e => e.name === targetEnvName);
  const envLabel = activeEnv?.label || targetEnvName;
  // Pengalih domain hanya untuk layanan yang punya tabel workflow (ATS, HRIS)
  const service = serviceInEnv(activeEnv, targetServiceKey);
  const hasWorkflow = service ? service.hasWorkflow : true;
  const dbName = service?.dbName || SERVICE_DEFAULT_DB[targetServiceKey];
  return (
    <>
      {/* Left Sidebar: Tenant Directory */}
      <aside className="w-72 border-r border-slate-800 flex flex-col bg-slate-900/40 shrink-0">
        {/* Domain switch: menentukan isi daftar tenant & config di bawahnya */}
        {hasWorkflow && <div className="p-2 border-b border-slate-800">
          <div role="tablist" aria-label="Domain konfigurasi" className="grid grid-cols-2 gap-0.5 p-0.5 rounded-lg bg-slate-950/80 ring-1 ring-inset ring-slate-800">
            {([
              { key: "tenant_config", icon: <Layers className="w-3.5 h-3.5" />, title: `tenant_configurations (${dbName})` },
              { key: "workflow_pipeline", icon: <Workflow className="w-3.5 h-3.5" />, title: `workflow (${dbName})` }
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
        </div>}

        {/* Tenant Search & Header */}
        <div className="p-2 border-b border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span
              className="flex items-center gap-1.5 min-w-0 text-[10px] font-semibold text-slate-400 uppercase tracking-wider"
              title={`Tenant yang terdaftar untuk target env ${envLabel}, config dari database ${dbName}`}
            >
              <span className="shrink-0">Tenants</span>
              <span className="shrink-0 tabular-nums text-slate-500">{filteredTenants.length}</span>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ENV_DOT[activeEnv?.color || "slate"] || "bg-slate-400"}`} />
              <span className="normal-case tracking-normal font-medium text-slate-300 truncate">{envLabel}</span>
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={openAddTenantModal}
                className="h-6 px-2 rounded-md text-[11px] text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 flex items-center gap-1 font-medium transition"
                title={`Daftarkan tenant baru untuk env ${envLabel}`}
              >
                <Plus className="w-3.5 h-3.5" /> Tambah
              </button>
              <button
                onClick={() => fetchTenants()}
                className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                title="Muat ulang daftar tenant"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input 
              ref={searchInputRef}
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari tenant / group ID... (Ctrl/⌘+K)" 
              className="w-full bg-slate-950 border border-slate-800 rounded-md pl-7 pr-2 py-1 text-[11px] focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Tenant List */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {tenantsWarning && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/10 ring-1 ring-amber-500/20 text-[10px] text-amber-200/90">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-400" />
              <span className="break-words">{tenantsWarning}</span>
            </div>
          )}
          {tenants.length === 0 && (
            <div className="px-2 py-3 space-y-2.5 text-[11px]">
              <div className="space-y-1">
                <p className="text-slate-300 font-medium">Belum ada tenant di {envLabel}</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Tenant ID dan group ID berbeda di tiap env, jadi tenant perlu didaftarkan sekali untuk env ini.
                </p>
              </div>
              {tenantSuggestions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Sudah ada di env lain</p>
                  {tenantSuggestions.map(sug => (
                    <button
                      key={sug.baseCode}
                      onClick={() => openAddTenantFromSuggestion(sug)}
                      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-800/70 ring-1 ring-inset ring-slate-800 flex items-center gap-2 transition group"
                      title={`Daftarkan ${sug.name} untuk ${envLabel} (nama & kode terisi, tenant ID diisi manual)`}
                    >
                      <Plus className="w-3 h-3 text-slate-500 group-hover:text-indigo-300 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-200">{sug.name}</span>
                        <span className="block truncate text-[9px] text-slate-500 font-mono">
                          {sug.baseCode}{activeEnv?.tenantCodeSuffix || ""} · ada di {sug.envs.join(", ")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={openAddTenantModal}
                className="w-full flex items-center justify-center gap-1 py-1.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 ring-1 ring-inset ring-indigo-500/30 text-[11px] transition"
              >
                <Plus className="w-3 h-3" /> Tambah tenant baru
              </button>
            </div>
          )}
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
                  { key: "open", label: "Buka tenant", icon: <Building2 className="w-3.5 h-3.5" />, disabled: isSelected, onSelect: () => openTenant(t) },
                  {
                    key: "compare",
                    label: "Bandingkan dengan tenant aktif",
                    hint: activeConfigType || undefined,
                    icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
                    disabled: isSelected || !selectedConfigId,
                    onSelect: () => handleStartTenantComparison(t.tenantId, activeConfigType || "CANDIDATE_STABLE")
                  },
                  { key: "edit", label: "Edit nama / label…", icon: <Edit2 className="w-3.5 h-3.5" />, onSelect: () => openEditTenantModal(t) },
                  ...(t.tenantId !== "GLOBAL_DEFAULT"
                    ? [{
                        key: "duplicate",
                        label: "Duplikat tenant…",
                        icon: <CopyPlus className="w-3.5 h-3.5" />,
                        onSelect: () => setCopyDialog({
                          source: { env: targetEnvName, tenantId: t.tenantId },
                          domains: ["tenant_config", "workflow_pipeline"],
                          preselect: "all"
                        })
                      }]
                    : []),
                  "divider",
                  { key: "copy-id", label: "Copy tenant_id", icon: <Copy className="w-3.5 h-3.5" />, onSelect: () => copyToClipboard(t.tenantId) },
                  ...(t.groupId
                    ? [{ key: "copy-group", label: "Copy group_id", icon: <Users className="w-3.5 h-3.5" />, onSelect: () => copyToClipboard(t.groupId!) }]
                    : []),
                  "divider",
                  {
                    key: "delete",
                    label: "Hapus dari daftar…",
                    hint: envLabel,
                    icon: <Trash2 className="w-3.5 h-3.5" />,
                    danger: true,
                    onSelect: () => setTenantToDelete(t)
                  }
                ]
              });
            };
            return (
              <div 
                key={t.tenantId}
                onClick={() => openTenant(t)}
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setTenantToDelete(t);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition"
                    title={`Hapus dari daftar env ${envLabel} (config di database tidak dihapus)`}
                  >
                    <Trash2 className="w-3 h-3" />
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
              className="h-6 px-2 rounded-md text-[11px] text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 flex items-center gap-1 font-medium transition"
              title="Tambah Konfigurasi Baru untuk Tenant Ini"
            >
              <FilePlus className="w-3.5 h-3.5" /> Tambah
            </button>
          </div>
          <div className="space-y-0.5">
            {configs.map((c) => {
              const isConfigActive = selectedConfigId === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => openConfig(c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({
                      x: e.clientX,
                      y: e.clientY,
                      title: c.config_type,
                      items: [
                        { key: "open", label: "Buka", icon: <FileCode className="w-3.5 h-3.5" />, disabled: isConfigActive, onSelect: () => openConfig(c) },
                        { key: "db", label: "Bandingkan dengan DB terbaru", icon: <Database className="w-3.5 h-3.5" />, disabled: !isConfigActive, hint: isConfigActive ? undefined : "buka dulu", onSelect: handleCompareWithDb },
                        { key: "tenant", label: "Bandingkan dengan tenant lain…", icon: <ArrowLeftRight className="w-3.5 h-3.5" />, disabled: !isConfigActive, hint: isConfigActive ? undefined : "buka dulu", onSelect: openCompareTenantModal },
                        { key: "export", label: "Ekspor sebagai preset…", icon: <Download className="w-3.5 h-3.5" />, disabled: !isConfigActive, hint: isConfigActive ? undefined : "buka dulu", onSelect: openSavePresetModal },
                        {
                          key: "copy-to",
                          label: "Salin ke…",
                          icon: <Copy className="w-3.5 h-3.5" />,
                          disabled: !selectedTenant,
                          onSelect: () => selectedTenant && setCopyDialog({
                            source: { env: targetEnvName, tenantId: selectedTenant.tenantId },
                            domains: [configDomain],
                            preselect: [{ domain: configDomain, configType: c.config_type }]
                          })
                        },
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
    </>
  );
}
