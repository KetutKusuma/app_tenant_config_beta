import { api } from "../../lib/api";
import { useStudio } from "../../studio/StudioContext";
import type { CopyDialogDone } from "../../types";
import { ChangePasswordForm } from "../AuthGate";
import { ContextMenu, PromptDialog, TypeToConfirmDialog } from "../ui";
import { ManageAccountsModal } from "./ManageAccountsModal";
import { CopyConfigDialog } from "./CopyConfigDialog";

export function GlobalOverlays() {
  const {
    activeConfigType, copyDialog, ctxMenu, currentGroupId, envConfirm, handleDeleteTenant, isDirty, loadConfig,
    promptDialog, selectedConfigId, selectedTenant, setConfigs, setCopyDialog, setCtxMenu, setEnvConfirm,
    setPromptDialog, setShowChangePassword, showManageAccounts, setShowManageAccounts, setStatusMessage, setTenantToDelete, setUser, showChangePassword,
    statusMessage, targetEnvName, targetEnvs, tenantToDelete, user
  } = useStudio();

  const flash = (msg: string, ms: number) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), ms);
  };

  // Popup Salin config selesai. wrote juga true setelah hasil tidak pasti, dan popup tidak punya tombol muat ulang,
  // jadi muat ulang di sini: daftar config tenant aktif, lalu isi config aktif bila editor tidak punya perubahan
  const handleCopyDone = async ({ target, wrote }: CopyDialogDone) => {
    setCopyDialog(null);
    if (!wrote || !selectedTenant || target.env !== targetEnvName || target.tenantId !== selectedTenant.tenantId) return;
    try {
      const res = await api(`/api/tenants/${selectedTenant.tenantId}/configs`);
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
      setConfigs(json.data);
      if (isDirty) return flash("Isi tujuan berubah; simpan atau buang perubahan lalu muat ulang.", 6000);
      // loadConfig sudah ikut memuat riwayat config (fetchHistories)
      if (selectedConfigId) await loadConfig(selectedConfigId, activeConfigType, currentGroupId);
    } catch (err: any) {
      console.error("Gagal memuat ulang setelah salin:", err);
      flash(`Gagal memuat ulang daftar config: ${err.message}`, 6000);
    }
  };

  return (
    <>
      {/* Notifikasi status: toast di pojok kanan bawah, tidak memakan ruang header */}
      {statusMessage && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-sm px-3 py-2 rounded-lg bg-slate-900 ring-1 ring-slate-700 shadow-xl shadow-black/50 text-[11px] text-slate-200">
          {statusMessage}
        </div>
      )}

      {ctxMenu && <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />}

      {envConfirm && (
        <TypeToConfirmDialog
          title={`Tulis ke env dilindungi: ${targetEnvs.find(e => e.name === envConfirm.env)?.label || envConfirm.env}`}
          description="Perubahan ini akan langsung ditulis ke database env tersebut (versi lama tetap diarsipkan ke History)."
          expected={envConfirm.env}
          confirmLabel="Ya, tulis ke env ini"
          onConfirm={() => {
            envConfirm.resolve(true);
            setEnvConfirm(null);
          }}
          onCancel={() => {
            envConfirm.resolve(false);
            setEnvConfirm(null);
          }}
        />
      )}

      {showChangePassword && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && setShowChangePassword(false)}>
          <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Ganti password</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">{user.email} · sesi di perangkat lain akan dikeluarkan.</p>
            </div>
            <ChangePasswordForm
              forced={false}
              onCancel={() => setShowChangePassword(false)}
              onDone={(u) => {
                setUser(u);
                setShowChangePassword(false);
                setStatusMessage("🔐 Password berhasil diganti.");
                setTimeout(() => setStatusMessage(null), 3500);
              }}
            />
          </div>
        </div>
      )}

      {showManageAccounts && user.role === "admin" && (
        <ManageAccountsModal currentUserId={user.id} onClose={() => setShowManageAccounts(false)} />
      )}

      {tenantToDelete && (
        <TypeToConfirmDialog
          title={`Hapus ${tenantToDelete.name} dari daftar tenant`}
          description={
            <>
              Hanya menghapus tenant ini dari daftar Studio untuk env{" "}
              <b className="text-slate-200">{targetEnvs.find(e => e.name === targetEnvName)?.label || targetEnvName}</b>.
              Config tenant di database (<span className="font-mono">{tenantToDelete.totalConfigs} config</span>) dan
              daftar tenant di env lain tidak disentuh. Tenant bisa didaftarkan lagi kapan saja.
            </>
          }
          expected={tenantToDelete.code}
          confirmLabel="Hapus dari daftar"
          onConfirm={() => handleDeleteTenant(tenantToDelete)}
          onCancel={() => setTenantToDelete(null)}
        />
      )}

      {copyDialog && (
        <CopyConfigDialog request={copyDialog} onClose={() => setCopyDialog(null)} onDone={handleCopyDone} />
      )}

      {promptDialog && (
        <PromptDialog
          title={promptDialog.title}
          description={promptDialog.description}
          label="Catatan (alasan)"
          before={promptDialog.before}
          after={promptDialog.after}
          onConfirm={(v) => {
            promptDialog.resolve(v);
            setPromptDialog(null);
          }}
          onCancel={() => {
            promptDialog.resolve(null);
            setPromptDialog(null);
          }}
        />
      )}
    </>
  );
}
