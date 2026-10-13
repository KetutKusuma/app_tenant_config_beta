import { ChangePasswordForm } from "../AuthGate";
import { ContextMenu, PromptDialog, TypeToConfirmDialog } from "../ui";
import { useStudio } from "../../studio/StudioContext";

export function GlobalOverlays() {
  const {
    ctxMenu, envConfirm, promptDialog, setCtxMenu, setEnvConfirm, setPromptDialog, setShowChangePassword,
    setStatusMessage, setUser, showChangePassword, statusMessage, targetEnvs, user
  } = useStudio();
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

      {promptDialog && (
        <PromptDialog
          title={promptDialog.title}
          description={promptDialog.description}
          label="Catatan perubahan (commit summary)"
          defaultValue={promptDialog.defaultValue}
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
