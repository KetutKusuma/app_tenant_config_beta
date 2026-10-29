import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { ArrowLeftRight, ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { defineStudioTheme, STUDIO_THEME } from "../../lib/monacoTheme";
import { useStudio } from "../../studio/StudioContext";
import { useEnvCompare } from "../../studio/useEnvCompare";
import { ENV_DOT, type CompareSide, type CompareStatus, type TargetEnvInfo } from "../../types";
import { CopyConfigsDialog } from "./CopyConfigsDialog";
import { ExportSqlDialog } from "./ExportSqlDialog";
import { PaneTitle } from "./PaneTitle";

type DiffEditorInstance = Parameters<DiffOnMount>[0];

const DIFF_OPTIONS = {
  fontSize: 13,
  minimap: { enabled: false },
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: false,
  readOnly: true,
  originalEditable: false,
  hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 5, revealLineCount: 20 },
  renderOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  overviewRulerBorder: false
};

const STATUS_CHIP: Record<CompareStatus, { label: (n: number) => string; cls: string; title?: string }> = {
  sama: { label: () => "Sama", cls: "bg-emerald-500/10 text-emerald-300" },
  beda: { label: (n) => `Beda · ${n}`, cls: "bg-amber-500/10 text-amber-300" },
  hanya_kiri: { label: () => "Hanya Kiri", cls: "bg-indigo-500/15 text-indigo-300" },
  hanya_kanan: { label: () => "Hanya Kanan", cls: "bg-purple-500/15 text-purple-300" },
  ganda: {
    label: () => "Ganda",
    cls: "bg-rose-500/15 text-rose-300 border border-rose-500/40",
    title: "Ada lebih dari 1 config aktif bertipe ini; bereskan dulu"
  }
};

const SELECT_CLS =
  "bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 max-w-[180px] truncate focus:outline-none focus:border-indigo-500";

export function EnvCompareScreen() {
  const { showEnvCompare } = useStudio();
  // Hook state hanya hidup selama layar terbuka: setiap dibuka, default dihitung ulang
  return showEnvCompare ? <EnvCompareBody /> : null;
}

function SidePicker({
  label, side, errorMsg, tenantError, envs, tenants, onEnv, onTenant
}: {
  label: string;
  side: CompareSide;
  errorMsg?: string;
  tenantError?: string;
  envs: TargetEnvInfo[];
  tenants: { tenantId: string; name: string; code: string }[];
  onEnv: (env: string) => void;
  onTenant: (id: string) => void;
}) {
  const env = envs.find((e) => e.name === side.env);
  return (
    <div className="flex items-center gap-1.5" title={tenantError || errorMsg}>
      <span className="text-slate-500 text-xs">{label}</span>
      <span className={`w-2 h-2 rounded-full shrink-0 ${ENV_DOT[env?.color ?? ""] ?? "bg-slate-400"}`} />
      <select className={SELECT_CLS} value={side.env} onChange={(e) => onEnv(e.target.value)} title="Env">
        {envs.map((e) => <option key={e.name} value={e.name}>{e.label}</option>)}
      </select>
      <select
        className={`${SELECT_CLS} ${errorMsg || tenantError ? "border-rose-500/60" : ""}`}
        disabled={Boolean(tenantError)}
        value={side.tenantId}
        onChange={(e) => onTenant(e.target.value)}
        title="Tenant"
      >
        <option value="">Pilih tenant…</option>
        {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name} ({t.code})</option>)}
      </select>
      {tenantError && <span className="text-[10px] text-rose-300 max-w-[220px] truncate" title={tenantError}>{tenantError}</span>}
    </div>
  );
}

