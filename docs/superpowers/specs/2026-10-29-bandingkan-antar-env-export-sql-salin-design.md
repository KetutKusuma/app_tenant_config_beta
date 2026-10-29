# Desain: Bandingkan Antar Env, Export SQL, dan Salin Config

- Tanggal: 2026-10-29
- Status: draf, menunggu persetujuan user
- Repo: `app_tenant_config_beta` (web `apps/web`, BFF `apps/bff`)
- Mockup (lokal, tidak di-commit): `.superpowers/brainstorm/*/content/bandingkan-antar-env.html` dan `export-dan-salin.html`

## 1. Latar belakang dan alasan

Konfigurasi tenant (`tenant_configurations` dan `pipeline_workflow_configurations`) disimpan terpisah di tiap env: development, neondb (salinan dev), staging, dan nanti production. Tenant yang sama punya `tenant_id` berbeda di tiap env, dihubungkan lewat kode dasar (`IDM`, `IDM_STAGING`, `IDM_PROD`).

Kebutuhan user:

1. **Melihat perbedaan config satu tenant antar env**, misalnya Indomaret di Development dibanding Indomaret di Staging, untuk *semua* config sekaligus, lalu membuka diff tiap config langsung. Fitur banding yang ada sekarang hanya bisa membandingkan tenant di env yang sama, satu config per kali, dan labelnya membingungkan (nama kiri dan kanan digabung dalam satu bar "A vs B").
2. **Menghasilkan SQL** untuk menerapkan config ke env lain tanpa aplikasi menulis langsung ke database. Ini wajib untuk Production (aplikasi tidak boleh menulis ke Production), dan juga bisa dipakai untuk Development/Staging. SQL bisa berisi satu atau banyak config.
3. **Menyalin semua config satu tenant ke tenant lain di env lain** (kasus utama: Development tenant X ke Staging tenant Y) langsung dari aplikasi, dengan konfirmasi tambahan agar user benar-benar yakin sebelum data tersimpan.

User menegaskan Export SQL dan Salin adalah **dua fitur berbeda** karena kebutuhannya berbeda, tetapi keduanya diakses dari layar Bandingkan yang sama.

## 2. Tujuan, bukan tujuan, anti-tujuan

**Tujuan**

- Layar Bandingkan baru: pilih env + tenant kiri dan env + tenant kanan, lihat daftar semua config dengan status, klik untuk melihat diff.
- Judul tiap panel diff ada tepat di atas JSON-nya (env, tenant, config_type); tidak ada lagi tulisan "vs".
- Export SQL untuk satu atau banyak config yang dicentang, ke env tujuan mana pun termasuk Production (input `tenant_id` manual).
- Salin semua config tenant kiri ke tenant kanan, langsung ke DB kanan, dengan ringkasan dan popup konfirmasi.
- Semua alur yang menimpa config (Simpan, Sync preset, Sync Center push, Salin) mencadangkan isi lama **sebelum** menulis ke DB (bagian 3a dan 7).

**Bukan tujuan**

- Aplikasi menulis ke Production. Production tetap read-only; perubahan ke Production hanya lewat SQL yang dijalankan di luar aplikasi.
- Menghapus config di env tujuan. Config yang hanya ada di tujuan dibiarkan.
- Mencatat Export SQL sebagai versi di History per config. Export belum menerapkan apa pun, jadi hanya dicatat sebagai batch (bagian 7).
- Tombol "batalkan satu batch sekaligus". Data untuk itu tersedia (bagian 7), tetapi pemulihan tetap lewat History per config seperti sekarang.
- Menyalin `tenant_metadata` atau data selain dua tabel config.
- Mengubah alur MCP/AI. MCP tetap hanya-baca dan tidak mendapat tool baru.

**Anti-tujuan** (gagal walau secara teknis jalan)

