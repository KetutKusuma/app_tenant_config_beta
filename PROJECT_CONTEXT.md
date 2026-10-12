# PROJECT CONTEXT FOR AI AGENTS & DEVELOPERS

Dokumen panduan arsitektur, konteks proyek, spesifikasi skema, dan pedoman pengembangan lengkap untuk AI Agents (Antigravity, Gemini, Claude, dll) telah disusun secara komprehensif dalam:

👉 [**`docs/AI_PROJECT_CONTEXT_HANDBOOK.md`**](file:///Users/ketutkusuma/J/app_tenant_config_beta/docs/AI_PROJECT_CONTEXT_HANDBOOK.md) *(1,850+ Baris)*

---

### Ringkasan Cepat Konteks Proyek:
1. **Nama Aplikasi:** Tenant Configuration Studio (Beta)
2. **Tujuan:** Pengelolaan visual, validasi pra-penyimpanan (*guardrails*), pencatatan riwayat audit (*audit trail & snapshots*), komparasi diferensial kanonikal (*canonical RFC 6902 diff*), dan sinkronisasi dua arah untuk konfigurasi multi-tenant ATS Jobseeker (`public.tenant_configurations`).
3. **Arsitektur Dual Database:**
   - **Target DB (Live ATS):** `public.tenant_configurations` (Hanya menyimpan baris konfigurasi aktif).
   - **Audit DB (Neon Serverless):** `tenant_studio.tenant_metadata` dan `tenant_studio.tenant_config_histories` (Menyimpan snapshot versi utuh, author, rincian diff, dan rollback).
4. **Guardrail Kritis:**
   - Semua view bertipe `file` **WAJIB** menyertakan array `resolvePaths: ["url", ...]` untuk mencegah *HTTP 500: invalid input syntax for type uuid*.
   - Semua custom field di `customData.fields` **WAJIB** memiliki entri padanan di array `views` agar dapat dilihat dan difilter oleh recruiter.
5. **Ekspor Preset & AI Skill:**
   - Mendukung ekspor ke direktori preset lokal (Default: `/Users/ketutkusuma/Python/test_redis_stream/stable`).
   - Otomatis menyertakan paket AI Skill (`skills/tenant-configuration/SKILL.md` dan `.agents/skills/tenant-configuration/SKILL.md`) saat diekspor.
