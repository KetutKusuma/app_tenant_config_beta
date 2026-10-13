import { AlertTriangle, Check, CheckCircle2, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function ValidationPanel() {
  const { setShowValidationPanel, showValidationPanel, validationIssues } = useStudio();
  return (
    <>
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
    </>
  );
}