- SQL yang membuat baris ganda `(tenant_id, config_type)` saat dijalankan, atau saat dijalankan dua kali.
- SQL yang rusak karena isi JSON mengandung tanda kutip.
- Memakai `tenant_id` env sumber di env tujuan (misalnya `tenant_id` dev masuk ke SQL staging).
- Salin yang menulis ke env tujuan tanpa ringkasan dan konfirmasi, atau yang diam-diam menimpa perubahan orang lain.
- Salin yang setengah jadi tanpa user tahu mana yang berhasil dan mana yang tidak.
- Config tertimpa tanpa salinan isi lamanya tersimpan lebih dulu.

## 3. Batasan dari kode dan database yang ada

**BFF (`apps/bff/src`)**

- Env dipilih per request lewat header `X-Target-Env` (`envs.ts`, `targetEnvMiddleware`). `poolFor(name)` bisa membuka pool env mana pun, jadi satu request BFF bisa membaca dua env.
- Penjaga tulis: `assertWritable(req, res)`: env read-only → 403 `ENV_READONLY`; env dilindungi tanpa header `X-Confirm-Env` yang cocok → 428 `ENV_CONFIRM_REQUIRED`. Saat ini `staging` dan `neondb` dilindungi; `development` tidak; `production` (template `envs/production.env.example`) read-only dan dilindungi.
- SQL disusun sebagai string dengan `esc()` (`db.ts`); tidak ada ORM. Semua nilai di SQL wajib lewat `esc()`.
- Perbandingan JSON kanonik (urutan kunci diabaikan): `canonicalize` / `sameJson` di `presetSync.ts`.
- Riwayat: `snapshotBeforeChange(row, summary, author, env)` di `presetSync.ts` menulis ke `tenant_studio.tenant_config_histories` (Neon, DB terpisah dari DB target).
- Domain: `DOMAINS` di `domain.ts` (`tenant_config` → `public.tenant_configurations`, kolom `config_type`, ada `path`; `workflow_pipeline` → `public.pipeline_workflow_configurations`, kolom `workflow_config_type`, tanpa `path`). Domain aktif lewat header `X-Config-Domain`.
- Tenant per env disimpan di Neon `tenant_studio.tenant_metadata` dengan PK `(target_env, tenant_id)`; kode dasar dihitung dengan `baseTenantCode(code, suffix)`. `GLOBAL_DEFAULT` = config tanpa tenant (`tenant_id IS NULL` di DB target).

**Database target (`ats_db`, dicek di neondb 2026-10-29)**

- Kedua tabel hanya punya PK `id`. **Tidak ada unique key `(tenant_id, config_type)`**, jadi INSERT biasa bisa membuat baris ganda.
- `tenant_configurations.id` default `gen_random_uuid()`. `pipeline_workflow_configurations.id` **tanpa default**, jadi SQL harus mengisi `id` sendiri (`gen_random_uuid()` tersedia di server).
- Soft delete lewat `deleted_at`. Baris aktif = `deleted_at IS NULL`.
- `group_id` hampir selalu sama dengan `tenant_id` (58 dari 60 baris tenant di `tenant_configurations`); ada 1 baris dengan `group_id` NULL dan 1 yang berbeda.
- `is_default` tidak selalu sama dengan "tanpa tenant": ada 4 baris tenant dengan `is_default = true` dan 3 baris global workflow dengan `is_default = false`.
- Sudah ada 1 pasangan ganda `(tenant_id, workflow_config_type)` aktif di `pipeline_workflow_configurations`. Data ganda memang bisa terjadi.

**UI (aturan yang berlaku di Studio)**

- Satu tombol utama per header/dialog; aksi lain ghost atau icon-only dengan tooltip. User tidak suka tombol berwarna penuh yang mencolok.
- Teks UI berbahasa Indonesia.
- Aksi berbahaya pakai `TypeToConfirmDialog` (ketik teks untuk konfirmasi).
- Aksi penting jangan hanya muncul saat hover atau klik kanan.
- Tema editor Monaco `studio-dark` (`lib/monacoTheme.ts`).

## 3a. Pekerjaan pertama: cadangkan dulu, baru tulis (alur simpan yang sudah ada)

Dikerjakan **paling awal**, sebelum Fitur 1, atas permintaan user.

**Masalah**: tiga alur tulis yang ada sekarang menulis ke DB target dulu, baru mencadangkan isi lama ke `tenant_config_histories`. Kalau pencadangan gagal (Neon putus, error query), DB sudah berubah dan isi lamanya hilang.

