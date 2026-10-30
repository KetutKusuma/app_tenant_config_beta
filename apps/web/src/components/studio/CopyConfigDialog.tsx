import { useEffect, useRef, type ReactNode } from "react";
import {
  DOMAIN_TITLE, MANUAL_LABEL, MAX_REASON, downloadSql, useCopyDialog, type CopyRow
} from "../../studio/useCopyDialog";
import { MANUAL_ENV, type CopyBatchResult, type CopyDialogDone, type CopyDialogRequest, type PreviewStatus } from "../../types";
import { TypeToConfirmDialog } from "../ui";
import { ChangeBatchesPanel } from "./ChangeBatchesPanel";
import { PathOverrideField } from "./PathOverrideField";
import { useDialogEsc } from "./useDialogEsc";

const INPUT = "bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50";
const GHOST = "px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition disabled:opacity-40";
const PRIMARY = "px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-40";

const STATUS_LABEL: Record<PreviewStatus, string> = {
  baru: "Baru",
  timpa: "Akan ditimpa",
  sama: "Sama",
  ganda: "Ganda",
  hanya_tujuan: "Hanya di tujuan, dibiarkan",
  tidak_dibaca: "Tujuan tidak dibaca"
};
const STATUS_CLS: Record<PreviewStatus, string> = {
  baru: "bg-emerald-500/15 text-emerald-300",
  timpa: "bg-amber-500/15 text-amber-300",
  sama: "bg-slate-500/15 text-slate-400",
  ganda: "bg-rose-500/15 text-rose-300",
  hanya_tujuan: "bg-slate-500/15 text-slate-400",
  tidak_dibaca: "bg-sky-500/15 text-sky-300"
};

