import { AlertTriangle, Braces, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Chip } from "../ui";
import { useStudio } from "../../studio/StudioContext";

export function EditorToolbar() {
  const {
    activeConfigType, configs, currentGroupId, handleCompareWithDb, handleFormatMainJson, handleReloadFromDb,
    handleValidate, isDbNewer, isSplitScreen, jsonContent, openDeleteConfigModal, originalContent,
    selectedConfigId, setCurrentGroupId, setJsonContent, setShowValidationPanel, setSplitMode,
    showValidationPanel, splitMode, validationIssues
  } = useStudio();
  return (
    <>
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
            { key: "validate", icon: <CheckCircle2 className="w-3.5 h-3.5" />, title: "Validasi sintaks & guardrail (Ctrl/⌘+Enter)", onClick: () => { handleValidate(); } },
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
    </>
  );
}