| Alur | Lokasi | Sekarang |
| :-- | :-- | :-- |
| Simpan biasa | `routes/configs.ts`, `PUT /api/configs/:configId` | UPDATE → INSERT history |
| Sync preset ke DB | `routes/references.ts`, `POST /api/references/sync-single` | UPDATE → INSERT history |
| Sync Center push | `routes/sync.ts`, `POST /api/sync/apply` (cabang update) | UPDATE → `snapshotBeforeChange` |
| Hapus config | `routes/configs.ts`, `DELETE /api/configs/:configId` | INSERT history → soft delete (sudah benar, tidak diubah) |

**Urutan baru** (berlaku untuk tiga alur di atas, dan dipakai juga oleh Salin di bagian 6):

1. Baca baris saat ini dan cek versi (`staleVersionError`) seperti sekarang. Kalau versi bentrok, tolak (409) tanpa mencadangkan apa pun.
2. **Cadangkan isi lama** ke `tenant_config_histories` (nomor versi berikutnya, ringkasan perubahan, author, env). Kalau gagal → kembalikan error dan **jangan menulis ke DB target**.
3. Tulis ke DB target dengan pengecekan versi seperti sekarang (`WHERE … AND updated_at::text = <version_token>`).
4. Kalau langkah 3 gagal atau tidak mengubah baris (versi berubah di antara langkah 1 dan 3), **hapus entri cadangan dari langkah 2**, lalu kembalikan error/409 seperti sekarang.
5. Kalau penghapusan di langkah 4 juga gagal, catat di log server saja. Entri sisa itu berisi isi yang masih sama dengan DB, jadi tidak merusak apa pun.

**Ketentuan**

- Dibuat satu helper bersama di `presetSync.ts`, misalnya pengganti `snapshotBeforeChange` yang mengembalikan id entri History plus fungsi untuk membuang entri itu. Dengan begitu ketiga alur dan Salin memakai logika yang sama.
- Bentuk respons API, kode status, dan arti entri History (isi **sebelum** perubahan, dengan ringkasan perubahan yang dilakukan) tidak berubah. Web tidak perlu diubah untuk pekerjaan ini.
- Penomoran versi tetap `MAX(version) + 1` per `core_config_id` + `target_env`. Risiko dua simpan bersamaan mendapat nomor yang sama sudah ada sejak dulu dan tidak diperbaiki di sini.

## 4. Fitur 1: Layar Bandingkan

Keputusan user: **tata letak A**, yaitu layar Bandingkan penuh dengan daftar config di kiri dan diff di kanan (lihat mockup `bandingkan-antar-env.html`, opsi A).

**Bar atas**

- Kiri: pemilih env + pemilih tenant. Kanan: pemilih env + pemilih tenant. Di antaranya tombol tukar (⇄).
- Env yang bisa dipilih: semua profil dari `GET /api/envs` (development, neondb, staging, dan production bila profilnya ada). Kiri dan kanan boleh env yang sama; itu menggantikan banding antar tenant yang lama.
- Daftar tenant di tiap sisi mengikuti env yang dipilih di sisi itu (dari `tenant_metadata` env tersebut), bukan env aktif Studio.
- Default saat dibuka: kiri = env aktif + tenant aktif. Kanan = env lain, dengan tenant yang kode dasarnya sama (`IDM` → `IDM_STAGING`). Kalau tidak ada yang cocok, tenant kanan dikosongkan dan user memilih sendiri.
- Ringkasan jumlah: total config, berapa sama, berapa beda, berapa hanya di satu sisi.
- Aksi di kanan bar: **Export SQL (n)** sebagai tombol utama (n = jumlah config dicentang), **Salin ke Kanan…** sebagai tombol ghost, dan tutup (✕).

**Daftar config (kolom kiri)**