function Chip({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{children}</span>;
}

function Check({ checked, indeterminate = false, disabled, onChange, label }: {
  checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange(): void; label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" aria-label={label} className="mt-0.5 accent-indigo-500" checked={checked} disabled={disabled} onChange={onChange} />;
}

type Dialog = ReturnType<typeof useCopyDialog>;

function ConfigRowItem({ r, h }: { r: CopyRow; h: Dialog }) {
  const { item } = r;
  return (
    <li className={`px-3 py-2 text-xs ${item.status === "hanya_tujuan" ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2">
        <Check
          checked={r.checked} indeterminate={r.pathPending} label={`Pilih ${item.configType}`}
          disabled={h.locked || !(r.canCheck || r.checked || r.pathPending)} onChange={() => h.toggle(r.key)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-slate-200 break-all">{item.configType}</span>
            <Chip cls={STATUS_CLS[item.status]}>{STATUS_LABEL[item.status]}</Chip>
            {(item.pathConflict || r.dup) && <Chip cls="bg-amber-500/15 text-amber-300">Path bentrok</Chip>}
          </div>
          {item.status === "timpa" && item.autoSummary && <div className="mt-0.5 text-[11px] text-slate-400">{item.autoSummary}</div>}
          {item.status === "ganda" && <div className="mt-0.5 text-[11px] text-slate-500">Ada lebih dari satu baris aktif di sumber atau tujuan; dilewati.</div>}
          {item.pathConflict && (
            <div className="mt-1 text-[11px] text-amber-200">
              {`Path ${item.path} sudah dipakai tenant lain di tujuan (${item.pathConflict.ownerConfigType}). Ganti dengan path yang unik.`}
            </div>
          )}
          {r.dup && !item.pathConflict && (
            <div className="mt-1 text-[11px] text-amber-200">{`Path ${r.path} juga dipakai config lain yang dicentang. Ganti path salah satunya atau hilangkan centangnya.`}</div>
          )}
          {r.showField && (
            <div className="mt-1.5">
              <PathOverrideField
                value={h.overrides[r.key] ?? item.path ?? ""} targetEnv={h.targetEnv} targetTenantId={h.effTenantId}
                onChange={(v) => h.setOverride(r.key, v)} onStatus={(s) => h.setOverrideState(r.key, s)}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function ResultGroup({ label, names }: { label: string; names: string[] }) {
  return (
    <details className="rounded-md border border-slate-800 px-3 py-2 text-xs">
      <summary className="cursor-pointer flex items-baseline gap-2 select-none">
        <span className="text-lg font-semibold text-slate-100 tabular-nums">{names.length}</span>
        <span className="text-slate-300">{label}</span>
      </summary>
      {names.length > 0 && (
        <ul className="mt-2 max-h-32 overflow-y-auto space-y-0.5">
          {names.map((n) => <li key={n} className="font-mono text-[11px] text-slate-400 truncate" title={n}>{n}</li>)}
        </ul>
      )}
    </details>
  );
}

function CopyOutcome({ data }: { data: CopyBatchResult }) {
  return (
    <div className="space-y-3">
      {data.domains.map((d) => (
        <div key={d.domain} className="space-y-2">
          <div className="text-xs font-semibold text-slate-200">{DOMAIN_TITLE[d.domain]}</div>
          <div className="grid grid-cols-3 gap-2">
            <ResultGroup label="dibuat" names={d.created} />
            <ResultGroup label="ditimpa" names={d.overwritten} />
            <ResultGroup label="dilewati" names={[
              ...d.skipped.same.map((t) => `${t} (sama)`),
              ...d.skipped.duplicates.map((t) => `${t} (ganda)`),
              ...d.skipped.unselected.map((t) => `${t} (tidak dipilih)`),
              ...d.skipped.targetOnly.map((t) => `${t} (hanya di tujuan)`)
            ]} />
          </div>
        </div>
      ))}
      {data.warnings.length > 0 && (
        <div className="text-xs whitespace-pre-line rounded-md px-3 py-2 border text-amber-200 bg-amber-500/10 border-amber-500/30">{data.warnings.join("\n")}</div>
      )}
    </div>
  );
}

export function CopyConfigDialog({ request, onClose, onDone }: {
  request: CopyDialogRequest;
  onClose(): void;
  onDone(r: CopyDialogDone): void;
}) {
  const h = useCopyDialog(request, { onClose, onDone });
  useDialogEsc(h.onEsc);

  const finished = h.outcome !== null || h.uncertain !== null;
  const copyOut = h.outcome?.kind === "copy" ? h.outcome.data : null;
  const sqlOut = h.outcome?.kind === "sql" ? h.outcome.data : null;
  const domainText = h.domains.length > 1 ? "Semua" : DOMAIN_TITLE[h.domains[0]];
  const tenantMissing = h.tenantId !== "" && !h.tenantOptions.some((t) => t.tenantId === h.tenantId);
  const summary = [
    `${h.nBaru} baru`, `${h.nTimpa} ditimpa`, ...(h.nUnread > 0 ? [`${h.nUnread} tujuan tidak dibaca`] : []), `${h.nSkipped} dilewati`
  ].join(", ");
  const newOk = h.newForm.tenantId.trim() && h.newForm.groupId.trim() && h.newForm.clientName.trim() && h.newForm.clientCode.trim();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !h.busy && !h.confirming && !h.showHistory && h.close()}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Salin config</h3>
          <p className="mt-1 text-[11px] text-slate-400">
            {h.sqlMode
              ? "Hasilnya file SQL yang aman dijalankan ulang: UPDATE bila config sudah ada, INSERT bila belum."
              : "Isi lama setiap config yang ditimpa disimpan ke Riwayat tujuan sebelum ditulis. Config yang hanya ada di tujuan tidak dihapus."}
          </p>
        </div>

        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-3 items-start text-xs text-slate-400">
          <span className="pt-1">Sumber</span>
          <span className="pt-1 text-slate-200 truncate" title={`${h.sourceLabel} · ${h.sourceTenantCode} · ${domainText}`}>
            {`${h.sourceLabel} · ${h.sourceTenantCode} · ${domainText}`}
          </span>

          <span className="pt-1">Env tujuan</span>
          <div className="space-y-1">
            <select className={`${INPUT} max-w-xs`} value={h.targetEnv} disabled={h.targetLocked} onChange={(e) => h.pickEnv(e.target.value)}>
              {h.targetInfo === undefined && !h.isManual && <option value={h.targetEnv}>{h.targetEnv}</option>}
              {h.envOptions.map((e) => <option key={e.name} value={e.name}>{e.label}</option>)}
              <option value={MANUAL_ENV}>{MANUAL_LABEL}</option>
            </select>
            <div className="text-[11px] text-slate-500">
              {h.isManual
                ? "Mode Unduh SQL. Tujuan tidak bisa dibaca, jadi semua config sumber ditulis dengan status Tujuan tidak dibaca."
                : h.sqlMode
                  ? `Mode Unduh SQL: ${h.targetLabel} hanya-baca, hasilnya file SQL.`
                  : `Mode Salin langsung ke ${h.targetLabel}.`}
            </div>
          </div>

          <span className="pt-1">Tenant tujuan</span>
          {h.isManual ? (
            <div className="space-y-1 min-w-0">
              <div className="flex gap-2 min-w-0">
                <input className={`${INPUT} flex-1 min-w-0 font-mono`} placeholder="tenant_id (UUID)" value={h.manualTenant} disabled={h.targetLocked}
                  onChange={(e) => h.typeManualTenant(e.target.value)} />
                <input className={`${INPUT} flex-1 min-w-0 font-mono`} placeholder="group_id (kosong = sama dengan tenant_id)" value={h.manualGroup} disabled={h.locked}
                  onChange={(e) => h.setManualGroup(e.target.value)} />
              </div>
              {h.manualTenant.trim() !== "" && !h.manualTenantOk && <div className="text-[11px] text-rose-300">tenant_id harus berupa UUID.</div>}
              {!h.manualGroupOk && <div className="text-[11px] text-rose-300">group_id harus berupa UUID.</div>}
            </div>
          ) : (
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <select className={`${INPUT} max-w-xs truncate`} value={h.tenantId} disabled={h.targetLocked || !h.tenantsLoaded} onChange={(e) => h.pickTenant(e.target.value)}>
                  <option value="">{h.tenantsLoaded ? "Pilih tenant…" : "Memuat tenant…"}</option>
                  {tenantMissing && <option value={h.tenantId}>{h.tenantId}</option>}
                  {h.tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{`${t.name} (${t.code})`}</option>)}
                </select>
                {h.canRegister && (
                  <button type="button" className={GHOST} disabled={h.targetLocked} onClick={() => h.setShowNew(!h.showNew)}>+ Daftarkan tenant</button>
                )}
              </div>
              {h.tenantError && <div className="text-[11px] text-amber-200">{h.tenantError}</div>}
              {!h.canRegister && <div className="text-[11px] text-slate-500">{`${h.targetLabel} hanya-baca: tenant tidak bisa didaftarkan dari sini. Untuk tenant yang belum terdaftar, pakai ${MANUAL_LABEL}.`}</div>}
              {h.canRegister && h.showNew && (
                <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-800 p-2">
                  <input className={`${INPUT} font-mono`} placeholder="tenant_id (UUID)" value={h.newForm.tenantId} onChange={(e) => h.setNewForm({ ...h.newForm, tenantId: e.target.value })} />
                  <input className={`${INPUT} font-mono`} placeholder="group_id" value={h.newForm.groupId} onChange={(e) => h.setNewForm({ ...h.newForm, groupId: e.target.value })} />
                  <input className={`${INPUT} font-mono`} placeholder="Kode klien" value={h.newForm.clientCode} onChange={(e) => h.setNewForm({ ...h.newForm, clientCode: e.target.value })} />
                  <input className={INPUT} placeholder="Nama klien" value={h.newForm.clientName} onChange={(e) => h.setNewForm({ ...h.newForm, clientName: e.target.value })} />
                  <p className="col-span-2 text-[11px] text-slate-500">{`Tenant sudah ada di ATS; Studio hanya mendaftarkannya ke daftar ${h.targetLabel}.`}</p>
                  {h.regError && <div className="col-span-2 text-[11px] text-rose-300">{h.regError}</div>}
                  <div className="col-span-2 flex justify-end gap-2">
                    <button type="button" className={GHOST} disabled={h.registering} onClick={() => h.setShowNew(false)}>Batal</button>
                    <button type="button" className={GHOST} disabled={h.registering || !newOk} onClick={h.registerTenant}>{h.registering ? "Mendaftarkan…" : "Daftarkan"}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!finished && (
          <div className="space-y-2">
            {!h.targetReady && (
              <div className="text-xs text-slate-400 rounded-md border border-slate-800 px-3 py-3">{h.isManual ? "Isi tenant_id tujuan dulu." : "Pilih tenant tujuan dulu."}</div>
            )}
            {h.targetReady && h.previewLoading && <div className="text-xs text-slate-400 rounded-md border border-slate-800 px-3 py-3">Memuat daftar config…</div>}
            {h.targetReady && h.previewError && (
              <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded-md px-3 py-2">{h.previewError}</div>
            )}
            {h.targetReady && h.preview && h.groups.length === 0 && (
              <div className="text-xs text-slate-400 rounded-md border border-slate-800 px-3 py-3">Tidak ada config di sumber.</div>
            )}
            {h.groups.map((g) => (
              <section key={g.domain} className="rounded-md border border-slate-800">
                <header className="flex items-center gap-2 px-3 py-1.5 bg-slate-950/40 border-b border-slate-800">
                  <Check
                    checked={g.addable > 0 && g.checkedCount === g.addable} indeterminate={g.checkedCount > 0 && g.checkedCount < g.addable}
                    label={`Pilih semua ${DOMAIN_TITLE[g.domain]}`} disabled={h.locked || g.addable === 0} onChange={() => h.toggleGroup(g.domain)}
                  />
                  <span className="text-xs font-semibold text-slate-200">{DOMAIN_TITLE[g.domain]}</span>
                  <span className="text-[10px] text-slate-500">{`${g.checkedCount} dari ${g.addable} dipilih`}</span>
                </header>
                <ul className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
                  {g.rows.map((r) => <ConfigRowItem key={r.key} r={r} h={h} />)}
                </ul>
              </section>
            ))}
            {h.preview && h.groups.length > 0 && <div className="text-[11px] text-slate-400">{summary}</div>}

            <label className="block text-xs text-slate-400">
              Catatan (alasan)
              <textarea
                className={`${INPUT} mt-1 w-full h-16 resize-none`} maxLength={MAX_REASON} value={h.reason} disabled={h.locked}
                placeholder="Kenapa config ini disalin? Tercatat di Riwayat."
                onChange={(e) => h.setReason(e.target.value)}
              />
              <span className="block text-right text-[10px] text-slate-500">{`${h.reason.length}/${MAX_REASON}`}</span>
            </label>
          </div>
        )}

        {copyOut && <CopyOutcome data={copyOut} />}
        {sqlOut && (
          <div className="space-y-2">
            <div className="text-xs font-mono text-slate-300 truncate" title={sqlOut.fileName}>{sqlOut.fileName}</div>
            <div className="text-[11px] text-slate-400">File SQL sudah diunduh. Jalankan di tujuan; belum ada yang ditulis oleh Studio.</div>
            {sqlOut.warning && (
              <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">{sqlOut.warning}</div>
            )}
            {sqlOut.beforeSnapshot === "tersimpan" && (
              <div className="text-[11px] text-slate-400">Isi tujuan saat ini sudah dicatat di Riwayat (kondisi saat export, bukan saat SQL dijalankan).</div>
            )}
          </div>
        )}

        {h.error && (
          <div className="text-xs whitespace-pre-line rounded-md px-3 py-2 border text-rose-300 bg-rose-950/40 border-rose-900/50">
            {h.uncertain === "commit" && <div className="font-semibold mb-1">Hasil tidak pasti. Periksa isi tujuan; isi lama sudah disimpan di History.</div>}
            {h.error}
            {h.stale && h.stale.length > 0 && <div className="mt-1 font-mono text-[11px] break-words">{h.stale.join(", ")}</div>}
            {h.stale && <div className="mt-2"><button type="button" className={GHOST} onClick={h.reloadAfterStale}>Muat ulang</button></div>}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {finished ? (
            <>
              <button type="button" className={GHOST} onClick={() => h.setShowHistory(true)}>Lihat Riwayat</button>
              {sqlOut && <button type="button" className={GHOST} onClick={() => downloadSql(sqlOut.sql, sqlOut.fileName)}>Unduh lagi</button>}
              <button type="button" className={PRIMARY} onClick={h.close}>{h.outcome ? "Selesai" : "Tutup"}</button>
            </>
          ) : (
            <>
              {h.blockReason && !h.busy && <p className="flex-1 min-w-0 text-[11px] text-amber-200">{h.blockReason}</p>}
              <button type="button" className={GHOST} onClick={h.close} disabled={h.busy}>Batal</button>
              <button type="button" className={PRIMARY} disabled={!h.canSubmit} onClick={h.submit}>
                {h.sqlMode ? (h.busy ? "Membuat SQL…" : "Unduh SQL") : h.busy ? "Menyalin…" : `Salin ${h.n} config…`}
              </button>
            </>
          )}
        </div>
      </div>

      {h.confirming && (
        <TypeToConfirmDialog
          title={`Tulis ${h.n} config ke ${h.targetLabel} · ${h.targetCode}`}
          description={`${h.nTimpa} config yang sudah ada akan ditimpa. Isi lamanya dicadangkan ke History lebih dulu.`}
          expected={h.targetCode}
          confirmLabel="Salin sekarang"
          onConfirm={h.runCopy}
          onCancel={() => h.setConfirming(false)}
        />
      )}
      {h.showHistory && (
        // Panel Riwayat memakai z-[45]; pembungkus ini mengangkatnya di atas popup
        <div className="relative z-[55]">
          <ChangeBatchesPanel
            left={{ env: h.source.env, tenantId: h.source.tenantId }}
            right={{ env: h.targetEnv, tenantId: h.effTenantId }}
            onClose={() => h.setShowHistory(false)}
          />
        </div>
      )}
    </div>
  );
}
