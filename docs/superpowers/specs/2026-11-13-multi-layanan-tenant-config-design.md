# Desain: Studio untuk Semua Layanan (ATS, HRIS, Organization, Auth, Communication)

- Tanggal: 2026-11-13
- Status: disetujui user (2026-11-13)
- Repo: `app_tenant_config_beta` (web `apps/web`, BFF `apps/bff`, MCP `apps/mcp`)
- Dasar: branch `feat/salin-duplikat-tenant` (Salin, Duplikat tenant, Export SQL, `pathRules`, catatan perubahan wajib)
- Spec sebelumnya: `2026-10-29-bandingkan-antar-env-export-sql-salin-design.md`, `2026-10-30-salin-dan-duplikat-tenant-design.md`

## 1. Latar belakang dan alasan

Studio saat ini hanya bisa membuka `ats_db`: satu profil env (`envs/<nama>.env`) sama dengan satu koneksi database, dan tabelnya di-hardcode di `apps/bff/src/domain.ts` (`public.tenant_configurations`, `public.pipeline_workflow_configurations`).

Padahal tabel `tenant_configurations` dengan format yang sama juga dipakai layanan lain di platform. Hasil pengecekan database `jsc_dev` dan `jsc_stag` (2026-11-13, strukturnya sama di kedua env):

| Layanan | Database | Tabel config | Baris (dev) | Perbedaan dari ATS |
|---|---|---|---|---|
| ATS | `ats_db` | `public.tenant_configurations` | 126 | acuan |
| HRIS | `hris_db` | `public.tenant_configurations` | 39 | `id` bertipe `varchar` (isinya tetap string UUID); ada kolom lama `type`; tidak ada kolom `config` |
| Organization | `organization_db` | `core.tenant_configurations` | 43 | schema `core`; ada kolom lama `type`; `tenant_id` punya FK ke tabel tenant organization (`ON DELETE CASCADE`) |
| Auth | `auth_db` | `public.tenant_configurations` | 2 | sama dengan ATS |
| Communication | `communication_db` | `public.tenant_configurations` | 5 | sama dengan ATS |

Tabel workflow yang setara:

| Layanan | Tabel workflow | Perbedaan |
|---|---|---|
| ATS | `public.pipeline_workflow_configurations` | acuan |
| HRIS | `workflow_pipelines.workflow_pipeline_configurations` | schema `workflow_pipelines`; `id` bertipe `varchar`; ada kolom `is_active` |

Di backend (`~/J/jobseeker-platform-backend`), semua layanan ini membaca config lewat mesin yang sama, yaitu paket `packages/tenant-configurations` (dipakai HRIS di 124 file). Mesin mencari baris berdasarkan `config_type`, dan bentuk `value`-nya (views, filterable, validation, dll.) sama. Kolom `type` di HRIS sudah ditandai `@deprecated` di entity.

User (pengelola config ATS, orang yang sama yang akan mengurus config HRIS dan layanan lain) ingin **cukup memakai Studio untuk semua config tersebut**, dengan **perilaku persis seperti ATS**. Prioritas pertama adalah HRIS.

## 2. Tujuan, bukan tujuan, anti-tujuan

**Tujuan**

- Pemilih **Layanan** di header, tepat di samping pemilih env. Layanan: ATS, HRIS, Organization, Auth, Communication.
- Semua fitur yang ada untuk ATS bekerja sama persis untuk layanan lain: daftar tenant dan config, edit dan simpan (dengan optimistic locking dan catatan perubahan), Tambah dan Hapus config, Riwayat, Validasi, Bandingkan (dengan DB, dengan tenant lain, antar env), Salin ke…, Duplikat tenant, Salin ke Kanan, Export SQL, Preset lokal dan Sync Center, serta batch perubahan.
- Domain workflow (`workflow_pipeline`) tersedia untuk layanan yang punya tabel workflow (ATS dan HRIS).
- Default (`is_default = true`) dan override per tenant sama-sama bisa diedit, seperti ATS sekarang.
- Riwayat, preset link, dan batch tercatat per layanan sehingga tidak tercampur.
- Penambahan layanan berikutnya cukup dengan satu entri di registri layanan, tanpa mengubah route.

