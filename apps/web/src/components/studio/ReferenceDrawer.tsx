import { Download, FolderOpen, FolderSearch, Sparkles, Upload, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function ReferenceDrawer() {
  const {
    handleExportSkillOnly, handleLoadReferenceToSplit, handleUpdatePresetDir, isExportingSkill,
    openSavePresetModal, openSyncCenter, presetInputPath, references, selectedTenant, setPresetInputPath,
    setShowRefDrawer, showRefDrawer
  } = useStudio();
  return (
    <>
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
    </>
  );
}
