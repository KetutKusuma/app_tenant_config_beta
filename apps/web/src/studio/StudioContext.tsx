import { createContext, useContext } from "react";
import type { AppProps } from "../types";
import { useStudioState } from "./useStudioState";
import { useCoreActions } from "./useCoreActions";
import { useEditorActions } from "./useEditorActions";
import { useCrudActions } from "./useCrudActions";
import { useSyncCenter } from "./useSyncCenter";
import { useCompareActions } from "./useCompareActions";

// Menggabungkan semua state & aksi Tenant Studio menjadi satu objek yang dibagikan lewat context,
// sehingga setiap bagian UI (components/studio/*) cukup memanggil useStudio().
export function useStudioRoot(props: AppProps) {
  const state = useStudioState(props);
  const core = useCoreActions(state);
  const ctx = { ...state, ...core };
  const editor = useEditorActions(ctx);
  const crud = useCrudActions(ctx);
  const sync = useSyncCenter(ctx);
  const compare = useCompareActions(ctx);
  return { ...ctx, ...editor, ...crud, ...sync, ...compare };
}

export type Studio = ReturnType<typeof useStudioRoot>;

const StudioContext = createContext<Studio | null>(null);
export const StudioProvider = StudioContext.Provider;

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error("useStudio() harus dipakai di dalam <StudioProvider>");
  return studio;
}
