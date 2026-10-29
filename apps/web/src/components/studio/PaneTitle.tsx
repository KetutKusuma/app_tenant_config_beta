import type { ReactNode } from "react";
import { ENV_DOT } from "../../types";

// Judul satu sisi diff: titik warna env + nama env, tenant, config_type. Teks dipotong, detail lengkap di title.
export function PaneTitle({
  envLabel, envColor, tenantName, tenantCode, configType, icon, muted
}: {
  envLabel: string;
  envColor: string;
  tenantName?: string;
  tenantCode?: string;
  configType?: string;
  icon?: ReactNode;
  muted?: string;
}) {
  const full = [envLabel, tenantName, tenantCode, configType, muted].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-2 min-w-0 px-3 h-8 text-xs" title={full}>
      {icon ?? <span className={`w-2 h-2 rounded-full shrink-0 ${ENV_DOT[envColor] ?? "bg-slate-400"}`} />}
      <span className="font-semibold text-slate-200 truncate">{envLabel}</span>
      {tenantName && <span className="text-slate-300 truncate">{tenantName}</span>}
      {tenantCode && <span className="font-mono text-[10px] text-slate-500 truncate">{tenantCode}</span>}
      {configType && <span className="font-mono text-[10px] text-slate-500 truncate">{configType}</span>}
      {muted && <span className="text-[10px] text-amber-300/80 truncate">{muted}</span>}
    </div>
  );
}
