import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CompareEntry, CompareSide, CompareSummary, Tenant } from "../types";
import { isDirty } from "./compareEdit";
import { useStudio } from "./StudioContext";

export type CompareDraftSide = "left" | "right";
export interface CompareDrafts { left?: string; right?: string }
const NO_DRAFTS: CompareDrafts = {};
// version_token baris DB saat draf sisi itu pertama dibuat; dikirim sebagai expectedVersion supaya perubahan
// konkuren tetap memicu 409 walau perbandingan sudah dimuat ulang dengan draf dipertahankan
const NO_BASES: CompareDrafts = {};

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
  const [tenantErrors, setTenantErrors] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<EnvCompareError | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const reqId = useRef(0);
  // Draf editan per sisi, hanya untuk config terpilih. Disimpan bersama kunci konteksnya (config + kedua sisi):
  // kalau konteks berubah, draf langsung dianggap kosong pada render itu juga (tanpa menunggu efek), lalu dibuang.
  // reload() sengaja tidak menyentuh draf.
  const draftKey = `${selectedType ?? ""}|${left.env}|${left.tenantId}|${right.env}|${right.tenantId}`;
  const [draftState, setDraftState] = useState<{ key: string; drafts: CompareDrafts; bases: CompareDrafts }>({
    key: draftKey, drafts: NO_DRAFTS, bases: NO_BASES
  });
  const drafts = draftState.key === draftKey ? draftState.drafts : NO_DRAFTS;
  const draftBase = draftState.key === draftKey ? draftState.bases : NO_BASES;
  useEffect(() => {
    setDraftState((prev) => (prev.key === draftKey ? prev : { key: draftKey, drafts: NO_DRAFTS, bases: NO_BASES }));
  }, [draftKey]);
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const setDraft = useCallback((side: CompareDraftSide, text: string | undefined, baseVersion?: string) => {
    // Closure usang (mis. selesai simpan setelah user pindah config): jangan timpa draf konteks yang baru
    if (draftKey !== draftKeyRef.current) return;
    setDraftState((prev) => {
      const base = prev.key === draftKey ? prev.drafts : NO_DRAFTS;
      if (base[side] === text && prev.key === draftKey) return prev;
      const baseBases = prev.key === draftKey ? prev.bases : NO_BASES;
      const next = { ...base };
      const bases = { ...baseBases };
      if (text === undefined) {
        delete next[side];
        delete bases[side];
      } else {
        next[side] = text;
        // Hanya saat draf pertama dibuat; ketikan berikutnya mempertahankan versi awal
        if (bases[side] === undefined && baseVersion !== undefined) bases[side] = baseVersion;
      }
      return { key: draftKey, drafts: next, bases };
    });
  }, [draftKey]);

  const loadTenants = useCallback(async (env: string): Promise<Tenant[]> => {
    try {
      const res = await api("/api/tenants", { headers: { "X-Target-Env": env } });
      const json = await res.json().catch(() => ({}));
      const list: Tenant[] = res.ok ? json.data || [] : [];
      const msg = !res.ok ? json.error || `HTTP ${res.status}` : json.targetError ? `DB target tidak terjangkau: ${json.targetError}` : "";
      setTenantErrors((prev) => ({ ...prev, [env]: msg }));
      setTenantsByEnv((prev) => ({ ...prev, [env]: list }));
      return list;
    } catch (e: any) {
      setTenantErrors((prev) => ({ ...prev, [env]: e?.message || "Gagal memuat daftar tenant" }));
      setTenantsByEnv((prev) => ({ ...prev, [env]: [] }));
      return [];
    }
  }, []);
  const tenantsFor = (env: string): Tenant[] => tenantsByEnv[env] ?? [];
  const tenantErrorFor = (env: string): string => tenantErrors[env] ?? "";

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
    // Jangan biarkan baris/diff sisi lama tampil di bawah judul sisi baru, dan jangan ada centang usang
    setEntries([]);
    setSummary(null);
    setChecked(new Set());
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
        setChecked(new Set());
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
      setChecked(new Set());
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
      setChecked(new Set());
      setSelectedType(null);
      setError(null);
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

  const selectedEntry = entries.find((e) => e.configType === selectedType) ?? null;
  // Selama reload (entries sementara kosong) baris DB belum ada: draf apa pun dianggap belum disimpan
  const hasDirty = selectedEntry
    ? isDirty(drafts.left, selectedEntry.left) || isDirty(drafts.right, selectedEntry.right)
    : drafts.left !== undefined || drafts.right !== undefined;
  // Jalankan aksi yang membuang draf; kalau ada editan belum disimpan, minta konfirmasi dulu
  const guard = (action: () => void) => {
    if (hasDirty) {
      if (!confirm(`Ada editan yang belum disimpan di ${selectedEntry?.configType ?? selectedType ?? ""}. Buang editan?`)) return;
      setDraftState((prev) => ({ key: prev.key, drafts: NO_DRAFTS, bases: NO_BASES }));
    }
    action();
  };

  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => e.configType.toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  return {
    left, right, setLeft, setRight, swap, tenantsFor, tenantErrorFor, loadTenants,
    entries, summary, loading, error, reload,
    selectedType, setSelectedType, checked, toggleChecked, checkDifferent,
    query, setQuery, visibleEntries,
    drafts, draftBase, setDraft, hasDirty, guard
  };
}