- Gabungan semua config_type dari tenant kiri dan kanan untuk **domain aktif** (tenant_config atau workflow_pipeline).
- Tiap baris: kotak centang, nama config_type, status:
  - **Sama**: isi JSON identik secara kanonik (`sameJson`).
  - **Beda · N**: isi berbeda; N = jumlah perubahan.
  - **Hanya Kiri** / **Hanya Kanan**: config hanya ada di satu sisi.
- Kotak cari untuk menyaring nama config.
- Pintasan "Pilih yang beda" untuk mencentang semua baris Beda + Hanya Kiri sekaligus.
- Urutan: Beda dan Hanya Kiri/Kanan di atas, Sama di bawah.
- Kalau satu sisi punya lebih dari satu baris aktif untuk config_type yang sama (data ganda), baris itu ditandai peringatan "Ganda" dan tidak bisa dicentang untuk Export maupun disalin, sampai datanya dibereskan.

**Panel diff (kanan)**

- Klik satu baris untuk membuka diff config itu tanpa menutup layar.
- Tiap panel punya judul sendiri tepat di atas JSON-nya: titik warna env, nama env, nama tenant (dengan kode), dan config_type. Tidak ada "vs".
- Navigasi perubahan sebelumnya/berikutnya dan hitungan perubahan seperti Visual Diff sekarang.
- Layar ini **hanya untuk melihat**: tidak ada simpan, terapkan, atau edit di panel diff. Memindahkan data hanya lewat Export SQL atau Salin ke Kanan.

**Pintu masuk**

- Menu "Bandingkan" di header Studio mendapat item baru **"Antar env / semua config…"** yang membuka layar ini. Lima item yang sudah ada (tenant lain, database terbaru, versi awal, preset lokal, History) tetap ada dan tetap bekerja seperti sekarang.
- `CompareTenantModal` dan split "tenant lain" yang bisa mengedit (simpan ke tenant pembanding, Terapkan, Missing Views, tukar posisi) **tetap ada**, termasuk pintasan di sidebar. Keputusan user: kedua cara banding dipertahankan.

## 5. Fitur 2: Export SQL

Dibuka dari tombol **Export SQL (n)** di layar Bandingkan untuk config yang dicentang (1 atau banyak). Mockup: `export-dan-salin.html`, bagian 2.

**Isian dialog**

- **Env tujuan**: Development, NeonDB, Staging, atau **Production (isi manual)**. Production selalu ada di pilihan walau profil `production.env` belum ada.
- **Tenant tujuan**
  - Untuk env yang punya profil (Development, NeonDB, Staging): pilih dari tenant yang terdaftar di env itu. Kalau belum ada, tombol **+ Tambah tenant baru di <env>** membuka form tambah tenant untuk env tersebut (bukan env aktif Studio). Setelah tersimpan, tenant baru langsung terpilih.
  - Untuk Production: isi **`tenant_id`** (wajib, format UUID, atau `GLOBAL_DEFAULT` untuk config tanpa tenant) dan **`group_id`** (opsional; kosong = sama dengan `tenant_id`, sesuai pola data yang ada). Kalau profil `production.env` sudah ada dan punya tenant terdaftar, tenant Production juga bisa dipilih dari daftar.
- **Kalau config sudah ada di tujuan**: Timpa (UPDATE) atau Lewati. Default: Timpa.
- **Sumber isi**: Kiri atau Kanan. Default: Kiri.
- Export SQL **tidak** menulis apa pun ke DB target. Setiap export dicatat sebagai batch di Neon, berisi SQL dan isi lama tujuan bila bisa dibaca (bagian 7). Membuat tenant baru lewat tombol "+ Tambah tenant" hanya menulis ke `tenant_metadata` (Neon), sama seperti form tambah tenant yang ada.
- Kalau env tujuan tidak bisa dibaca (Production tanpa profil, atau DB tidak terjangkau), dialog menampilkan peringatan: "Isi lama di tujuan tidak bisa dicadangkan otomatis". Export tetap boleh dilanjutkan.

**Hasil**

