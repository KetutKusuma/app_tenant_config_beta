import { useEffect, useRef } from "react";

/** Listener selalu aktif; handler memutuskan (sibuk = abaikan). Esc menutup dialog saja (bukan layar di bawahnya): listener fase capture + stopPropagation. */
export function useDialogEsc(onEsc: () => void) {
  const ref = useRef(onEsc);
  ref.current = onEsc;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc di dalam Monaco (mis. menutup widget cari) ditangani Monaco
      if ((e.target as HTMLElement | null)?.closest?.(".monaco-editor")) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
}
