import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CompareEntry, CompareSide, CompareSummary, Tenant } from "../types";
import { useStudio } from "./StudioContext";

export interface EnvCompareError { message: string; side?: "kiri" | "kanan" }

/** Kanan = staging bila ada dan beda dari kiri; selain itu profil lain pertama (A-Z); kalau tidak ada, env yang sama. */
export function defaultRightEnv(envNames: string[], leftEnv: string): string {
  if (envNames.includes("staging") && leftEnv !== "staging") return "staging";
  const others = envNames.filter((n) => n !== leftEnv).sort((a, b) => a.localeCompare(b));
  return others[0] ?? leftEnv;
}

// State layar Bandingkan antar env: dua sisi (env + tenant), hasil banding semua config, pilihan baris.
// Dipasang saat layar dibuka (komponen induk hanya me-render saat showEnvCompare = true).
export function useEnvCompare() {
  const { targetEnvs, targetEnvName, selectedTenant, configDomain } = useStudio();

  const [left, setLeft] = useState<CompareSide>(() => ({ env: targetEnvName, tenantId: selectedTenant?.tenantId ?? "" }));
  const [right, setRight] = useState<CompareSide>(() => ({
    env: defaultRightEnv(targetEnvs.map((e) => e.name), targetEnvName),
    tenantId: ""
  }));
  const [tenantsByEnv, setTenantsByEnv] = useState<Record<string, Tenant[]>>({});
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<EnvCompareError | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const reqId = useRef(0);

  const loadTenants = useCallback(async (env: string): Promise<Tenant[]> => {
    try {
      const res = await api("/api/tenants", { headers: { "X-Target-Env": env } });
      const json = await res.json().catch(() => ({}));
      const list: Tenant[] = res.ok ? json.data || [] : [];
      setTenantsByEnv((prev) => ({ ...prev, [env]: list }));
      return list;
    } catch {
      setTenantsByEnv((prev) => ({ ...prev, [env]: [] }));
      return [];
    }
  }, []);
  const tenantsFor = (env: string): Tenant[] => tenantsByEnv[env] ?? [];

  // Saat dibuka: muat tenant kedua env; tenant kanan = tenant dengan baseCode sama dengan tenant kiri
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [, rightList] = await Promise.all([loadTenants(left.env), loadTenants(right.env)]);
      if (cancelled) return;
      const base = selectedTenant?.baseCode;
      const match = base ? rightList.find((t) => t.baseCode === base) : undefined;
      if (match) setRight((r) => (r.tenantId ? r : { ...r, tenantId: match.tenantId }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(async () => {
    if (!left.tenantId || !right.tenantId) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        leftEnv: left.env, leftTenant: left.tenantId, rightEnv: right.env, rightTenant: right.tenantId
      });
      const res = await api(`/api/compare?${qs}`);
      const json = await res.json().catch(() => ({}));
      if (id !== reqId.current) return;
      if (!res.ok) {
        setEntries([]);
        setSummary(null);
        setError({ message: json.error || `HTTP ${res.status}`, side: json.side });
        return;
      }
      const list: CompareEntry[] = json.data?.entries ?? [];
      setEntries(list);
      setSummary(json.data?.summary ?? null);
      // Buang centang untuk config yang sudah tidak ada / jadi ganda; pilih baris pertama yang beda
      setChecked((prev) => {
        const ok = new Set(list.filter((e) => e.status !== "ganda").map((e) => e.configType));
        return new Set([...prev].filter((t) => ok.has(t)));
      });
      setSelectedType((cur) => {
        if (cur && list.some((e) => e.configType === cur)) return cur;
        return (list.find((e) => e.status !== "sama") ?? list[0])?.configType ?? null;
      });
    } catch (e: any) {
      if (id !== reqId.current) return;
      setEntries([]);
      setSummary(null);
      setError({ message: e?.message || "Gagal membandingkan" });
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [left.env, left.tenantId, right.env, right.tenantId]);

  useEffect(() => {
    if (!left.tenantId || !right.tenantId) {
      reqId.current++;
      setEntries([]);
      setSummary(null);
      setLoading(false);
      return;
    }
    void reload();
  }, [reload, configDomain, left.tenantId, right.tenantId]);

  const swap = () => {
    setLeft(right);
    setRight(left);
  };

  const toggleChecked = (t: string) => {
    const entry = entries.find((e) => e.configType === t);
    if (!entry || entry.status === "ganda") return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  // Centang semua yang beda + hanya di kiri; baris ganda dilewati
  const checkDifferent = () =>
    setChecked(new Set(entries.filter((e) => e.status === "beda" || e.status === "hanya_kiri").map((e) => e.configType)));

  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => e.configType.toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  return {
    left, right, setLeft, setRight, swap, tenantsFor, loadTenants,
    entries, summary, loading, error, reload,
    selectedType, setSelectedType, checked, toggleChecked, checkDifferent,
    query, setQuery, visibleEntries
  };
}
