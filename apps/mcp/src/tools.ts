import fs from "fs";
import path from "path";
import { z } from "zod";
import jsonpatch, { type Operation } from "fast-json-patch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { calculateJsonDelta, formatDeltaOutput } from "../../web/src/utils/jsonDiff.ts";
import { REPO_ROOT, SERVICES, listTargetEnvs, resolveEnv, studioRequest, type Domain, type Service } from "./studioClient.ts";

// Tool MCP Tenant Studio: membaca, membandingkan, memvalidasi, dan menyusun USULAN perubahan.
// Tidak ada tool yang menyimpan ke database — user menerapkan usulan lewat UI Studio.

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const envArg = z
  .string()
  .optional()
  .describe("Nama profil target env (lihat list_envs). Kosong = env terakhir user di Studio, lalu default server.");
const domainArg = z
  .enum(["tenant_config", "workflow_pipeline"])
  .default("tenant_config")
  .describe("tenant_config = tabel tenant_configurations layanan, workflow_pipeline = tabel workflow layanan (hanya ats & hris)");

const serviceArg = z
  .enum(SERVICES as [Service, ...Service[]])
  .default("ats")
  .describe("Layanan/database config: ats (ats_db), hris (hris_db), organization (organization_db), auth (auth_db), communication (communication_db). Default ats.");

const GUIDES = {
  skill: { file: "docs/skills/tenant-configuration/SKILL.md", title: "SKILL tenant-configuration (aturan skema & jebakan)" },
  guide: { file: "docs/TENANT_CONFIGURATION_GUIDE.md", title: "Panduan Tenant Configuration" }
} as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }]
});

/** Bungkus handler: error dikembalikan sebagai isError agar agent bisa membaca pesannya. */
function safe<A>(fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: err?.message || String(err) }] };
    }
  };
}

async function loadConfig(configId: string, env: string, domain: Domain, service: Service) {
  const json = await studioRequest("GET", `/api/configs/${encodeURIComponent(configId)}`, { env, domain, service });
  const row = json.data;
  return {
    env,
    service,
    domain,
    configId: row.id as string,
    tenantId: row.tenant_id as string | null,
    configType: row.config_type as string,
    groupId: row.group_id as string | null,
    path: row.path as string | null,
    isDefault: row.is_default as boolean,
    updatedAt: row.updated_at as string,
    versionToken: row.version_token as string,
    value: row.value ?? {}
  };
}

async function loadHistory(configId: string, env: string, domain: Domain, service: Service): Promise<any[]> {
  const json = await studioRequest("GET", `/api/configs/${encodeURIComponent(configId)}/histories`, { env, domain, service });
  return json.data || [];
}

async function validate(value: unknown, env: string, domain: Domain, service: Service) {
  return studioRequest("POST", "/api/validator/check", { env, domain, service }, { config: value });
}

const sideSchema = z.object({
  configId: z.string().describe("ID config (lihat list_configs)"),
  env: envArg,
  historyVersion: z.number().int().optional().describe("Nomor versi riwayat; kosong = isi config saat ini")
});

