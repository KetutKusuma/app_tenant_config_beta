import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, Braces, Check, Copy, Database, Download, FileCode, FolderOpen,
  History, RefreshCw, RotateCcw, Save, X, Zap
} from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function EditorArea() {
  const {
    activeConfigType, compareConfigId, compareConfigType, compareConfigs, compareTenant, copiedNotification,
    deltaCopied, deltaError, deltaJsonString, deltaResult, handleApplyCompareToLive, handleApplyDbSnapshot,
    handleApplyPresetToLive, handleCompareWithDb, handleCopyJsonDelta, handleCopyLiveToLocal,
    handleCopyMissingViews, handleDownloadJsonDelta, handleFormatCompareTenant, handleFormatLocal,
    handleFormatMainJson, handleRevertCompareTenant, handleRevertLocal, handleSave, handleSaveCompareTenant,
    handleSaveLocalFile, handleSwapTenants, handleSwitchCompareConfig, handleSwitchCompareTenant,
    handleSyncPresetSingleToDb, isCompareTenantDirty, isLoadingConfig, isLocalDirty, isSaving,
    isSavingCompareTenant, isSavingLocal, isSplitScreen, jsonContent, jsonDeltaDirection, jsonDeltaFormat,
    localFilePath, originalContent, selectedConfigId, selectedTenant, setIsSplitScreen, setJsonContent,
    setJsonDeltaDirection, setJsonDeltaFormat, setSplitJsonContent, setSplitMode, splitJsonContent,
    splitMode, splitSourceType, splitTitle, tenants
  } = useStudio();
  return (
    <>
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
                <div className="pane-header relative z-10 h-8 shrink-0 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] whitespace-nowrap bg-indigo-950/40 border-b border-indigo-500/30 pl-3 pr-1.5 flex items-center justify-between gap-3 text-[11px]">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden" title={`Window Database (Live): ${activeConfigType || "No Config"}`}>
                    <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="font-medium text-indigo-200 truncate min-w-[3rem]">Database (Live)</span>
                    <span className="font-mono text-[10px] text-slate-500 truncate">{activeConfigType || "No Config"}</span>
                    {jsonContent !== originalContent && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Ada perubahan yang belum disimpan ke database" />
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {copiedNotification && (
                      <span className="text-emerald-400 flex items-center gap-1 mr-1">
                        <Check className="w-3 h-3" /> <span className="pane-label">Views Disalin!</span>
                      </span>
                    )}
                    <button
                      onClick={() => setSplitMode("json-delta")}
                      className="h-6 w-6 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 flex items-center justify-center transition"
                      title="JSON Delta: lihat perbedaan kedua window dalam dokumen JSON terstruktur"
                    >
                      <FileCode className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleFormatMainJson}
                      className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                      title="Rapikan format JSON database live (indent 2 spasi)"
                    >
                      <Braces className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-px h-4 bg-slate-700/70 mx-1" />
                    <button
                      onClick={() => handleSave()}
                      disabled={isSaving || !selectedConfigId}
                      className="h-6 px-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 shadow-sm transition disabled:opacity-40 disabled:hover:bg-indigo-600"
                      title="Simpan perubahan langsung ke database"
                    >
                      <Save className="w-3 h-3" />
                      <span className="pane-label">{isSaving ? "Saving..." : "Save to DB"}</span>
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
                  <div className="pane-header relative z-10 h-8 shrink-0 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)] whitespace-nowrap bg-amber-950/30 border-b border-amber-500/30 pl-3 pr-1.5 flex items-center justify-between gap-3 text-[11px]">
                    {/* Kiri: nama file boleh terpotong, path lengkap di tooltip */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden" title={`Preset Lokal: ${localFilePath || splitTitle}`}>
                      <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="font-medium text-amber-200 truncate min-w-[3rem]">{splitTitle}</span>
                      {isLocalDirty && (
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" title="Ada perubahan yang belum disimpan ke file" />
                      )}
                    </div>

                    {/* Aksi: Simpan File sebagai tombol utama, sisanya ghost / icon-only */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={handleFormatLocal}
                        className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                        title="Rapikan format JSON (indent 2 spasi)"
                      >
                        <Braces className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleRevertLocal}
                        disabled={!isLocalDirty}
                        className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition disabled:opacity-30 disabled:hover:bg-transparent"
                        title="Batalkan perubahan, kembali ke isi file terakhir"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleCopyLiveToLocal}
                        className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                        title="Salin isi window Database ke window lokal (belum menyimpan file)"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleCopyMissingViews}
                        className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                        title="Missing Views: salin views yang belum ada dari preset ke editor"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-px h-4 bg-slate-700/70 mx-1" />
                      <button
                        onClick={handleApplyPresetToLive}
                        className="h-6 px-2 rounded-md text-cyan-300 hover:text-cyan-200 hover:bg-slate-800 flex items-center gap-1.5 transition"
                        title="Terapkan isi window lokal ke editor database live (sebelah kiri) untuk di-review"
                      >
                        <ArrowLeft className="w-3 h-3" /> <span className="pane-label">Terapkan</span>
                      </button>
                      <button
                        onClick={handleSyncPresetSingleToDb}
                        className="h-6 px-2 rounded-md text-emerald-300 hover:text-emerald-200 hover:bg-slate-800 flex items-center gap-1.5 transition"
                        title="Sync ke DB: kirim isi window lokal ke database untuk config aktif (+ catat history)"
                      >
                        <Zap className="w-3 h-3" /> <span className="pane-label">Sync</span>
                      </button>
                      <button
                        onClick={handleSaveLocalFile}
                        disabled={!localFilePath || !isLocalDirty || isSavingLocal}
                        className="h-6 px-2.5 ml-0.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-1.5 shadow-sm transition disabled:opacity-40 disabled:hover:bg-amber-600"
                        title={localFilePath ? `Simpan ke ${localFilePath} (versi lama jadi .bak)` : "Buka file dari katalog Presets untuk mengedit file lokal"}
                      >
                        <Save className="w-3 h-3" />
                        <span className="pane-label">{isSavingLocal ? "Menyimpan..." : "Simpan"}</span>
                      </button>
                      <span className="w-px h-4 bg-slate-700/70 mx-1" />
                      <button
                        onClick={() => {
                          if (isLocalDirty && !confirm("Window lokal punya perubahan yang belum disimpan ke file. Tutup dan buang perubahan?")) return;
                          setIsSplitScreen(false);
                        }}
                        className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
                        title="Tutup window preset"
                      >
                        <X className="w-3.5 h-3.5" />
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
    </>
  );
}
