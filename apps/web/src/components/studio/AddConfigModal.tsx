import { FilePlus, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function AddConfigModal() {
  const {
    configDomain, handleAddConfigSubmit, newConfigForm, selectedTenant, setNewConfigForm,
    setShowAddConfigModal, showAddConfigModal
  } = useStudio();
  return (
    <>
      {/* Modal: Tambah Tenant Configuration Baru */}
      {showAddConfigModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <FilePlus className="w-4 h-4 text-indigo-400" /> 
                Tambah {configDomain === "workflow_pipeline" ? "Workflow Pipeline" : "Konfigurasi"} untuk {selectedTenant?.name}
              </h3>
              <button onClick={() => setShowAddConfigModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddConfigSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Config Type (Tipe Konfigurasi) *</label>
                <input 
                  type="text" 
                  required
                  placeholder={configDomain === "workflow_pipeline"
                    ? "Contoh: CREATE_SCHEDULE_INTERVIEW, ADD_FINAL_DECISION"
                    : "Contoh: CANDIDATE_STABLE, VACANCY_STABLE, APPLICANT_STABLE"}
                  value={newConfigForm.configType}
                  onChange={(e) => setNewConfigForm({ ...newConfigForm, configType: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 uppercase font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              {configDomain === "tenant_config" && (
                <div>
                  <label className="block text-slate-400 mb-1">Path (Opsional)</label>
                  <input 
                    type="text" 
                    placeholder="Contoh: candidate-stable atau rules.validation"
                    value={newConfigForm.path}
                    onChange={(e) => setNewConfigForm({ ...newConfigForm, path: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">Group ID (Opsional)</label>
                <input 
                  type="text" 
                  placeholder={selectedTenant?.groupId || "Opsional (UUID group)"}
                  value={newConfigForm.groupId}
                  onChange={(e) => setNewConfigForm({ ...newConfigForm, groupId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Template Nilai Awal</label>
                <select 
                  value={newConfigForm.templateSource}
                  onChange={(e) => setNewConfigForm({ ...newConfigForm, templateSource: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="empty">Template Kosong (&#123; views: [] &#125;)</option>
                  <option value="copy_active">Salin dari Konfigurasi yang Sedang Dibuka di Editor</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button"
                  onClick={() => setShowAddConfigModal(false)}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Batal
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/20"
                >
                  Buat Konfigurasi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
