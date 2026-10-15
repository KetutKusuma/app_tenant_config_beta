import { Building2, Trash2, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function TenantModal() {
  const {
    handleTenantFormSubmit, isEditingTenant, setShowTenantModal, setTenantForm, setTenantToDelete, showTenantModal,
    targetEnvName, targetEnvs, tenantForm, tenants
  } = useStudio();
  // Saat edit: tenant yang sedang diedit (untuk tombol hapus dari daftar env aktif)
  const editingTenant = isEditingTenant ? tenants.find(t => t.tenantId === tenantForm.tenantId) : undefined;
  // Tenant disimpan per target env; kode otomatis diberi akhiran env (mis. IDM -> IDM_PROD) oleh BFF
  const activeEnv = targetEnvs.find(e => e.name === targetEnvName);
  const codeSuffix = activeEnv?.tenantCodeSuffix || "";
  return (
    <>
      {/* Modal: Tambah / Edit Label Tenant */}
      {showTenantModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-400" /> 
                {isEditingTenant ? "Edit Label & Nama Tenant" : "Daftarkan Tenant Baru"}
              </h3>
              <button onClick={() => setShowTenantModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleTenantFormSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nama Klien / Perusahaan *</label>
                <input 
                  type="text" 
                  required
                  placeholder="Contoh: Indomaret (PT Indomarco Prismatama)"
                  value={tenantForm.clientName}
                  onChange={(e) => setTenantForm({ ...tenantForm, clientName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Tenant ID (UUID) *</label>
                <input 
                  type="text" 
                  required
                  readOnly={isEditingTenant}
                  placeholder="Contoh: 019fa680-855c-7de7-8707-0831d5761922"
                  value={tenantForm.tenantId}
                  onChange={(e) => setTenantForm({ ...tenantForm, tenantId: e.target.value })}
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${
                    isEditingTenant ? "opacity-60 cursor-not-allowed" : "focus:border-indigo-500"
                  }`}
                />
                {isEditingTenant && <span className="text-[10px] text-slate-500">Tenant ID merupakan primary key dan tidak dapat diubah.</span>}
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Group ID (Opsional)</label>
                <input 
                  type="text" 
                  placeholder="Contoh: 019fa680-855c-7de7-8707-0831d5761922"
                  value={tenantForm.groupId}
                  onChange={(e) => setTenantForm({ ...tenantForm, groupId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500">Dapat dikosongkan jika tenant tidak memiliki group induk terpisah.</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Kode Singkat (Code)</label>
                  <input 
                    type="text" 
                    placeholder={`Contoh: IDM${codeSuffix}`}
                    value={tenantForm.clientCode}
                    onChange={(e) => setTenantForm({ ...tenantForm, clientCode: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 uppercase focus:outline-none focus:border-indigo-500"
                  />
                  {codeSuffix && (
                    <span className="text-[10px] text-slate-500">Akhiran <span className="font-mono text-amber-300">{codeSuffix}</span> ditambahkan otomatis.</span>
                  )}
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Environment</label>
                  <input 
                    type="text" 
                    readOnly
                    value={activeEnv ? `${activeEnv.label} (${activeEnv.name})` : targetEnvName}
                    title="Tenant disimpan untuk target env yang sedang aktif"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-amber-300 font-mono text-xs cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Tags (Pisahkan koma)</label>
                <input 
                  type="text" 
                  placeholder="retail, stable-v2, priority"
                  value={tenantForm.tags}
                  onChange={(e) => setTenantForm({ ...tenantForm, tags: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Catatan Tambahan (Notes)</label>
                <textarea 
                  rows={2}
                  placeholder="Catatan mengenai konfigurasi tenant ini..."
                  value={tenantForm.notes}
                  onChange={(e) => setTenantForm({ ...tenantForm, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                {editingTenant && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowTenantModal(false);
                      setTenantToDelete(editingTenant);
                    }}
                    className="mr-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition"
                    title={`Hapus dari daftar env ${activeEnv?.label || targetEnvName} (config di database tidak dihapus)`}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Hapus dari daftar
                  </button>
                )}
                <button 
                  type="button"
                  onClick={() => setShowTenantModal(false)}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Batal
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/20"
                >
                  {isEditingTenant ? "Simpan Perubahan" : "Daftarkan Tenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