**Bukan tujuan**

- Bandingkan, Salin, Duplikat, atau Export SQL **lintas layanan** (misalnya ATS → HRIS). Semua operasi itu hanya berjalan di dalam satu layanan (misalnya HRIS dev ↔ HRIS staging). Disetujui user.
- Tabel dengan format berbeda: `auth.configuration`, `facilitator_db.public.tenant_config`, `organization_db.public.global_configurations`/`user_configurations`, `hris_db.payrolls.bank_transfer_templates`. Bisa menyusul sebagai layanan atau domain baru.
- `integrator_db.public.tenant_configuration`, karena isinya kredensial integrasi (`tenant_secret`, `public_key_pem`). Tidak boleh pernah ditampilkan di Studio.
- Membaca file `*.config.ts` di repo backend atau menampilkan label "ada di kode (config-sync)". Usulan ini ditunda karena user meminta perilaku persis seperti ATS. ATS juga sudah memakai `tenant-config-sync` dan Studio selama ini tidak memperhitungkannya.
- Mengisi atau memigrasikan kolom lama `type` ke `config_type`.
- Membuat tenant di layanan mana pun.
- Dokumentasi/panduan khusus HRIS di DocsModal. Panduan yang ada tetap tampil apa adanya.
- MCP tetap hanya-baca (lihat 4.9).

**Anti-tujuan** (gagal walaupun secara teknis berjalan)

- User mengira sedang mengedit `ats_db` padahal sedang di `hris_db`, atau sebaliknya. Layanan aktif harus selalu terlihat.
- Perilaku ATS yang sekarang berubah, atau riwayat ATS yang lama hilang atau tercampur dengan layanan lain.
- Operasi tulis diam-diam masuk ke database lain dari yang ditampilkan, misalnya karena pool tertukar antar layanan atau env.
- Layanan yang belum dikonfigurasi di suatu env tampak bisa dipilih lalu gagal dengan error 500 yang tidak jelas.

## 3. Batasan

- Koneksi per env + layanan. Host dan kredensial diambil dari profil env yang sama. Di `jsc_dev` dan `jsc_stag`, semua database layanan berada di satu server yang sama.
- Profil `neondb` hanya punya database ATS. Layanan lain di profil itu harus tampak "tidak tersedia".
- `tenant_id` dipakai bersama lintas layanan dalam satu env (contoh: tenant `019c6a92-…` ada di `ats_db` dan `hris_db` dev). Daftar tenant Studio di Neon (`tenant_studio.tenant_metadata`, per env) cukup satu untuk semua layanan.
- Migrasi Neon dijalankan oleh `studioSchema.ts` saat BFF start dan langsung berlaku. Migrasinya harus aman dijalankan berulang dan tidak boleh mengubah arti data lama.
- UI berbahasa Indonesia, satu tombol utama, aksi berbahaya memakai ketik-untuk-konfirmasi (aturan Studio yang sudah ada).

## 4. Desain

### 4.1 Registri layanan (BFF)

File baru `apps/bff/src/services.ts` berisi satu entri per layanan:

```ts
type ServiceKey = "ats" | "hris" | "organization" | "auth" | "communication";

interface TableSpec {
  table: string;          // schema-qualified, mis. "core.tenant_configurations"
  typeCol: string;        // "config_type" | "workflow_config_type"
  hasPath: boolean;
  idType: "uuid" | "varchar";
  legacyTypeCol?: string; // "type" di HRIS & Organization
  extraInsertCols?: Record<string, unknown>; // mis. { is_active: true } untuk workflow HRIS
}

interface ServiceSpec {
  key: ServiceKey;
  label: string;          // "ATS", "HRIS", ...
  defaultDbName: string;  // "ats_db", "hris_db", ...
  domains: { tenant_config: TableSpec; workflow_pipeline?: TableSpec };
}
```

