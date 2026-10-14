import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Klien HTTP ke BFF Tenant Studio untuk MCP server.
// SENGAJA hanya-baca: selain GET, yang diizinkan hanya login dan validator (tidak menulis apa pun).
// Semua penyimpanan konfigurasi tetap dilakukan user lewat UI Studio.

const here = path.dirname(fileURLToPath(import.meta.url));
// stdout dipakai protokol MCP, jadi dotenv tidak boleh mencetak log ke sana
dotenv.config({ path: path.resolve(here, "../../../.env"), quiet: true } as dotenv.DotenvConfigOptions);

export const REPO_ROOT = path.resolve(here, "../../..");
const BFF_URL = (process.env.STUDIO_BFF_URL || `http://localhost:${process.env.PORT_BFF || 4000}`).replace(/\/$/, "");

export type Domain = "tenant_config" | "workflow_pipeline";
export interface Scope {
  env?: string;
  domain: Domain;
}

export interface TargetEnv {
  name: string;
  label: string;
  readonly: boolean;
  protected: boolean;
  status?: { ok: boolean; error?: string; ms?: number };
}

const ALLOWED_POST = new Set(["/api/auth/login", "/api/validator/check"]);

let cookie: string | null = null;
let lastTargetEnv: string | null = null;
let envCache: { list: TargetEnv[]; defaultEnv: string } | null = null;

async function rawFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: any) {
    throw new Error(`BFF Tenant Studio tidak bisa dihubungi di ${BFF_URL} (${err.cause?.code || err.message}). Jalankan dulu: pnpm dev:bff`);
  }
}

async function login(): Promise<void> {
  const email = process.env.STUDIO_MCP_EMAIL;
  const password = process.env.STUDIO_MCP_PASSWORD;
  if (!email || !password) {
    throw new Error("STUDIO_MCP_EMAIL / STUDIO_MCP_PASSWORD belum diisi di .env root workspace. Lihat apps/mcp/README.md.");
  }
  const res = await rawFetch(`${BFF_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "tenant-studio-mcp" },
    body: JSON.stringify({ email, password })
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login MCP ke Studio gagal (${res.status}): ${json.error || res.statusText}`);
  if (json.user?.mustChangePassword) {
    throw new Error("Akun MCP masih wajib ganti password. Login sekali di Studio untuk menggantinya, lalu perbarui STUDIO_MCP_PASSWORD.");
  }
  cookie = res.headers.get("set-cookie")?.split(";")[0] || null;
  if (!cookie) throw new Error("BFF tidak mengirim cookie sesi saat login.");
  lastTargetEnv = json.user?.preferences?.lastTargetEnv || null;
}

/** Panggil BFF. Hanya GET + POST yang ada di ALLOWED_POST; method lain ditolak sebelum request dikirim. */
export async function studioRequest(
  method: "GET" | "POST",
  apiPath: string,
  scope: { env?: string; domain?: Domain } = {},
  body?: unknown
): Promise<any> {
  const pathOnly = apiPath.split("?")[0];
  if (method !== "GET" && !(method === "POST" && ALLOWED_POST.has(pathOnly))) {
    throw new Error(`Diblokir: MCP Tenant Studio hanya-baca (${method} ${pathOnly}).`);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    if (!cookie) await login();
    const headers: Record<string, string> = { Cookie: cookie!, "User-Agent": "tenant-studio-mcp" };
    if (scope.domain) headers["X-Config-Domain"] = scope.domain;
    if (scope.env) headers["X-Target-Env"] = scope.env;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await rawFetch(`${BFF_URL}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    // Sesi kedaluwarsa / dihapus: login ulang sekali
    if (res.status === 401 && attempt === 0) {
      cookie = null;
      continue;
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${pathOnly} gagal (${res.status}): ${json.error || res.statusText}`);
    return json;
  }
}

export async function listTargetEnvs(refresh = false): Promise<{ list: TargetEnv[]; defaultEnv: string }> {
  if (!envCache || refresh) {
    const json = await studioRequest("GET", "/api/envs");
    envCache = { list: json.data || [], defaultEnv: json.defaultEnv };
  }
  return envCache;
}

/** Tentukan env secara eksplisit (agar output selalu menyebut env mana yang dibaca). */
export async function resolveEnv(env?: string): Promise<string> {
  let { list, defaultEnv } = await listTargetEnvs();
  if (env) {
    if (!list.some((e) => e.name === env)) ({ list, defaultEnv } = await listTargetEnvs(true));
    if (!list.some((e) => e.name === env)) {
      throw new Error(`Env '${env}' tidak dikenal. Pilihan: ${list.map((e) => e.name).join(", ")}`);
    }
    return env;
  }
  if (!cookie) await login();
  return lastTargetEnv && list.some((e) => e.name === lastTargetEnv) ? lastTargetEnv : defaultEnv;
}