- Satu file `.sql` untuk semua config terpilih, tampil di pratinjau (Monaco, read-only), dengan tombol **Unduh .sql** (utama) dan **Salin** (ghost).
- Nama file: `<KODE_TENANT_TUJUAN>_<nama_tabel>_<YYYY-MM-DD>.sql`, misalnya `IDM_PROD_tenant_configurations_2026-10-29.sql`. Untuk Production dengan input manual, kodenya diambil dari kode dasar tenant sumber + `_PROD`.
- Isi SQL diambil dari DB sumber **saat tombol Export ditekan** (bukan dari tampilan yang mungkin sudah usang).

**Bentuk SQL**

Header komentar: sumber (env, tenant), tujuan (env, `tenant_id`, `group_id`), domain/tabel, waktu, nama user login, jumlah config, mode (timpa/lewati), dan catatan bahwa file ini dibuat Tenant Studio dan tidak dijalankan otomatis. Semua blok dibungkus `BEGIN; … COMMIT;`. Tiap config punya blok sendiri dengan komentar `-- [i/n] <config_type>`.

Mode **Timpa**, per config:

```sql
UPDATE public.tenant_configurations
   SET value = '<json>'::jsonb, path = '<path>', updated_at = NOW()
 WHERE tenant_id = '<tenant_id>' AND config_type = '<type>' AND deleted_at IS NULL;

INSERT INTO public.tenant_configurations
  (id, tenant_id, group_id, config_type, path, value, is_default, created_at, updated_at)
SELECT gen_random_uuid(), '<tenant_id>', '<group_id>', '<type>', '<path>', '<json>'::jsonb, <is_default>, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_configurations
   WHERE tenant_id = '<tenant_id>' AND config_type = '<type>' AND deleted_at IS NULL
);
```

Mode **Lewati**: hanya blok `INSERT … WHERE NOT EXISTS`.

Aturan pengisian:

- Tujuan `GLOBAL_DEFAULT`: kondisi `tenant_id IS NULL`, nilai kolom `tenant_id` dan `group_id` = `NULL`.
- Domain `workflow_pipeline`: tabel `public.pipeline_workflow_configurations`, kolom `workflow_config_type`, tanpa kolom `path`. `id` tetap diisi `gen_random_uuid()` karena kolomnya tidak punya default.
- `path` diambil dari baris sumber; kalau kosong, diturunkan dari config_type seperti `POST /api/configs` (`lowercase`, `_` → `-`).
- `is_default` diambil dari baris sumber.
- `group_id` = `group_id` tenant tujuan dari `tenant_metadata`, atau input manual untuk Production. Di semua env, `group_id` kosong diisi sama dengan `tenant_id` (bukan `NULL` seperti "Tambah config" sekarang). Aturan yang sama dipakai Salin ke Kanan. Alasan: ATS (`apps/ats/src/configurations/tenant-configuration/repositories/databases/*.repository.ts`) hanya memfilter berdasarkan `tenant_id`, sehingga kolom `group_id` tidak memengaruhi config yang dipakai. Data yang ada juga hampir selalu `group_id = tenant_id`. Untuk tujuan `GLOBAL_DEFAULT`, `group_id` tetap `NULL`.
- Semua nilai melalui `esc()`, termasuk JSON. SQL harus tetap benar walau JSON mengandung `'`.
- SQL aman dijalankan ulang: menjalankan file yang sama dua kali tidak membuat baris ganda.

## 6. Fitur 3: Salin ke Kanan

Dibuka dari tombol **Salin ke Kanan…** di layar Bandingkan. Kasus utama: Development tenant X → Staging tenant Y, tetapi berlaku untuk pasangan env apa pun yang bisa ditulis. Keputusan user: Salin ke Staging **boleh menulis langsung ke DB** lewat aplikasi, **asal ada popup konfirmasi tambahan**. Mockup: `export-dan-salin.html`, bagian 3. Popup konfirmasi tambahan belum ada di mockup.

**Cakupan**: semua config tenant kiri pada domain aktif. Centang di daftar tidak dipakai di sini; centang hanya untuk Export SQL.

**Langkah 1, dialog ringkasan** (tanpa isian ketik):