async function loadSide(side: z.infer<typeof sideSchema>, domain: Domain, service: Service) {
  const env = await resolveEnv(side.env);
  const cfg = await loadConfig(side.configId, env, domain, service);
  if (side.historyVersion === undefined) {
    return { label: `${cfg.configType} @ ${env} (saat ini)`, value: cfg.value };
  }
  const snap = (await loadHistory(side.configId, env, domain, service)).find((h) => h.version === side.historyVersion);
  if (!snap) throw new Error(`Versi riwayat ${side.historyVersion} tidak ada untuk config ${side.configId} di env ${env}.`);
  return { label: `${cfg.configType} @ ${env} (riwayat v${side.historyVersion})`, value: snap.config_value };
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "list_envs",
    {
      title: "Daftar target env",
      description: "Daftar profil target env beserta status koneksi, read-only, protected, dan layanan (ats, hris, organization, auth, communication) yang tersedia.",
      inputSchema: {},
      annotations: READ_ONLY
    },
    safe(async () => {
      const { list, defaultEnv } = await listTargetEnvs(true);
      return ok({
        defaultEnv,
        envs: list.map((e) => ({
          name: e.name,
          label: e.label,
          readonly: e.readonly,
          protected: e.protected,
          connected: e.status?.ok ?? null,
          error: e.status?.error,
          services: (e.services || []).map((x) => ({ key: x.key, dbName: x.dbName, available: x.available, hasWorkflow: x.hasWorkflow, reason: x.reason }))
        }))
      });
    })
  );

  server.registerTool(
    "list_tenants",
    {
      title: "Daftar tenant",
      description: "Daftar tenant (nama, kode, tenantId, groupId, jumlah config). Bisa difilter dengan kata kunci.",
      inputSchema: {
        env: envArg,
        domain: domainArg,
        service: serviceArg,
        search: z.string().optional().describe("Cari di nama, kode, tenantId, atau groupId")
      },
      annotations: READ_ONLY
    },
    safe(async ({ env, domain, service, search }) => {
      const resolved = await resolveEnv(env);
      const json = await studioRequest("GET", "/api/tenants", { env: resolved, domain, service });
      const q = (search || "").toLowerCase();
      const tenants = (json.data || []).filter((t: any) =>
        !q || [t.name, t.code, t.tenantId, t.groupId].some((v) => v && String(v).toLowerCase().includes(q))
      );
      return ok({
        env: resolved,
        domain,
        count: tenants.length,
        tenants: tenants.map((t: any) => ({
          tenantId: t.tenantId,
          name: t.name,
          code: t.code,
          groupId: t.groupId,
          tags: t.tags,
          totalConfigs: t.totalConfigs
        }))
      });
    })
  );

  server.registerTool(
    "list_configs",
    {
      title: "Daftar config tenant",
      description: "Daftar konfigurasi milik satu tenant (id, config_type, group_id). Pakai tenantId 'GLOBAL_DEFAULT' untuk config global.",
      inputSchema: { tenantId: z.string(), env: envArg, domain: domainArg, service: serviceArg },
      annotations: READ_ONLY
    },
    safe(async ({ tenantId, env, domain, service }) => {
      const resolved = await resolveEnv(env);
      const json = await studioRequest("GET", `/api/tenants/${encodeURIComponent(tenantId)}/configs`, { env: resolved, domain, service });
      return ok({
        env: resolved,
        domain,
        tenantId,
        configs: (json.data || []).map((c: any) => ({
          configId: c.id,
          configType: c.config_type,
          groupId: c.group_id,
          path: c.path,
          isDefault: c.is_default,
          updatedAt: c.updated_at
        }))
      });
    })
  );

  server.registerTool(
    "get_config",
    {
      title: "Ambil isi config",
      description: "Isi JSON lengkap sebuah konfigurasi beserta versionToken (penanda versi DB saat dibaca).",
      inputSchema: { configId: z.string(), env: envArg, domain: domainArg, service: serviceArg },
      annotations: READ_ONLY
    },
    safe(async ({ configId, env, domain, service }) => ok(await loadConfig(configId, await resolveEnv(env), domain, service)))
  );

  server.registerTool(
    "get_history",
    {
      title: "Riwayat versi config",
      description:
        "Riwayat versi sebuah config (versi, author, catatan, waktu). Isi config hanya disertakan jika 'version' diisi.",
      inputSchema: {
        configId: z.string(),
        env: envArg,
        domain: domainArg,
        service: serviceArg,
        version: z.number().int().optional().describe("Ambil snapshot lengkap untuk versi ini"),
        limit: z.number().int().min(1).max(200).default(20)
      },
      annotations: READ_ONLY
    },
    safe(async ({ configId, env, domain, service, version, limit }) => {
      const resolved = await resolveEnv(env);
      const rows = await loadHistory(configId, resolved, domain, service);
      if (version !== undefined) {
        const snap = rows.find((h) => h.version === version);
        if (!snap) throw new Error(`Versi ${version} tidak ditemukan.`);
        return ok({ env: resolved, domain, configId, ...snap });
      }
      return ok({
        env: resolved,
        domain,
        configId,
        total: rows.length,
        versions: rows.slice(0, limit).map((h) => ({
          version: h.version,
          author: h.author_name,
          summary: h.change_summary,
          createdAt: h.created_at
        }))
      });
    })
  );

  server.registerTool(
    "compare_configs",
    {
      title: "Bandingkan dua config",
      description:
        "Diff struktural antara dua config: antar tenant, antar env (mis. development vs production), atau dengan versi riwayat.",
      inputSchema: {
        base: sideSchema.describe("Sisi acuan (kiri)"),
        target: sideSchema.describe("Sisi pembanding (kanan)"),
        domain: domainArg,
        service: serviceArg,
        format: z
          .enum(["compact", "views", "patch", "full"])
          .default("compact")
          .describe("compact = ringkasan added/removed/modified, views = per view, patch = RFC 6902, full = semuanya")
      },
      annotations: READ_ONLY
    },
    safe(async ({ base, target, domain, service, format }) => {
      const [a, b] = await Promise.all([loadSide(base, domain, service), loadSide(target, domain, service)]);
      const delta = calculateJsonDelta(a.value, b.value, a.label, b.label);
      return ok(`Base: ${a.label}\nTarget: ${b.label}\n\n${formatDeltaOutput(delta, format)}`);
    })
  );

  server.registerTool(
    "validate_config",
    {
      title: "Validasi config",
      description:
        "Jalankan validator guardrail Studio. Isi 'value' untuk memvalidasi JSON usulan, atau 'configId' untuk config yang tersimpan.",
      inputSchema: {
        value: z.record(z.any()).optional().describe("Objek config yang akan divalidasi"),
        configId: z.string().optional(),
        env: envArg,
        domain: domainArg,
        service: serviceArg
      },
      annotations: READ_ONLY
    },
    safe(async ({ value, configId, env, domain, service }) => {
      if (!value === !configId) throw new Error("Isi salah satu: 'value' atau 'configId'.");
      const resolved = await resolveEnv(env);
      const config = value ?? (await loadConfig(configId!, resolved, domain, service)).value;
      return ok(await validate(config, resolved, domain, service));
    })
  );

  server.registerTool(
    "preview_change",
    {
      title: "Susun usulan perubahan (tidak disimpan)",
      description: [
        "Terapkan perubahan ke SALINAN config di memori, lalu kembalikan hasil validasi, diff, dan JSON usulan.",
        "TIDAK menyimpan apa pun. User yang meninjau dan menyimpan lewat Studio.",
        "Isi salah satu: 'patch' (RFC 6902, disarankan untuk perubahan kecil) atau 'newValue' (isi config lengkap)."
      ].join(" "),
      inputSchema: {
        configId: z.string(),
        env: envArg,
        domain: domainArg,
        service: serviceArg,
        patch: z
          .array(
            z.object({
              op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
              path: z.string().describe("JSON Pointer, mis. /views/- untuk menambah view di akhir"),
              value: z.any().optional(),
              from: z.string().optional()
            })
          )
          .optional(),
        newValue: z.record(z.any()).optional(),
        summary: z.string().optional().describe("Catatan singkat perubahan, untuk dipakai user saat menyimpan"),
        includeProposedValue: z.boolean().default(true).describe("Sertakan JSON usulan lengkap di hasil")
      },
      annotations: READ_ONLY
    },
    safe(async ({ configId, env, domain, service, patch, newValue, summary, includeProposedValue }) => {
      if (!patch === !newValue) throw new Error("Isi salah satu: 'patch' atau 'newValue'.");
      const resolved = await resolveEnv(env);
      const current = await loadConfig(configId, resolved, domain, service);

      let proposed: any;
      if (patch) {
        try {
          const doc = jsonpatch.deepClone(current.value);
          proposed = jsonpatch.applyPatch(doc, patch as Operation[], true, true).newDocument;
        } catch (err: any) {
          throw new Error(`Patch tidak bisa diterapkan: ${err.message}`);
        }
      } else {
        proposed = newValue;
      }

      const validation = await validate(proposed, resolved, domain, service);
      const delta = calculateJsonDelta(current.value, proposed, `${current.configType} saat ini`, "Usulan");
      return ok({
        saved: false,
        notice:
          "USULAN — belum disimpan ke database. Tunjukkan ringkasan ke user; user menerapkannya lewat Studio (tempel JSON usulan ke editor, tinjau diff, lalu Save).",
        base: {
          env: resolved,
          service,
          domain,
          configId,
          tenantId: current.tenantId,
          configType: current.configType,
          versionToken: current.versionToken
        },
        summary: summary || null,
        validation,
        changes: JSON.parse(formatDeltaOutput(delta, "compact")),
        views: delta.viewsAnalysis ?? null,
        proposedValue: includeProposedValue ? proposed : undefined
      });
    })
  );

  server.registerTool(
    "read_guide",
    {
      title: "Baca panduan konfigurasi",
      description:
        "Baca panduan aturan skema tenant config. Baca 'skill' sebelum menyusun usulan perubahan pertama kali.",
      inputSchema: { topic: z.enum(["skill", "guide"]).default("skill") },
      annotations: READ_ONLY
    },
    safe(async ({ topic }) => ok(fs.readFileSync(path.join(REPO_ROOT, GUIDES[topic].file), "utf8")))
  );

  for (const [key, g] of Object.entries(GUIDES)) {
    server.registerResource(
      `guide-${key}`,
      `tenant-studio://guide/${key}`,
      { title: g.title, mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: fs.readFileSync(path.join(REPO_ROOT, g.file), "utf8") }] })
    );
  }
}
