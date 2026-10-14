import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

// MCP server Tenant Studio (stdio). Dijalankan oleh agent AI lokal; memanggil BFF Studio yang sedang berjalan.
// Log hanya ke stderr karena stdout dipakai protokol MCP.

const INSTRUCTIONS = `
Tenant Studio: konfigurasi multi-tenant ATS (tenant_configurations & pipeline_workflow_configurations).

Aturan:
- Server ini HANYA-BACA. Tidak ada tool untuk menyimpan, sync, atau restore. Jangan mencoba menyimpan
  konfigurasi lewat jalur lain (mis. query SQL langsung ke database): itu melewati validasi, riwayat audit,
  dan pengecekan versi.
- Untuk perubahan: get_config -> preview_change -> tunjukkan ringkasan diff & hasil validasi ke user.
  User yang menerapkan usulan lewat UI Studio. Selalu sebutkan env & tenant yang dimaksud.
- Baca read_guide (topic "skill") sebelum menyusun usulan pertama.
- Utamakan 'patch' (RFC 6902) daripada menulis ulang seluruh config.
- Validator saat ini menandai isFile + resolvePaths sebagai error, padahal aturan ini sedang ditinjau
  (file di dalam customFields mungkin justru butuh resolvePaths). Jangan menghapus resolvePaths yang sudah
  ada tanpa konfirmasi user.
`.trim();

const server = new McpServer({ name: "tenant-studio", version: "0.1.0" }, { instructions: INSTRUCTIONS });
registerTools(server);

await server.connect(new StdioServerTransport());
console.error("tenant-studio MCP siap (stdio, hanya-baca).");
