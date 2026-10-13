import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

// Komponen UI kecil yang dipakai header & toolbar Tenant Studio:
// MenuButton (dropdown), SplitButton (aksi utama + dropdown), Chip (status), PromptDialog (pengganti prompt()).

export interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}
export type MenuEntry = MenuItem | "divider";

// Tutup popover saat klik di luar elemen atau menekan Escape
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function MenuList({ items, onPicked, align }: { items: MenuEntry[]; onPicked: () => void; align: "left" | "right" }) {
  return (
    <div
      role="menu"
      className={`absolute top-full mt-1 ${align === "right" ? "right-0" : "left-0"} z-50 min-w-[240px] py-1 rounded-lg bg-slate-900 border border-slate-700/80 shadow-xl shadow-black/50 text-[11px]`}
    >
      {items.map((it, i) =>
        it === "divider" ? (
          <div key={`d${i}`} className="my-1 h-px bg-slate-800" />
        ) : (
          <button
            key={it.key}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onPicked();
              it.onSelect();
            }}
            className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-left transition disabled:opacity-40 disabled:cursor-not-allowed ${
              it.danger ? "text-rose-300 hover:bg-rose-500/10" : "text-slate-200 hover:bg-slate-800"
            }`}
          >
            <span className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400 flex items-center justify-center">{it.icon}</span>
            <span className="min-w-0">
              <span className="block font-medium">{it.label}</span>
              {it.hint && <span className="block text-[10px] text-slate-500 truncate">{it.hint}</span>}
            </span>
          </button>
        )
      )}
    </div>
  );
}

// Tombol sekunder yang membuka dropdown menu
export function MenuButton({
  label,
  icon,
  items,
  active = false,
  align = "right",
  title
}: {
  label: string;
  icon?: ReactNode;
  items: MenuEntry[];
  active?: boolean;
  align?: "left" | "right";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={`h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[11px] font-medium transition ${
          open || active ? "bg-slate-800 text-white" : "text-slate-300 hover:text-white hover:bg-slate-800/70"
        }`}
      >
        {icon}
        {label}
        {active && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
        <ChevronDown className={`w-3 h-3 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <MenuList items={items} onPicked={() => setOpen(false)} align={align} />}
    </div>
  );
}

// Aksi utama + panah dropdown untuk aksi turunan
export function SplitButton({
  label,
  icon,
  onClick,
  items,
  disabled = false
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  items: MenuEntry[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={onClick}
        disabled={disabled}
        className="h-7 pl-3 pr-2.5 rounded-l-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-sm shadow-indigo-950/60 transition disabled:opacity-40"
      >
        {icon}
        {label}
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Opsi simpan lainnya"
        className="h-7 px-1.5 rounded-r-md bg-indigo-600 hover:bg-indigo-500 text-white border-l border-indigo-400/40 flex items-center transition disabled:opacity-40"
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && <MenuList items={items} onPicked={() => setOpen(false)} align="right" />}
    </div>
  );
}

const CHIP_TONES = {
  amber: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  rose: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  slate: "bg-slate-500/10 text-slate-300 ring-slate-500/30"
} as const;

// Penanda status (bukan tombol aksi). Jika diberi onClick, chip bisa diklik sebagai shortcut.
export function Chip({
  tone,
  children,
  onClick,
  title
}: {
  tone: keyof typeof CHIP_TONES;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const cls = `inline-flex items-center gap-1 h-5 px-2 rounded-full ring-1 ring-inset text-[10px] font-medium whitespace-nowrap ${CHIP_TONES[tone]}`;
  return onClick ? (
    <button onClick={onClick} title={title} className={`${cls} hover:brightness-125 transition`}>
      {children}
    </button>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

// Dialog input teks (pengganti window.prompt) — dipakai untuk catatan commit saat Save
export function PromptDialog({
  title,
  description,
  label,
  defaultValue,
  confirmLabel = "Simpan",
  onConfirm,
  onCancel
}: {
  title: string;
  description?: ReactNode;
  label: string;
  defaultValue: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onConfirm(value.trim());
        }}
        className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            {description && <div className="mt-1 text-[11px] text-slate-400">{description}</div>}
          </div>
          <button type="button" onClick={onCancel} className="text-slate-500 hover:text-slate-200" title="Batal">
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="block text-[11px] text-slate-400">
          {label}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition">
            Batal
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

// Menu klik-kanan (shortcut, bukan satu-satunya jalan ke aksi tersebut)
export interface ContextMenuState {
  x: number;
  y: number;
  title?: string;
  items: MenuEntry[];
}
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useDismiss(true, onClose);
  useEffect(() => {
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  // Jaga agar menu tidak keluar layar
  const left = Math.min(menu.x, window.innerWidth - 260);
  const top = Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 34);
  return (
    <div ref={ref} className="fixed z-[80]" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      <div className="relative">
        <div className="min-w-[240px] py-1 rounded-lg bg-slate-900 border border-slate-700/80 shadow-xl shadow-black/50 text-[11px]">
          {menu.title && (
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-mono text-slate-500 truncate border-b border-slate-800 mb-1">{menu.title}</div>
          )}
          {menu.items.map((it, i) =>
            it === "divider" ? (
              <div key={`d${i}`} className="my-1 h-px bg-slate-800" />
            ) : (
              <button
                key={it.key}
                disabled={it.disabled}
                onClick={() => {
                  onClose();
                  it.onSelect();
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  it.danger ? "text-rose-300 hover:bg-rose-500/10" : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                <span className="w-3.5 h-3.5 shrink-0 text-slate-400 flex items-center justify-center">{it.icon}</span>
                <span className="font-medium">{it.label}</span>
                {it.hint && <span className="ml-auto pl-3 text-[10px] text-slate-500">{it.hint}</span>}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// Indikator langkah untuk alur bertahap (mis. Sync Center: Pilih → Pratinjau → Hasil)
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-[11px]">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "active" : "todo";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                state === "active"
                  ? "bg-emerald-600 text-white"
                  : state === "done"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {n}
            </span>
            <span className={state === "todo" ? "text-slate-500" : "text-slate-200 font-medium"}>{label}</span>
            {n < steps.length && <span className="w-6 h-px bg-slate-700" />}
          </li>
        );
      })}
    </ol>
  );
}

// Konfirmasi dengan mengetik teks persis (mis. nama target env yang dilindungi)
export function TypeToConfirmDialog({
  title,
  description,
  expected,
  confirmLabel = "Lanjutkan",
  onConfirm,
  onCancel
}: {
  title: string;
  description?: ReactNode;
  expected: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const ok = value.trim() === expected;
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onConfirm();
        }}
        className="w-full max-w-md rounded-xl bg-slate-900 border border-rose-500/40 shadow-2xl p-5 space-y-4"
      >
        <div>
          <h3 className="text-sm font-semibold text-rose-200">{title}</h3>
          {description && <div className="mt-1 text-[11px] text-slate-400">{description}</div>}
        </div>
        <label className="block text-[11px] text-slate-400">
          Ketik <code className="px-1 rounded bg-slate-800 text-rose-200 font-mono">{expected}</code> untuk melanjutkan
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-rose-500"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-slate-800 transition">
            Batal
          </button>
          <button
            type="submit"
            disabled={!ok}
            className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