- Arah: `<env kiri> · <tenant kiri>` → `<env kanan> · <tenant kanan>`.
- Angka: **dibuat baru** (Hanya Kiri), **ditimpa** (Beda), **sama, dilewati** (Sama), **hanya di kanan, dibiarkan** (Hanya Kanan). Daftar nama config per kelompok bisa dibuka.
- Penjelasan bahwa setiap config yang berubah tercatat di History env tujuan, dan config yang hanya ada di kanan tidak dihapus.
- Tombol utama **Salin N config**, dengan N = dibuat baru + ditimpa. Tombol nonaktif bila N = 0.
- Kalau env kanan read-only (Production), tombol Salin tidak tersedia dan dialog menjelaskan bahwa Production hanya lewat Export SQL.

**Langkah 2, popup konfirmasi tambahan** (`TypeToConfirmDialog`):

- Teks tegas, misalnya: "Tulis 8 config ke **Staging · Indomaret (IDM_STAGING)**. 3 config yang sudah ada akan ditimpa."
- User mengetik kode tenant tujuan (misal `IDM_STAGING`) untuk mengaktifkan tombol.
- Popup ini sekaligus menjadi konfirmasi env dilindungi: request Salin dikirim dengan `X-Confirm-Env` = nama env tujuan, jadi popup "ketik nama env" bawaan tidak muncul lagi untuk aksi ini. Hasilnya tetap satu popup pengetikan.

**Perilaku saat menyalin**

- BFF membaca ulang isi sumber dan tujuan saat Salin ditekan. Kalau ada config tujuan yang sudah berubah sejak layar Bandingkan dimuat (dicek lewat `version_token` = `updated_at::text` dari saat banding), **seluruh salin dibatalkan**. User diminta memuat ulang perbandingan. Ini mencegah menimpa perubahan orang lain.
- Urutan wajib: **cadangkan dulu, baru tulis**. Detail di bagian 7.
  1. Buat batch berstatus `menunggu` dan simpan isi lama setiap config yang akan ditimpa ke History (Neon). Kalau langkah ini gagal, salin berhenti dan DB tujuan tidak disentuh.
  2. Tulis ke DB tujuan dalam **satu transaksi**: berhasil semua atau tidak ada yang tertulis.
  3. Catat versi 1 di History untuk config yang baru dibuat, lalu ubah status batch jadi `berhasil`.
  4. Kalau langkah 2 gagal: status batch jadi `gagal` dengan pesan error, dan entri History cadangan dari batch itu dihapus (DB tujuan tidak berubah, jadi cadangannya tidak dibutuhkan dan hanya membingungkan di panel History).
- Config Beda: UPDATE `value` (+ `path` untuk tenant_config) dan `updated_at`. Isi lamanya sudah tercadang di langkah 1 dengan ringkasan "Sebelum disalin dari <env kiri> · <kode tenant kiri>".
- Config Hanya Kiri: INSERT baris baru (`id` baru, `tenant_id`/`group_id` tenant kanan, `is_default` dan `path` dari sumber), lalu catat History versi 1 dengan ringkasan "Disalin dari <env kiri> · <kode tenant kiri>".
- Config Sama dan Hanya Kanan tidak disentuh.
- Kalau pencatatan versi 1 (langkah 3) gagal, data tetap tersimpan, status batch tetap `berhasil`, dan user mendapat peringatan berisi daftar config yang versi 1-nya tidak tercatat. Isi lama yang ditimpa tetap aman karena sudah dicadangkan di langkah 1.
- Setelah selesai: notifikasi hasil (dibuat N, ditimpa M) dan daftar di layar Bandingkan dimuat ulang (seharusnya jadi Sama).
- Baris bertanda "Ganda" ikut dilewati dan disebut di ringkasan.

## 7. Riwayat dan cadangan sebelum ditimpa

Kebutuhan user: isi config yang lama harus tersimpan **sebelum** ditimpa, dan jejak Salin/Export harus bisa dilihat lagi. User mengizinkan penambahan tabel/kolom dan menyerahkan desainnya. Semua perubahan skema ada di **Neon, schema `tenant_studio`**. DB target `ats_db` (milik ATS) tidak diubah sama sekali.

**Tabel baru `tenant_studio.config_change_batches`**: satu baris per Salin atau Export.