Isinya mengikuti tabel di bagian 1. `DomainSpec` di `domain.ts` diturunkan dari `ServiceSpec` + domain aktif, sehingga semua route yang sekarang memakai `domainOf(req)` (`D.table`, `D.typeCol`, `D.pathSel`) otomatis mengikuti layanan aktif.

`linkKey` (kunci preset link) tetap sama, karena pemisahan antar layanan dilakukan lewat kolom `target_service` (4.4), bukan lewat prefix.

### 4.2 Koneksi per env + layanan

- Profil env tetap satu file `envs/<nama>.env`. Nama database per layanan:
  - ATS: `DB_NAME` (atau `DB_DATABASE`) seperti sekarang.
  - Layanan lain: `DB_NAME_<LAYANAN>` (misalnya `DB_NAME_HRIS=hris_db`) bila diisi. Bila tidak diisi, dipakai `defaultDbName` di registri, **hanya untuk profil berbasis `DB_HOST`**.
  - Profil berbasis `TARGET_DB_URL`: layanan lain hanya tersedia bila ada `TARGET_DB_URL_<LAYANAN>`.
- Pool di-cache dengan kunci `<env>:<layanan>` dan ditutup/dibuat ulang mengikuti perubahan file profil, seperti sekarang.
- Ketersediaan layanan per env ditentukan oleh `ping` (`SELECT 1` + cek tabel config ada lewat `to_regclass`). `GET /api/envs` mengembalikan daftar layanan per profil beserta status `available` dan alasan bila tidak tersedia.
- Middleware: header baru `X-Target-Service`. Untuk request baca, bila header tidak ada, fallback ke preferensi user `lastTargetService`, lalu `ats`. **Untuk request tulis (POST/PUT/PATCH/DELETE), header wajib ada**. Bila tidak ada, request ditolak dengan `400 TARGET_SERVICE_REQUIRED`. Ini mencegah tab lama atau client lama menulis ke layanan yang tidak sedang tampil di layar. *(keputusan builder-check)* Kombinasi yang tidak dikenal atau tidak tersedia ditolak dengan `400 UNKNOWN_TARGET_SERVICE` / `409 SERVICE_UNAVAILABLE` beserta pesan Indonesia. `req.targetService` dan `req.targetDb` diisi sesuai pasangan env + layanan.
- `assertWritable` tetap berbasis env (read-only/dilindungi berlaku untuk semua layanan di env itu). Konfirmasi ketik-nama untuk env dilindungi tetap memakai nama env.
- Preferensi user baru: `lastTargetService` (kolom `last_target_service` di tabel user Neon).

### 4.3 Perbedaan antar tabel

- **`id` bertipe varchar** (HRIS): jangan ada cast `::uuid` pada kolom `id` di query. Id baru tetap dibuat sebagai string UUID (`randomUUID()` di BFF, `gen_random_uuid()::text` di Export SQL bila `idType = "varchar"`).
- **Kolom lama `type`** (HRIS, Organization):
  - Tidak diisi oleh Studio saat membuat baris baru (`NULL`).
  - Saat Salin/Duplikat/Export SQL, nilai `type` dari sumber ikut disalin apa adanya agar hasilnya identik dengan sumber.
  - **Baris dengan `config_type` kosong tidak ditampilkan dan tidak disentuh Studio** di layanan mana pun. Semua query baca, bandingkan, salin, export, dan sync memfilter `config_type IS NOT NULL`. Di dev ini berarti 15 baris `type = 'CMS'` di `organization_db.core.tenant_configurations` (1 default + 14 tenant). Baris itu masih aktif dipakai modul CMS Organization, yang punya endpoint ubah sendiri dan membuat baris CMS saat tenant dibuat. Disetujui user (2026-11-13).
