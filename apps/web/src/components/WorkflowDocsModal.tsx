import { useMemo, useState } from "react";
import { X, Search, Workflow, BookOpen, Copy, Check, Cpu, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import coreDoc from "../docs/workflow/core.json";
import executorDocs from "../docs/workflow/executors.json";

// Panduan khusus Workflow Pipeline (public.pipeline_workflow_configurations).
// Isi disusun dari source ATS backend: apps/ats/src/process/workflow (lihat docs/workflow/*.json).

type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; lang?: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "callout"; tone: "info" | "warning" | "danger"; text: string };

interface CoreSection {
  id: string;
  title: string;
  summary: string;
  blocks: Block[];
}

interface FieldDoc {
  key: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ExecutorDoc {
  name: string;
  category: string;
  file: string;
  summary: string;
  behavior: string[];
  configFields: FieldDoc[];
  payloadFields: FieldDoc[];
  contextReads: string[];
  output: string;
  sideEffects: string[];
  errors: string[];
  usedInWorkflows: string[];
  example: unknown;
  exampleSource: string;
  notes: string[];
}

const CORE = (coreDoc as { sections: CoreSection[] }).sections;
const EXECUTORS = [...(executorDocs as ExecutorDoc[])].sort((a, b) => a.name.localeCompare(b.name));

const CALLOUT_STYLE = {
  info: { cls: "bg-sky-500/10 text-sky-200 ring-sky-500/30", Icon: Info },
  warning: { cls: "bg-amber-500/10 text-amber-200 ring-amber-500/30", Icon: AlertTriangle },
  danger: { cls: "bg-rose-500/10 text-rose-200 ring-rose-500/30", Icon: ShieldAlert }
} as const;

// Render `teks` di dalam backtick sebagai inline code
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="px-1 rounded bg-slate-800 text-teal-200 font-mono text-[11px]">{p.slice(1, -1)}</code>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function CodeBlock({ code, id, copied, onCopy }: { code: string; id: string; copied: string | null; onCopy: (code: string, id: string) => void }) {
  return (
    <div className="relative group">
      <pre className="p-3 rounded-lg bg-slate-950 ring-1 ring-inset ring-slate-800 text-[11px] font-mono text-slate-200 overflow-x-auto leading-relaxed">{code}</pre>
      <button
        onClick={() => onCopy(code, id)}
        className="absolute top-2 right-2 p-1 rounded-md bg-slate-800 text-slate-300 hover:text-white opacity-0 group-hover:opacity-100 transition"
        title="Salin"
      >
        {copied === id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

function FieldTable({ fields }: { fields: FieldDoc[] }) {
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-slate-800">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-950/60 text-slate-400">
          <tr>
            <th className="text-left font-medium px-3 py-1.5 w-48">Field</th>
            <th className="text-left font-medium px-3 py-1.5 w-56">Tipe</th>
            <th className="text-left font-medium px-3 py-1.5">Keterangan</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.key} className="border-t border-slate-800/70 align-top">
              <td className="px-3 py-1.5 font-mono text-slate-100">
                {f.key}
                {f.required && <span className="ml-1 text-rose-400" title="Wajib">*</span>}
              </td>
              <td className="px-3 py-1.5 font-mono text-teal-200/90 break-words">{f.type}</td>
              <td className="px-3 py-1.5 text-slate-300"><Inline text={f.description} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

function BulletList({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`space-y-1 text-xs text-slate-300 leading-relaxed pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-slate-600`}>
      {items.map((it, i) => <li key={i}><Inline text={it} /></li>)}
    </Tag>
  );
}

export function WorkflowDocsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [active, setActive] = useState<string>(`core:${CORE[0]?.id}`);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const coreList = useMemo(
    () => CORE.filter((s) => !q || `${s.title} ${s.summary} ${JSON.stringify(s.blocks)}`.toLowerCase().includes(q)),
    [q]
  );
  const executorGroups = useMemo(() => {
    const groups = new Map<string, ExecutorDoc[]>();
    EXECUTORS.filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q)).forEach((e) => {
      groups.set(e.category, [...(groups.get(e.category) || []), e]);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [q]);

  if (!isOpen) return null;

  const copy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const [kind, key] = active.split(/:(.*)/s);
  const coreSection = kind === "core" ? CORE.find((s) => s.id === key) : undefined;
  const executor = kind === "exec" ? EXECUTORS.find((e) => e.name === key) : undefined;

  const navBtn = (id: string, label: string, isActive: boolean, mono = false) => (
    <button
      key={id}
      onClick={() => setActive(id)}
      className={`w-full text-left px-2.5 py-1.5 rounded-md text-[11px] truncate transition ${mono ? "font-mono" : "font-medium"} ${
        isActive ? "bg-teal-600/20 text-teal-100 ring-1 ring-inset ring-teal-500/30" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
      }`}
      title={label}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-6xl h-[90vh] rounded-xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 ring-1 ring-inset ring-teal-500/30 flex items-center justify-center text-teal-300 shrink-0">
              <Workflow className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-100 truncate">Panduan Workflow Pipeline</h2>
              <p className="text-[11px] text-slate-400 truncate">
                public.pipeline_workflow_configurations · {EXECUTORS.length} executor · sumber: ATS <code className="font-mono">src/process/workflow</code>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari executor, field, workflow…"
                className="w-64 bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
              />
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition" title="Tutup">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Navigasi */}
          <nav className="w-64 shrink-0 border-r border-slate-800 bg-slate-950/40 overflow-y-auto p-2 space-y-3">
            <div>
              <div className="px-2 py-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <BookOpen className="w-3 h-3" /> Konsep
              </div>
              {coreList.map((s) => navBtn(`core:${s.id}`, s.title, active === `core:${s.id}`))}
            </div>
            {executorGroups.map(([category, items]) => (
              <div key={category}>
                <div className="px-2 py-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1.5"><Cpu className="w-3 h-3" /> {category}</span>
                  <span className="font-mono">{items.length}</span>
                </div>
                {items.map((e) => navBtn(`exec:${e.name}`, e.name, active === `exec:${e.name}`, true))}
              </div>
            ))}
            {!coreList.length && !executorGroups.length && (
              <p className="px-2 py-4 text-[11px] text-slate-500">Tidak ada hasil untuk "{query}".</p>
            )}
          </nav>

          {/* Konten */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl p-6 space-y-5">
              {coreSection && (
                <>
                  <header>
                    <h1 className="text-base font-bold text-slate-100">{coreSection.title}</h1>
                    <p className="text-xs text-slate-400 mt-0.5"><Inline text={coreSection.summary} /></p>
                  </header>
                  <div className="space-y-3 border-t border-slate-800 pt-4">
                    {coreSection.blocks.map((b, i) => {
                      const id = `${coreSection.id}-${i}`;
                      if (b.type === "p") return <p key={id} className="text-xs text-slate-300 leading-relaxed"><Inline text={b.text} /></p>;
                      if (b.type === "list") return <BulletList key={id} items={b.items} />;
                      if (b.type === "code") return <CodeBlock key={id} id={id} code={b.code} copied={copied} onCopy={copy} />;
                      if (b.type === "callout") {
                        const { cls, Icon } = CALLOUT_STYLE[b.tone] || CALLOUT_STYLE.info;
                        return (
                          <div key={id} className={`flex gap-2 p-3 rounded-lg ring-1 ring-inset text-xs leading-relaxed ${cls}`}>
                            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span><Inline text={b.text} /></span>
                          </div>
                        );
                      }
                      return (
                        <div key={id} className="overflow-x-auto rounded-lg ring-1 ring-inset ring-slate-800">
                          <table className="w-full text-[11px]">
                            <thead className="bg-slate-950/60 text-slate-400">
                              <tr>{b.headers.map((h) => <th key={h} className="text-left font-medium px-3 py-1.5">{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {b.rows.map((r, ri) => (
                                <tr key={ri} className="border-t border-slate-800/70 align-top">
                                  {r.map((c, ci) => <td key={ci} className="px-3 py-1.5 text-slate-300"><Inline text={c} /></td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {executor && (
                <>
                  <header className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-base font-bold font-mono text-slate-100">{executor.name}</h1>
                      <span className="text-[10px] px-2 h-5 inline-flex items-center rounded-full bg-teal-500/10 text-teal-300 ring-1 ring-inset ring-teal-500/30">{executor.category}</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed"><Inline text={executor.summary} /></p>
                    <p className="text-[10px] font-mono text-slate-500">apps/ats/src/{executor.file}</p>
                  </header>

                  {executor.behavior.length > 0 && (
                    <Section title="Cara kerja"><BulletList items={executor.behavior} ordered /></Section>
                  )}

                  <Section title="Config (pipelines[].config)">
                    {executor.configFields.length ? <FieldTable fields={executor.configFields} /> : <p className="text-xs text-slate-500">Tidak membutuhkan config.</p>}
                  </Section>

                  {executor.payloadFields.length > 0 && (
                    <Section title="Payload DTO (hasil resolve config.payload)">
                      <FieldTable fields={executor.payloadFields} />
                    </Section>
                  )}

                  {executor.contextReads.length > 0 && (
                    <Section title="Membaca dari ctx"><BulletList items={executor.contextReads.map((c) => `\`${c}\``)} /></Section>
                  )}

                  <Section title="Output ke ctx">
                    <p className="text-xs text-slate-300 leading-relaxed"><Inline text={executor.output} /></p>
                  </Section>

                  {executor.sideEffects.length > 0 && <Section title="Efek samping"><BulletList items={executor.sideEffects} /></Section>}
                  {executor.errors.length > 0 && <Section title="Error yang mungkin muncul"><BulletList items={executor.errors} /></Section>}

                  {executor.usedInWorkflows.length > 0 && (
                    <Section title="Dipakai di workflow">
                      <div className="flex flex-wrap gap-1.5">
                        {executor.usedInWorkflows.map((w) => (
                          <span key={w} className="text-[10px] font-mono px-2 h-5 inline-flex items-center rounded-full bg-slate-800 text-slate-300">{w}</span>
                        ))}
                      </div>
                    </Section>
                  )}

                  {executor.example != null && (
                    <Section title="Contoh pipeline entry">
                      <CodeBlock id={`ex-${executor.name}`} code={JSON.stringify(executor.example, null, 2)} copied={copied} onCopy={copy} />
                      <p className="text-[10px] text-slate-500">Sumber: <span className="font-mono">{executor.exampleSource}</span></p>
                    </Section>
                  )}

                  {executor.notes.length > 0 && (
                    <div className="flex gap-2 p-3 rounded-lg ring-1 ring-inset bg-amber-500/10 text-amber-100 ring-amber-500/30 text-xs leading-relaxed">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-300" />
                      <BulletList items={executor.notes} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
