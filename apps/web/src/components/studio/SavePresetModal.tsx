import { AlertTriangle, CheckCircle2, Download, Sparkles, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function SavePresetModal() {
  const {
    activeConfigType, configs, exportScope, exportSubfolder, handleSaveToPreset, includeSkillPreset,
    isSavingPreset, presetSaveFilename, presetSaveTargetDir, references, savePresetStatus, selectedTenant,
    setExportScope, setExportSubfolder, setIncludeSkillPreset, setPresetSaveFilename, setPresetSaveTargetDir,
    setShowSavePresetModal, showSavePresetModal
  } = useStudio();
  return (
    <>
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
    </>
  );
}
