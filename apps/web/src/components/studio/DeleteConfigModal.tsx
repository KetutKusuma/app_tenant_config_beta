import { AlertTriangle, Check, Trash2, X } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";

export function DeleteConfigModal() {
  const {
    configToDelete, deleteError, deleteInputConfirmation, handleDeleteConfigSubmit, isDeletingConfig,
    selectedTenant, setDeleteInputConfirmation, setShowDeleteConfigModal, showDeleteConfigModal
  } = useStudio();
  return (
    <>
      {/* Modal: Hapus Konfigurasi dengan Validasi Ketik Nama */}
      {showDeleteConfigModal && configToDelete && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-rose-300 flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-500" />
                Hapus Konfigurasi: {configToDelete.config_type}
              </h3>
              <button 
                onClick={() => setShowDeleteConfigModal(false)} 
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 p-3 rounded-lg text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Peringatan Tindakan Kritis</span>
              </div>
              <p className="text-[11px] text-rose-200/90 leading-normal">
                Konfigurasi <strong className="font-mono text-white">{configToDelete.config_type}</strong> milik tenant <strong>{selectedTenant?.name}</strong> akan dihapus dari database.
              </p>
              <p className="text-[10px] text-slate-400">
                Kondisi terakhir sebelum dihapus akan dicatat ke riwayat audit Neon DB untuk keperluan pemulihan/audit.
              </p>
            </div>

            <form onSubmit={handleDeleteConfigSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">
                  Ketik nama konfigurasi <span className="font-mono text-rose-400 select-all font-bold">"{configToDelete.config_type}"</span> untuk mengonfirmasi:
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={deleteInputConfirmation}
                  onChange={(e) => setDeleteInputConfirmation(e.target.value)}
                  placeholder={`Ketik ${configToDelete.config_type}`}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-rose-500"
                />
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  {deleteInputConfirmation.trim() === configToDelete.config_type ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-medium">
                      <Check className="w-3 h-3" /> Nama cocok! Tombol hapus aktif.
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      Nama harus cocok persis (case-sensitive)
                    </span>
                  )}
                  <span className="font-mono text-[9px] text-slate-500">
                    {deleteInputConfirmation.length} / {configToDelete.config_type.length} karakter
                  </span>
                </div>
              </div>

              {deleteError && (
                <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-[11px]">
                  {deleteError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfigModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={deleteInputConfirmation.trim() !== configToDelete.config_type || isDeletingConfig}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    deleteInputConfirmation.trim() === configToDelete.config_type && !isDeletingConfig
                      ? "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 cursor-pointer"
                      : "bg-slate-800/80 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-50"
                  }`}
                  title={
                    deleteInputConfirmation.trim() !== configToDelete.config_type
                      ? "Ketik nama konfigurasi yang cocok untuk mengaktifkan tombol ini"
                      : "Hapus konfigurasi"
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeletingConfig ? "Menghapus..." : "Hapus Konfigurasi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
