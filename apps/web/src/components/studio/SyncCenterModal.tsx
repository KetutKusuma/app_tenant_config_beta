import { ArrowLeft, Download, FolderOpen, RefreshCw, Upload, X, Zap } from "lucide-react";
import { Chip, Stepper } from "../ui";
import { SYNC_STATUS_BADGE } from "../../types";
import { useStudio } from "../../studio/StudioContext";

export function SyncCenterModal() {
  const {
    fetchSyncStatus, goSyncPreview, handleSyncCompare, handleSyncLink, presetDirPath, references,
    runSyncApply, selectedTenant, setShowSyncTenantModal, setSyncSelected, setSyncStep, showSyncTenantModal,
    syncBusy, syncDirection, syncError, syncLoading, syncPreview, syncPreviewLoading, syncResult, syncRows,
    syncSelected, syncStep, syncUnlinked, toggleSyncSelected
  } = useStudio();
  return (
    <>
      {/* Modal: Sync Center (tenant_configurations <-> file preset lokal) */}
      {showSyncTenantModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-100 text-sm truncate">
                    Sync Center — {selectedTenant?.name}
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">
                    Bandingkan setiap config di database dengan file preset lokal, lalu pilih arah sinkronisasinya.
                  </p>
                </div>
              </div>
              <button onClick={() => setShowSyncTenantModal(false)} className="text-slate-400 hover:text-slate-200 transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-slate-800 shrink-0">
              <Stepper steps={["Pilih config", "Pratinjau perubahan", "Hasil"]} current={syncStep} />
            </div>

            {syncStep === 1 && (
              <>
            <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between gap-3 text-[11px] shrink-0">
              <div className="flex items-center gap-1.5 min-w-0 text-slate-400">
                <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="shrink-0">Folder preset:</span>
                <code className="font-mono text-amber-200 truncate" title={presetDirPath}>{presetDirPath}</code>
                <span className="text-slate-500 shrink-0">(ubah lewat panel Presets)</span>
              </div>
              <button
                onClick={fetchSyncStatus}
                disabled={syncLoading}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition disabled:opacity-40 shrink-0"
              >
                <RefreshCw className={`w-3 h-3 ${syncLoading ? "animate-spin" : ""}`} /> Muat ulang
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px]">
              {syncError && (
                <div className="m-3 p-2.5 rounded-lg text-[11px] border bg-red-500/10 text-red-300 border-red-500/30">{syncError}</div>
              )}
              {!syncError && syncRows.length === 0 && !syncLoading && (
                <p className="p-6 text-center text-xs text-slate-500">Tenant ini belum memiliki konfigurasi di database.</p>
              )}
              {syncRows.length > 0 && (
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="w-8 p-2">
                        <input
                          type="checkbox"
                          className="rounded bg-slate-900 border-slate-700"
                          checked={syncRows.some(r => r.filePath) && syncRows.filter(r => r.filePath).every(r => syncSelected.has(r.configType))}
                          onChange={(e) =>
                            setSyncSelected(e.target.checked ? new Set(syncRows.filter(r => r.filePath).map(r => r.configType)) : new Set())
                          }
                          title="Pilih semua yang punya file"
                        />
                      </th>
                      <th className="text-left p-2 font-medium">Config (Database)</th>
                      <th className="text-left p-2 font-medium">File Preset Lokal</th>
                      <th className="text-left p-2 font-medium w-28">Status</th>
                      <th className="text-left p-2 font-medium w-36">Diubah (DB)</th>
                      <th className="p-2 w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncRows.map((row) => {
                      const badge = SYNC_STATUS_BADGE[row.status];
                      const inRefs = row.filePath ? references.some(r => r.path === row.filePath) : false;
                      return (
                        <tr key={row.configId} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              className="rounded bg-slate-900 border-slate-700"
                              checked={syncSelected.has(row.configType)}
                              onChange={() => toggleSyncSelected(row.configType)}
                            />
                          </td>
                          <td className="p-2">
                            <span className="font-mono text-slate-200">{row.configType}</span>
                            {row.groupId && row.groupId !== selectedTenant?.tenantId && (
                              <span className="block text-[9px] text-amber-300 font-mono truncate max-w-[200px]" title={row.groupId}>G: {row.groupId}</span>
                            )}
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={row.filePath || ""}
                                onChange={(e) => e.target.value && handleSyncLink(row, e.target.value)}
                                className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                              >
                                <option value="" disabled>— pilih file —</option>
                                {row.filePath && !inRefs && <option value={row.filePath}>{row.filePath}</option>}
                                {references.map((r) => (
                                  <option key={r.path} value={r.path}>
                                    {r.category === "root" ? "" : r.category + "/"}{r.name}
                                  </option>
                                ))}
                              </select>
                              {row.linkSource === "auto" && (
                                <span className="text-[9px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded px-1 py-0.5 shrink-0" title="Cocok otomatis berdasarkan nama file. Pilih file di dropdown untuk menyimpan link.">saran</span>
                              )}
                              {row.linkSource === "saved" && (
                                <span className="text-[9px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-1 py-0.5 shrink-0" title="Link tersimpan">link</span>
                              )}
                            </div>
                          </td>
                          <td className="p-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${badge.cls}`}>{badge.label}</span>
                            {row.duplicateType && (
                              <span
                                className="block mt-0.5 text-[9px] text-amber-300"
                                title="Ada lebih dari 1 config aktif dengan tipe ini; push/pull per-tipe akan ditolak."
                              >
                                Tipe kembar
                              </span>
                            )}
                            {row.pullRequired && (
                              <span
                                className="block mt-0.5 text-[9px] text-rose-300"
                                title="File belum di-pull dari versi database saat ini. Push akan ditolak sampai Anda melakukan Pull."
                              >
                                Perlu Pull dulu
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-slate-400 font-mono text-[10px]">
                            {row.dbUpdatedAt ? new Date(row.dbUpdatedAt).toLocaleString("id-ID") : "-"}
                          </td>
                          <td className="p-2 text-right">
                            <button
                              onClick={() => handleSyncCompare(row)}
                              disabled={!row.filePath || row.status === "file_missing"}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] transition disabled:opacity-30"
                              title="Buka kedua window dalam mode Diff"
                            >
                              Bandingkan
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {syncUnlinked.length > 0 && (
                <p className="px-4 py-2 text-[10px] text-slate-500 border-t border-slate-800/60">
                  {syncUnlinked.length} file di folder preset belum terhubung ke config tenant ini dan tidak akan disentuh. Pilih manual lewat dropdown jika ingin dihubungkan.
                </p>
              )}
            </div>

              </>
            )}

            {syncStep === 2 && (
              <div className="flex-1 overflow-y-auto min-h-[200px] p-4 space-y-2">
                <p className="text-[11px] text-slate-400">
                  {syncDirection === "push"
                    ? "Pratinjau PUSH: isi file lokal akan menggantikan config di database. Angka menunjukkan perubahan yang akan terjadi di DB."
                    : "Pratinjau PULL: isi database akan menimpa file lokal (file lama dicadangkan sebagai .bak). Angka menunjukkan perubahan pada file."}
                </p>
                {syncPreviewLoading && <p className="text-xs text-slate-500 py-6 text-center">Menghitung perbedaan…</p>}
                {!syncPreviewLoading && syncPreview.map((item) => (
                  <div key={item.configType} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-950/50 ring-1 ring-inset ring-slate-800">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-slate-100 truncate">{item.configType}</div>
                      <div className="font-mono text-[10px] text-slate-500 truncate" title={item.filePath}>{item.filePath}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.error ? (
                        <Chip tone="rose">{item.error}</Chip>
                      ) : item.blocked ? (
                        <Chip tone="rose" title="Server akan menolak item ini">Akan ditolak: {item.blocked}</Chip>
                      ) : item.total === 0 ? (
                        <Chip tone="slate">Tidak ada perubahan · dilewati</Chip>
                      ) : (
                        <>
                          <Chip tone="emerald">+{item.added}</Chip>
                          <Chip tone="rose">−{item.removed}</Chip>
                          <Chip tone="amber">~{item.modified}</Chip>
                        </>
                      )}
                      {!item.error && (
                        <button
                          onClick={() => {
                            const row = syncRows.find(r => r.configType === item.configType);
                            if (row) handleSyncCompare(row);
                          }}
                          className="ml-1 px-2 py-0.5 rounded-md text-[10px] text-slate-300 hover:text-white hover:bg-slate-800 transition"
                          title="Buka Visual Diff untuk item ini (menutup Sync Center)"
                        >
                          Lihat diff
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {syncStep === 3 && (
              <div className="flex-1 overflow-y-auto min-h-[200px] p-4">
                {syncBusy && <p className="text-xs text-slate-500 py-6 text-center">Memproses sinkronisasi…</p>}
                {syncResult && (
                  <div className={`p-3 rounded-lg text-[11px] ring-1 ring-inset space-y-1.5 ${
                    syncResult.failed > 0 ? "bg-amber-500/10 text-amber-200 ring-amber-500/30" : "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                  }`}>
                    <p className="font-semibold">
                      {syncResult.direction === "push" ? "Push file → DB" : "Pull DB → file"}: {syncResult.updated} diperbarui
                      {syncResult.created > 0 ? `, ${syncResult.created} dibuat` : ""}, {syncResult.skipped} sudah sama, {syncResult.failed} gagal
                    </p>
                    {syncResult.results.map((r, i) => (
                      <p key={i} className={`font-mono text-[10px] ${r.action === "failed" ? "text-red-300" : "text-slate-300"}`}>
                        {r.action === "failed" ? "✗" : r.action === "skipped" ? "–" : "✓"} {r.configType}: {r.error || r.action}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 p-4 border-t border-slate-800 shrink-0">
              {syncStep === 1 && (
                <>
                  <span className="text-[11px] text-slate-400">
                    {syncSelected.size} dipilih · hanya item yang dipilih yang diproses
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => goSyncPreview("pull")}
                      disabled={syncSelected.size === 0}
                      className="px-3 py-1.5 rounded-lg text-amber-200 hover:bg-amber-500/10 ring-1 ring-inset ring-amber-500/40 transition flex items-center gap-1.5 disabled:opacity-40"
                      title="Pratinjau: timpa file lokal dengan isi database"
                    >
                      <Download className="w-3.5 h-3.5" /> Pratinjau Pull ke Lokal
                    </button>
                    <button
                      onClick={() => goSyncPreview("push")}
                      disabled={syncSelected.size === 0}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm transition flex items-center gap-1.5 disabled:opacity-40"
                      title="Pratinjau: timpa config di database dengan isi file lokal"
                    >
                      <Zap className="w-3.5 h-3.5" /> Pratinjau Push ke DB
                    </button>
                  </div>
                </>
              )}
              {syncStep === 2 && syncDirection && (() => {
                const runnable = syncPreview.filter(p => !p.error && !p.blocked && p.total > 0).length;
                return (
                  <>
                    <button onClick={() => setSyncStep(1)} className="px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition flex items-center gap-1.5">
                      <ArrowLeft className="w-3.5 h-3.5" /> Kembali
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400">{runnable} dari {syncPreview.length} item akan diubah</span>
                      <button
                        onClick={() => {
                          setSyncStep(3);
                          runSyncApply(syncDirection);
                        }}
                        disabled={syncPreviewLoading || syncBusy}
                        className={`px-3 py-1.5 rounded-lg text-white font-medium shadow-sm transition flex items-center gap-1.5 disabled:opacity-40 ${
                          syncDirection === "push" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-amber-600 hover:bg-amber-500"
                        }`}
                      >
                        {syncDirection === "push" ? <Zap className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                        {syncDirection === "push" ? "Jalankan Push ke DB" : "Jalankan Pull ke Lokal"}
                      </button>
                    </div>
                  </>
                );
              })()}
              {syncStep === 3 && (
                <>
                  <button
                    onClick={() => setSyncStep(1)}
                    disabled={syncBusy}
                    className="px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke daftar
                  </button>
                  <button
                    onClick={() => setShowSyncTenantModal(false)}
                    disabled={syncBusy}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition disabled:opacity-40"
                  >
                    Selesai
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