- **Kolom `config`** (ATS, Organization, Auth, Communication): tidak disentuh Studio, sama seperti sekarang.
- **Workflow HRIS `is_active`**: baris baru diisi `is_active = true`. Salin/Duplikat ikut menyalin nilai `is_active` sumber. Studio tidak menyediakan tombol untuk mengubah `is_active` dan tidak memfilter berdasarkan kolom itu. Dasarnya (cek dev 2026-11-13): tidak ada baris dengan `is_active = false`, dan ada unique index per `(tenant_id, workflow_config_type)`, jadi maksimal satu baris per tenant + tipe.
- **Unique index workflow HRIS**: `UQ_workflow_pipeline_tenant_config` dan `UQ_workflow_pipeline_global_config` hanya berlaku bila `group_id IS NULL`. Salin/Duplikat/Export SQL menyalin `group_id` apa adanya dari sumber dan tidak mengisinya otomatis. Pelanggaran unique index diterjemahkan menjadi pesan "config ini sudah ada di tujuan", dan transaksi dibatalkan.
- **Tidak ada unique index** pada `(tenant_id, config_type)` di `tenant_configurations` HRIS dan Organization; hanya PK `id`. Pengecekan "sudah ada di tujuan" tetap dilakukan Studio seperti di ATS (`NOT EXISTS`). Semua kolom yang dipakai Studio (`deleted_at`, `group_id`, `is_default`, `created_at`, `updated_at`, `path`) ada di semua tabel layanan, dan `type` nullable (cek dev 2026-11-13).
- **FK `tenant_id` di Organization**: menulis override untuk tenant yang tidak ada di tabel tenant organization akan gagal karena FK. Error ini diterjemahkan menjadi pesan jelas ("Tenant belum terdaftar di Organization pada env ini") dan seluruh transaksi dibatalkan.
- Aturan path (`pathRules`) dan pengecekan konflik path berlaku untuk semua layanan dengan `hasPath = true`.

### 4.4 Data Studio di Neon

Kolom baru `target_service text NOT NULL DEFAULT 'ats'` di:

- `tenant_studio.tenant_config_histories`
- `tenant_studio.preset_links` (ikut masuk primary key: `user_id, target_env, target_service, tenant_id, config_type`)
- `tenant_studio.config_change_batches`

Semua baris lama otomatis menjadi `ats`, sehingga riwayat ATS tidak berubah. Index riwayat ditambah `target_service`. Semua query ke tabel-tabel ini memfilter `target_service`.

`tenant_studio.tenant_metadata` **tidak** diberi kolom layanan, karena daftar tenant dipakai bersama lintas layanan dalam satu env.

Daftar tenant di sidebar mengikuti logika yang ada sekarang (gabungan `tenant_metadata` dan `tenant_id` yang muncul di tabel config), tetapi tabel config yang dipakai adalah tabel milik layanan aktif.

### 4.5 Preset lokal dan Sync Center

- Folder preset disimpan per layanan + domain di preferensi user (`presetDirs: { [service]: { tenant?, workflow? } }`). Kolom lama `preset_dir_tenant`/`preset_dir_workflow` tetap menjadi nilai untuk ATS.
- Layanan selain ATS **tidak** memakai folder ATS sebagai fallback. Bila foldernya belum diatur, Sync Center dan katalog preset meminta user memilih folder dulu. Ini mencegah preset ATS ter-sync ke `hris_db`.

### 4.6 Web: pemilih Layanan

- `StudioHeader.tsx`: `MenuButton` baru tepat di kanan pemilih env, dengan tampilan yang sama. Isinya daftar layanan beserta nama database (`HRIS · hris_db`) dan tanda ✓ pada layanan aktif. Layanan yang tidak tersedia di env aktif tampil disabled dengan hint alasannya.
- Breadcrumb menampilkan layanan aktif sebelum tenant, misalnya `HRIS › IDM · 3f2a… › EMPLOYEE_STABLE`.
- Mengganti layanan:
  - bila ada perubahan yang belum disimpan, memakai dialog konfirmasi yang sama dengan saat mengganti env;
  - memuat ulang daftar tenant dan config;
  - mempertahankan tenant terpilih bila tenant itu ada di layanan baru;
  - kembali ke domain `tenant_config` bila layanan baru tidak punya domain workflow.
