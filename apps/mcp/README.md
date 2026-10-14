# MCP Server Tenant Studio

MCP server (stdio) supaya agent AI lokal (Claude Code, Claude Desktop, Cursor, dll.) bisa membaca,
membandingkan, memvalidasi, dan **menyusun usulan** perubahan konfigurasi tenant lewat BFF Studio.

**Server ini hanya-baca.** Tidak ada tool untuk menyimpan, sync, atau restore, di env mana pun
(termasuk development). Klien HTTP-nya (`src/studioClient.ts`) menolak semua request selain `GET`,
login, dan `/api/validator/check` sebelum request dikirim. Usulan diterapkan user lewat UI Studio.

## Persiapan

1. Isi kredensial akun Studio di `.env` root workspace (file yang sama dengan BFF):

   ```env
   STUDIO_MCP_EMAIL=email-akun-studio@contoh.com
   STUDIO_MCP_PASSWORD=password-akun-studio
   # Opsional, default http://localhost:${PORT_BFF:-4000}
   # STUDIO_BFF_URL=http://localhost:4000
   ```

   Akun harus sudah pernah login di Studio dan tidak dalam status "wajib ganti password".

2. Jalankan BFF: `pnpm dev:bff` (atau `pnpm dev`).

3. Daftarkan server ke agent:
   - **Claude Code**: sudah terdaftar lewat `.mcp.json` di root repo. Setujui server `tenant-studio`
     saat diminta, lalu cek dengan `/mcp`.
   - **Agent lain**: jalankan perintah `pnpm --silent --filter mcp start` dari root repo sebagai
     MCP server stdio.

## Tool

| Tool | Fungsi |
|---|---|
| `list_envs` | Profil target env + status koneksi, read-only, protected |
| `list_tenants` | Daftar tenant (bisa dicari) |
| `list_configs` | Daftar config milik satu tenant |
| `get_config` | Isi JSON config + `versionToken` |
| `get_history` | Riwayat versi; isi snapshot jika `version` diisi |
| `compare_configs` | Diff antar tenant, antar env, atau dengan versi riwayat |
| `validate_config` | Jalankan validator guardrail Studio |
| `preview_change` | Terapkan patch RFC 6902 / isi baru ke salinan di memori → validasi + diff + JSON usulan (**tidak disimpan**) |
| `read_guide` | Baca `SKILL.md` atau panduan konfigurasi (juga tersedia sebagai resource `tenant-studio://guide/*`) |

Semua tool menerima `env` (kosong = env terakhir user di Studio, lalu default server) dan `domain`
(`tenant_config` atau `workflow_pipeline`).

## Contoh perintah ke agent

> Di tenant IDM (development), tambahkan custom field `npwp` bertipe TEXT di CANDIDATE_STABLE beserta
> view-nya. Susun usulannya dan tunjukkan diff serta hasil validasinya.

Agent akan memakai `get_config` → `read_guide` → `preview_change`. Untuk menerapkan, salin JSON usulan
ke editor Studio, tinjau diff-nya, lalu Save seperti biasa.

## Pengecekan

```bash
pnpm --filter mcp typecheck
```