| Kolom | Tipe | Isi |
| :-- | :-- | :-- |
| `id` | uuid, PK | id batch |
| `kind` | text | `salin` atau `export_sql` |
| `domain` | text | `tenant_config` atau `workflow_pipeline` |
| `source_env`, `source_tenant_id`, `source_tenant_code` | text | sumber |
| `target_env` | text | nama profil env tujuan, atau `production-manual` bila Production diisi manual |
| `target_tenant_id`, `target_group_id`, `target_tenant_code` | text | tujuan |
| `mode` | text | `timpa` atau `lewati` (Salin selalu `timpa`) |
| `config_types` | text[] | config yang ikut |
| `counts` | jsonb | `{ dibuat, ditimpa, sama, hanyaTujuan, ganda }` |
| `status` | text | Salin: `menunggu` → `berhasil` / `gagal`. Export: `diekspor` |
| `error` | text | pesan bila gagal |
| `sql_text` | text | isi file SQL (Export saja) |
| `before_snapshot` | jsonb | Export saja: isi tujuan saat export, `{ "<config_type>": { "id", "value", "updated_at" } \| null }`; `null` bila tujuan tidak bisa dibaca |
| `author_name` | text | user login |
| `created_at`, `finished_at` | timestamptz | waktu |

Indeks: `(target_env, target_tenant_id, created_at desc)`.

**Kolom baru `tenant_studio.tenant_config_histories.batch_id`** (uuid, boleh NULL, dengan indeks). Diisi untuk entri History yang dibuat oleh Salin, sehingga setiap versi tahu berasal dari batch mana. Entri lama dan simpan biasa tetap NULL.

**Cara pakai**

- Salin: lihat langkah di bagian 6. Isi lama setiap config yang ditimpa masuk ke `tenant_config_histories` (dengan `batch_id`) *sebelum* DB tujuan diubah, memakai penomoran versi yang sama dengan `snapshotBeforeChange`.
- Export SQL: saat file dibuat, BFF mencatat batch `export_sql` berisi `sql_text`. Kalau env tujuan punya profil yang bisa dibaca (Development, NeonDB, Staging, atau Production read-only begitu profilnya ada), isi tujuan saat itu disimpan di `before_snapshot`. Nilai ini menggambarkan kondisi *saat export*, bukan saat SQL dijalankan orang lain nanti, dan dialog menyebutkannya.
- Panel History per config: entri dengan `batch_id` diberi label kecil "Salin · <env sumber> · <kode tenant sumber>". Pemulihan tetap memakai Restore yang ada (muat versi ke editor, lalu simpan).
- Layar Bandingkan mendapat tombol ghost **Riwayat** yang membuka daftar batch untuk pasangan tenant yang sedang dibuka (atau semua batch, dengan filter). Isinya: waktu, jenis, sumber → tujuan, angka, status, dan pembuat. Untuk batch Export ada aksi **Unduh SQL lagi** dan **Unduh isi lama (.json)** dari `before_snapshot`.