function EnvCompareBody() {
  const { targetEnvs, setShowEnvCompare } = useStudio();
  const c = useEnvCompare();
  const diffRef = useRef<DiffEditorInstance | null>(null);
  const envReq = useRef({ left: 0, right: 0 });
  const [dialog, setDialog] = useState<"export" | "copy" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Esc di dalam Monaco (mis. menutup widget cari) bukan untuk menutup layar
      if ((e.target as HTMLElement | null)?.closest?.(".monaco-editor")) return;
      setShowEnvCompare(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowEnvCompare]);

  const envInfo = (name: string) => targetEnvs.find((e) => e.name === name);
  const tenantInfo = (side: CompareSide) => c.tenantsFor(side.env).find((t) => t.tenantId === side.tenantId);

  // Ganti env sebuah sisi: coba pertahankan tenant yang sama lewat baseCode, kalau tidak ada kosongkan
  const changeEnv = async (which: "left" | "right", env: string) => {
    const cur = which === "left" ? c.left : c.right;
    const setter = which === "left" ? c.setLeft : c.setRight;
    const base = tenantInfo(cur)?.baseCode;
    const req = ++envReq.current[which];
    setter({ env, tenantId: "" });
    const list = await c.loadTenants(env);
    // Abaikan hasil usang: pengguna sudah mengganti env sisi ini lagi
    if (req !== envReq.current[which]) return;
    const match = base ? list.find((t) => t.baseCode === base) : undefined;
    if (match) setter({ env, tenantId: match.tenantId });
  };

  const entry = c.entries.find((e) => e.configType === c.selectedType) ?? null;
  const [diffCount, setDiffCount] = useState<number | null>(null);
  const handleMount: DiffOnMount = (editor) => {
    diffRef.current = editor;
    const update = () => setDiffCount(editor.getLineChanges()?.length ?? null);
    update();
    editor.onDidUpdateDiff(update);
  };
  const goToDiff = (target: "next" | "previous") => {
    const ed = diffRef.current;
    if (!ed) return;
    ed.goToDiff(target);
    ed.getModifiedEditor().focus();
  };

  const leftText = useMemo(() => (entry?.left?.value == null ? "" : JSON.stringify(entry.left.value, null, 2)), [entry]);
  const rightText = useMemo(() => (entry?.right?.value == null ? "" : JSON.stringify(entry.right.value, null, 2)), [entry]);
  const leftEnv = envInfo(c.left.env);
  const rightEnv = envInfo(c.right.env);
  const leftTenant = tenantInfo(c.left);
  const rightTenant = tenantInfo(c.right);
  const ready = Boolean(c.left.tenantId && c.right.tenantId);
  const s = c.summary;

  return (
    <div className="fixed inset-0 z-40 bg-slate-950 text-slate-100 flex flex-col">
      {/* Bar atas */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center gap-2 flex-wrap">
        <SidePicker
          label="Kiri" side={c.left} tenantError={c.tenantErrorFor(c.left.env)} envs={targetEnvs} tenants={c.tenantsFor(c.left.env)}
          errorMsg={c.error?.side === "kiri" ? c.error.message : undefined}
          onEnv={(e) => changeEnv("left", e)} onTenant={(id) => c.setLeft({ ...c.left, tenantId: id })}
        />
        <button
          onClick={c.swap}
          className="h-7 w-7 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
          title="Tukar kiri dan kanan"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>
        <SidePicker
          label="Kanan" side={c.right} tenantError={c.tenantErrorFor(c.right.env)} envs={targetEnvs} tenants={c.tenantsFor(c.right.env)}
          errorMsg={c.error?.side === "kanan" ? c.error.message : undefined}
          onEnv={(e) => changeEnv("right", e)} onTenant={(id) => c.setRight({ ...c.right, tenantId: id })}
        />
        <span className="flex-1" />
        {s && (
          <span className="text-xs text-slate-500 tabular-nums">
            {`${s.total} config · ${s.sama} sama · ${s.beda} beda · ${s.hanyaKiri + s.hanyaKanan} hanya satu sisi`}
            {s.ganda > 0 && <span className="text-rose-300">{` · ${s.ganda} ganda`}</span>}
          </span>
        )}
        {/* SLOT-TASK-13: tombol "Riwayat" ditambahkan di sini */}
        <div id="env-compare-actions" className="flex items-center gap-1">
          <button
            onClick={() => setDialog("copy")}
            disabled={!ready || c.loading}
            className="px-2.5 py-1 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition disabled:opacity-40"
            title={`Salin config kiri ke ${rightEnv?.label ?? c.right.env}`}
          >
            Salin ke Kanan…
          </button>
          <button
            onClick={() => setDialog("export")}
            disabled={!ready || c.checked.size === 0}
            className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-40"
            title="Buat file SQL dari config yang dicentang"
          >
            {`Export SQL (${c.checked.size})`}
          </button>
        </div>
        <button
          onClick={() => setShowEnvCompare(false)}
          className="h-7 w-7 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition"
          title="Tutup (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Daftar config */}
        <div className="w-[290px] shrink-0 border-r border-slate-800 flex flex-col min-h-0">
          <div className="p-2 space-y-1.5 border-b border-slate-800">
            <input
              value={c.query}
              onChange={(e) => c.setQuery(e.target.value)}
              placeholder="Cari config…"
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
            />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500 tabular-nums">{c.checked.size} dipilih</span>
              <button
                onClick={c.checkDifferent}
                disabled={!ready}
                className="text-slate-400 hover:text-slate-200 hover:bg-slate-800 px-1.5 py-0.5 rounded-md transition disabled:opacity-40"
                title="Centang semua config yang beda atau hanya ada di kiri (baris Ganda dilewati)"
              >
                Pilih yang beda
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!ready && <div className="p-3 text-xs text-slate-500">Pilih tenant di kedua sisi untuk mulai membandingkan.</div>}
            {ready && c.loading && <div className="p-3 text-xs text-slate-500">Membandingkan…</div>}
            {ready && !c.loading && c.error && !c.error.side && <div className="p-3 text-xs text-rose-300">{c.error.message}</div>}
            {ready && !c.loading && !c.error && c.visibleEntries.length === 0 && (
              <div className="p-3 text-xs text-slate-500">{c.entries.length === 0 ? "Tidak ada config." : "Tidak ada yang cocok."}</div>
            )}
            {c.visibleEntries.map((e) => {
              const chip = STATUS_CHIP[e.status];
              const active = e.configType === c.selectedType;
              const ganda = e.status === "ganda";
              return (
                <div
                  key={e.configType}
                  onClick={() => c.setSelectedType(e.configType)}
                  className={`flex items-center gap-2 px-2 py-1.5 border-b border-slate-900 cursor-pointer text-xs ${
                    active ? "bg-indigo-950/60 border-l-2 border-l-indigo-400" : "hover:bg-slate-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={c.checked.has(e.configType)}
                    disabled={ganda}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={() => c.toggleChecked(e.configType)}
                    title={ganda ? chip.title : "Pilih config ini"}
                    className="accent-indigo-500 disabled:opacity-30"
                  />
                  <span className="font-mono text-[11px] text-slate-200 truncate flex-1" title={e.configType}>{e.configType}</span>
                  <span className={`text-[10px] px-1.5 py-px rounded-full whitespace-nowrap ${chip.cls}`} title={chip.title}>
                    {chip.label(e.changeCount)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Diff */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {c.error?.side && (
            <div className="px-3 py-1.5 text-xs text-rose-300 bg-rose-950/40 border-b border-rose-900/50">
              {`Sisi ${c.error.side}: ${c.error.message}`}
            </div>
          )}
          {entry ? (
            <>
              <div className="bg-slate-900 border-b border-slate-800">
                <div className="flex items-center justify-end gap-0.5 px-2 h-7">
                  <span className="text-[10px] text-slate-400 tabular-nums px-1" title="Jumlah perubahan antara kiri dan kanan (dihitung server)">
                    {`${entry.changeCount} perubahan`}
                  </span>
                  <button
                    onClick={() => goToDiff("previous")}
                    disabled={!diffCount}
                    className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Perubahan sebelumnya"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => goToDiff("next")}
                    disabled={!diffCount}
                    className="h-6 w-6 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Perubahan berikutnya"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2">
                  <PaneTitle
                    envLabel={leftEnv?.label ?? c.left.env} envColor={leftEnv?.color ?? "slate"}
                    tenantName={leftTenant?.name} tenantCode={leftTenant?.code} configType={entry.configType}
                    muted={entry.left ? undefined : "(tidak ada di kiri)"}
                  />
                  <PaneTitle
                    envLabel={rightEnv?.label ?? c.right.env} envColor={rightEnv?.color ?? "slate"}
                    tenantName={rightTenant?.name} tenantCode={rightTenant?.code} configType={entry.configType}
                    muted={entry.right ? undefined : "(tidak ada di kanan)"}
                  />
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <DiffEditor
                  height="100%"
                  language="json"
                  theme={STUDIO_THEME}
                  beforeMount={defineStudioTheme}
                  onMount={handleMount}
                  original={leftText}
                  modified={rightText}
                  options={DIFF_OPTIONS}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
              {ready ? "Pilih config di daftar untuk melihat perbedaannya." : "Pilih tenant di kedua sisi."}
            </div>
          )}
        </div>
      </div>
      {dialog === "export" && (
        <ExportSqlDialog
          left={c.left} right={c.right} checkedTypes={[...c.checked]}
          tenantsFor={c.tenantsFor} loadTenants={c.loadTenants} onClose={() => setDialog(null)}
        />
      )}
      {dialog === "copy" && (
        <CopyConfigsDialog
          left={c.left} right={c.right} leftTenant={leftTenant} rightTenant={rightTenant} entries={c.entries}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); void c.reload(); }}
        />
      )}
    </div>
  );
}
