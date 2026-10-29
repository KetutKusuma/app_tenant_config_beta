import { useEffect, useRef } from "react";

/** Esc menutup dialog saja (bukan layar di bawahnya): listener fase capture + stopPropagation. */
export function useDialogEsc(onEsc: () => void, enabled = true) {
  const ref = useRef(onEsc);
  ref.current = onEsc;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [enabled]);
}