**Migrasi**: ditambahkan di `apps/bff/src/studioSchema.ts` dengan pola idempotent yang sama (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Migrasi langsung berjalan ke Neon saat BFF restart (`tsx watch`). Builder perlu memberi tahu user sebelum menyimpan file itu.

## 8. Perubahan pada split editor yang sudah ada

Split editor (tenant lain, preset lokal, versi DB, versi awal, history) tetap dipakai untuk mengedit. Bar "A vs B" di Visual Diff (`EditorArea.tsx`, sekitar baris 76–110) diganti judul per panel tepat di atas tiap sisi, dengan pola yang sama seperti layar Bandingkan (sumber, nama, config_type). Tulisan "vs" dihapus di semua mode split, termasuk mode tenant.

## 9. Siapa yang memutuskan apa

**Diputuskan user**

- Urutan kerja: perbaikan urutan cadangkan-dulu (3a) → Bandingkan → Export SQL → Salin.
- Alur simpan yang ada (Simpan, Sync preset, Sync Center push) diubah jadi cadangkan dulu; kalau cadangan gagal, tulis ke DB juga batal.
- Banding antar env (neondb, staging, development) per tenant, semua config sekaligus, klik untuk diff.
- Tata letak A (layar penuh, daftar kiri, diff kanan).
- Judul tiap panel di atas JSON-nya, tanpa "vs".
- Export SQL dan Salin diakses langsung dari layar Bandingkan.
- Tujuan Production: input `tenant_id` manual. Tujuan Dev/Staging: pilih tenant yang ada atau tambah tenant baru dulu.
- SQL bisa untuk satu atau banyak config.
- Salin ke Staging boleh langsung menulis ke DB, dengan popup konfirmasi tambahan.
- Banding tenant lama (yang bisa mengedit) tetap dipertahankan; layar baru ditambahkan sebagai item menu baru.
- Isi lama harus tersimpan sebelum ditimpa. Tabel/kolom boleh ditambah; desainnya diserahkan ke Claude.
- Tebakan yang dikonfirmasi user: tenant kanan default dicocokkan lewat kode dasar; daftar mengikuti domain aktif; layar Bandingkan hanya untuk melihat; banding env yang sama tetap bisa.

**Keputusan Claude** (ditunjukkan di mockup tanpa dikoreksi, atau ditetapkan di dokumen ini; mohon dicek)

- SQL memakai pola UPDATE + `INSERT … WHERE NOT EXISTS` karena tidak ada unique key, dengan pilihan Timpa/Lewati (default Timpa).
- Pilihan sumber isi Kiri/Kanan di Export (default Kiri).
- Satu file `.sql` untuk semua config terpilih; format nama file di atas.
- `group_id` kosong = sama dengan `tenant_id`, di semua env tujuan (Export dan Salin).
- Export tidak masuk History per config; dicatat sebagai batch beserta SQL dan isi lama tujuan bila bisa dibaca.
- Desain riwayat (bagian 7): tabel `config_change_batches` + kolom `batch_id`, hanya di Neon; urutan cadangkan-dulu; entri cadangan dihapus bila salin gagal; tombol Riwayat di layar Bandingkan.
- Salin selalu mencakup semua config kiri (centang hanya untuk Export).
- Popup konfirmasi Salin sekaligus menggantikan popup "ketik nama env" bawaan, supaya user cukup mengetik sekali.
- Salin batal seluruhnya bila ada config tujuan yang berubah sejak dibandingkan; tulisan ke DB tujuan dalam satu transaksi.
- Config ganda ditandai dan dilewati.

## 10. Diserahkan ke builder

- Bentuk endpoint BFF (misalnya satu endpoint banding yang menerima env + tenant kiri/kanan dan mengembalikan daftar status, endpoint export SQL, endpoint salin), nama, dan bentuk respons, mengikuti konvensi di `routes/*.ts` (`{ data }` / `{ error }`, `esc()`, `domainOf`, `assertWritable` untuk env tujuan).
- Apakah isi JSON dikirim bersama daftar atau dimuat saat baris diklik.
- Cara menghitung N pada "Beda · N" (jumlah blok perubahan diff atau jumlah path JSON yang berbeda), asal konsisten antara daftar dan panel diff.
- Struktur state di web (hook baru setara `useCompareActions`, komponen baru di `components/studio/`), dan apakah layar Bandingkan berupa overlay layar penuh atau rute tersendiri.
- Cara form tambah tenant dipakai ulang untuk env selain env aktif.
- Tes: minimal tes unit untuk pembuat SQL (tenant biasa, `GLOBAL_DEFAULT`, domain workflow, JSON dengan tanda kutip, mode Timpa/Lewati) dan untuk penentuan status banding (sama/beda/hanya satu sisi/ganda). Untuk Salin, tes urutan: cadangan gagal → DB tujuan tidak disentuh; transaksi tujuan gagal → batch `gagal` dan cadangan batch itu terhapus.
- Untuk bagian 3a: tes urutan pada ketiga alur (cadangan gagal → DB tidak berubah; versi bentrok saat UPDATE → entri cadangan terhapus dan respons 409 tetap sama). Verifikasi UI bisa memakai pola headless Chrome dengan `/api/*` di-mock seperti yang pernah dipakai.
