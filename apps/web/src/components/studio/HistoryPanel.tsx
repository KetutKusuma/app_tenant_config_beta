import { History, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function HistoryPanel() {
  const {
    handleCompareHistory, handleRestoreHistory, histories, setShowHistoryModal, showHistoryModal
  } = useStudio();
  return (
    <>
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
    </>
  );
}
