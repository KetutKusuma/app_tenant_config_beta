import type { Monaco } from "@monaco-editor/react";

// Tema Monaco "studio-dark": turunan vs-dark dengan latar senada palet slate aplikasi
// dan warna diff yang lembut (baris + karakter tidak menumpuk jadi blok pekat).
export const STUDIO_THEME = "studio-dark";

export function defineStudioTheme(monaco: Monaco) {
  monaco.editor.defineTheme(STUDIO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0b1120",
      "editorGutter.background": "#0b1120",
      "editor.lineHighlightBackground": "#111a2e",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#475569",
      "editorLineNumber.activeForeground": "#cbd5e1",
      "editorIndentGuide.background1": "#1e293b",
      "editorIndentGuide.activeBackground1": "#334155",
      "editor.selectionBackground": "#4f46e566",
      "editor.inactiveSelectionBackground": "#4f46e533",
      "editorWidget.background": "#0f172a",
      "editorWidget.border": "#1e293b",
      "editorStickyScroll.background": "#0b1120",
      "editorStickyScrollHover.background": "#111a2e",
      "scrollbarSlider.background": "#33415566",
      "scrollbarSlider.hoverBackground": "#475569aa",
      "scrollbarSlider.activeBackground": "#64748baa",
      "editorOverviewRuler.border": "#00000000",

      // Diff: warna baris tipis + warna karakter sedikit lebih kuat, tetap terbaca
      "diffEditor.insertedLineBackground": "#10b98110",
      "diffEditor.insertedTextBackground": "#10b9811a",
      "diffEditor.removedLineBackground": "#f43f5e10",
      "diffEditor.removedTextBackground": "#f43f5e1f",
      "diffEditorGutter.insertedLineBackground": "#10b98126",
      "diffEditorGutter.removedLineBackground": "#f43f5e26",
      "diffEditorOverview.insertedForeground": "#10b98199",
      "diffEditorOverview.removedForeground": "#f43f5e99",
      "diffEditor.diagonalFill": "#1e293b99",
      "diffEditor.border": "#1e293b",
      "diffEditor.unchangedRegionBackground": "#0f172a",
      "diffEditor.unchangedRegionForeground": "#94a3b8",
      "diffEditor.unchangedCodeBackground": "#0f172a80"
    }
  });
}