- Semua request web mengirim `X-Target-Service`. Pilihan layanan disimpan ke preferensi user (`lastTargetService`).
- Pengalih domain (Tenant Config / Workflow Pipeline) disembunyikan bila layanan aktif tidak punya tabel workflow.

### 4.7 Bandingkan, Salin, Duplikat, Export SQL

- Layar Bandingkan antar env: kedua sisi memakai layanan yang sama, yaitu layanan aktif. Pemilih env per sisi tetap ada, tetapi tidak ada pemilih layanan per sisi.
- Popup Salin config / Duplikat tenant: tujuan berada di layanan aktif. Env tujuan yang tidak punya layanan itu tampil disabled.
- Duplikat tenant menyalin domain `tenant_config` dan, bila ada, `workflow_pipeline` milik layanan aktif dalam satu transaksi, seperti sekarang.
- Export SQL memakai nama tabel schema-qualified dari registri dan aturan id sesuai `idType`. Header komentar file SQL mencantumkan layanan dan database, misalnya `-- layanan: HRIS (hris_db)`.

### 4.8 Validator

Validator yang sama dipakai untuk semua layanan, karena bentuk `value` dibaca oleh mesin yang sama (`packages/tenant-configurations`). Peringatan yang sudah ada tentang `isFile` + `resolvePaths` tetap berlaku, dan `resolvePaths` tetap tidak boleh dihapus otomatis.

### 4.9 MCP

Tool MCP yang sudah ada (`list_tenants`, `list_configs`, `get_config`, `compare_configs`, `get_history`, `preview_change`, `validate_config`) mendapat parameter opsional `service` (default `ats`) yang diteruskan sebagai `X-Target-Service`. `list_envs` juga mengembalikan layanan yang tersedia per env. MCP tetap hanya-baca dan tidak mendapat tool tulis.

## 5. Urutan pengerjaan (diputuskan user: HRIS dulu)

1. Registri layanan, koneksi per env + layanan, middleware, migrasi Neon, pemilih Layanan di web. ATS harus tetap berjalan persis seperti sebelumnya.
2. HRIS penuh: tenant config + workflow, termasuk penanganan `id` varchar, `type`, dan `is_active`. Diuji di dev dan staging.
3. Organization, Auth, Communication: entri registri + uji (termasuk FK Organization).
4. MCP: parameter `service`.

## 6. Pengujian yang diharapkan

- Uji unit untuk registri: setiap layanan menghasilkan SQL dengan tabel, kolom tipe, dan cast id yang benar (termasuk Export SQL untuk `idType = "varchar"` dan schema `core` / `workflow_pipelines`).
- Uji middleware: kombinasi env + layanan yang tidak ada atau tidak tersedia ditolak, pool tidak tertukar antar layanan.
- Uji migrasi Neon: data lama menjadi `ats`, dan query riwayat/preset/batch terfilter per layanan.
- Uji manual di dev: buka, edit, simpan, riwayat, salin antar tenant, bandingkan dev ↔ staging, dan Export SQL untuk HRIS. Lalu ulangi beberapa skenario ATS untuk memastikan tidak ada regresi.

## 7. Diserahkan ke builder

- Struktur kode internal (nama file, pembagian modul), selama route lama tetap memakai `domainOf(req)` atau penggantinya yang setara.
- Bentuk persis response `GET /api/envs` untuk daftar layanan.
- Cara cache status ketersediaan layanan (berapa lama sebelum di-ping ulang).
- Detail visual hint layanan disabled, selama sesuai komponen UI yang ada.
