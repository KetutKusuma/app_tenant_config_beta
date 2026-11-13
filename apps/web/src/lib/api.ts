import { UNAUTHORIZED_EVENT } from "../components/AuthGate";
import type { ConfigDomain, ServiceKey } from "../types";

// Domain konfigurasi aktif: menentukan tabel DB yang dipakai BFF (lewat header X-Config-Domain)
let activeDomain: ConfigDomain = "tenant_config";
// Target env (ats_db) aktif; kosong = BFF memakai preferensi user / default server
let activeTargetEnv = "";
// Layanan aktif (ats_db, hris_db, ...); selalu dikirim karena BFF menolak operasi tulis tanpa header ini
let activeService: ServiceKey = "ats";
// Dipasang oleh App: minta user mengetik nama env yang dilindungi sebelum operasi tulis
let envConfirmHandler: ((env: string) => Promise<boolean>) | null = null;

export const getActiveDomain = () => activeDomain;
export const setActiveDomain = (domain: ConfigDomain) => {
  activeDomain = domain;
};
export const getActiveTargetEnv = () => activeTargetEnv;
export const setActiveTargetEnv = (env: string) => {
  activeTargetEnv = env;
};
export const getActiveService = () => activeService;
export const setActiveService = (service: ServiceKey) => {
  activeService = service;
};
export const setEnvConfirmHandler = (handler: typeof envConfirmHandler) => {
  envConfirmHandler = handler;
};

export const api = async (input: string, init: RequestInit = {}, confirmEnv?: string): Promise<Response> => {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    "X-Config-Domain": activeDomain
  };
  // Header X-Target-Env yang diisi pemanggil (mis. layar Bandingkan antar env) tidak boleh ditimpa env aktif
  if (activeTargetEnv && !headers["X-Target-Env"]) headers["X-Target-Env"] = activeTargetEnv;
  if (!headers["X-Target-Service"]) headers["X-Target-Service"] = activeService;
  if (confirmEnv) headers["X-Confirm-Env"] = confirmEnv;
  const res = await fetch(input, { ...init, credentials: "same-origin", headers });
  // Sesi habis/di-logout di tab lain: kembalikan ke layar login
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  // Env dilindungi: minta konfirmasi lalu ulangi request yang sama sekali lagi
  if (res.status === 428 && !confirmEnv && envConfirmHandler) {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === "ENV_CONFIRM_REQUIRED" && (await envConfirmHandler(body.env))) {
      return api(input, init, body.env);
    }
  }
  return res;
};
