import { ArrowLeftRight, Columns, FileCode, GitCompare, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function CompareTenantModal() {
  const {
    activeConfigType, compareConfigs, compareModalConfigType, compareModalMode, compareModalTenantId,
    handleCompareModalTenantChange, handleStartTenantComparison, selectedTenant, setCompareModalConfigType,
    setCompareModalMode, setShowCompareTenantModal, showCompareTenantModal, tenants
  } = useStudio();
  return (
    <>
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
    </>
  );
}
