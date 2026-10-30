# Desain: Salin Config, Duplikat Tenant, dan Catatan Perubahan Wajib

- Tanggal: 2026-10-30
- Status: draf, menunggu persetujuan user
- Repo: `app_tenant_config_beta` (web `apps/web`, BFF `apps/bff`)
- Dasar: dibangun di atas branch `feat/bandingkan-antar-env` (layar Bandingkan, Export SQL, Salin ke Kanan, tabel `config_change_batches`, urutan cadangkan-dulu). Branch itu belum di-merge; pekerjaan ini memakai mesin Salin dan Export SQL dari sana.
- Spec sebelumnya: `docs/superpowers/specs/2026-10-29-bandingkan-antar-env-export-sql-salin-design.md`

## 1. Latar belakang dan alasan

Sekarang config hanya bisa disalin dari layar "Bandingkan antar env". Caranya: pilih env + tenant kiri dan kanan, lalu "Salin ke Kanan". Itu cocok untuk menyamakan dua tenant yang sudah ada, tetapi tidak praktis untuk kebutuhan sehari-hari user:

1. **Menyalin satu atau beberapa config** dari tenant yang sedang dibuka ke tenant lain, di env yang sama maupun env lain, langsung dari sidebar.
2. **Menduplikat seluruh config satu tenant** ke tenant lain, termasuk tenant yang belum terdaftar di Studio. Tenant itu sudah ada di ATS/organization; Studio tidak membuat tenant, hanya mendaftarkannya ke daftar Studio di env tujuan lalu mengisi config-nya.

User juga ingin **setiap perubahan yang menimpa config punya jejak di History beserta alasan yang ditulis user**. Sekarang alasan itu sering kosong atau berisi teks bawaan "Update via Tenant Studio", sehingga History tidak menjawab pertanyaan "kenapa ini diubah".

## 2. Tujuan, bukan tujuan, anti-tujuan

**Tujuan**

- Klik kanan config di sidebar → "Salin ke…".
- Klik kanan tenant di sidebar → "Duplikat tenant…", dan tombol yang sama di form Edit Tenant.
- Satu popup "Salin config" untuk kedua pintu masuk: pilih env tujuan, tenant tujuan (terdaftar atau daftarkan baru), centang config, isi catatan, konfirmasi.
- Duplikat tenant menyalin `tenant_configurations` dan `pipeline_workflow_configurations` sekaligus dalam satu transaksi.
- Bisa dalam env yang sama (tenant berbeda) maupun antar env.
- Catatan perubahan wajib (alasan dari user + ringkasan otomatis dari diff) untuk semua alur yang menimpa config, kecuali Simpan cepat.

**Bukan tujuan**

- Membuat tenant di ATS/organization. Tenant tujuan sudah ada di sana.
- Memverifikasi bahwa `tenant_id` benar-benar ada di service organization. Studio hanya mengecek formatnya.
- Menulis ke Production dari aplikasi. Untuk Production popup menghasilkan file SQL (Export SQL yang sudah ada).
- Menghapus config yang hanya ada di tujuan.
- Membuat ringkasan dengan AI.
- Mengubah Tambah config, Hapus config, atau alur MCP. MCP tetap hanya-baca.
- Perbaikan otomatis `resolvePaths` saat `isFile`. User memintanya (2026-10-30) sebagai fitur terpisah nanti. `resolvePaths` yang ada tidak boleh disentuh oleh fitur ini.

**Anti-tujuan** (gagal walau secara teknis jalan)

- Config di tujuan tertimpa tanpa salinan isi lama di History.
- Entri History tanpa alasan dari user (kecuali Simpan cepat).
- User tidak tahu persis apa yang akan dan sudah terjadi: config mana yang baru, ditimpa, dilewati, atau gagal.
- Setengah tersalin: sebagian config tertulis, sebagian tidak, tanpa user tahu.
- Setelah disalin dalam env yang sama, ATS mengambil config milik tenant yang salah (lihat bagian 8).

## 3. Pintu masuk

| Dari | Menu | Isi awal popup |
| :-- | :-- | :-- |
| Klik kanan baris config di sidebar | "Salin ke…" | Domain config itu saja; config itu tercentang, config lain di domain yang sama tampil tidak tercentang. Sumber = env + tenant aktif. |
| Klik kanan baris tenant di sidebar | "Duplikat tenant…" | Kedua domain; semua config yang bisa disalin tercentang. Sumber = env aktif + tenant itu. |
| Form Edit Tenant (`TenantModal`) | tombol ghost "Duplikat tenant…" | Sama dengan baris di atas. |

Menu yang sudah ada (Copy tenant_id, Copy group_id, Copy nama config, Copy ID) tetap ada. Tombol di form Edit Tenant mengikuti keputusan lama: aksi penting tidak boleh hanya ada di klik kanan.

## 4. Popup "Salin config"

Urutan isi popup, dari atas ke bawah:

1. **Sumber** (hanya ditampilkan): env, kode tenant, domain.
2. **Env tujuan**: semua profil env yang ada (Development, NeonDB, Staging, dan profil lain bila ada) plus entri tetap **"Production (isi manual)"** seperti di Export SQL sekarang (`production-manual`). Env yang sama dengan sumber boleh dipilih. Aturan mode:
   - Profil yang bisa ditulis → Salin langsung.
   - Profil `readonly` (termasuk `production` bila nanti `envs/production.env` dibuat) → mode "Unduh SQL". Isi tujuan dibaca untuk status dan `before_snapshot`, sama seperti Export SQL sekarang.
   - "Production (isi manual)" → mode "Unduh SQL" dengan `tenant_id`/`group_id` manual. Tujuan tidak bisa dibaca, jadi semua config sumber tampil dengan status **"Tujuan tidak dibaca"** dan tercentang. SQL-nya tetap aman dijalankan karena idempoten (UPDATE bila ada, INSERT bila belum).
3. **Tenant tujuan**: daftar tenant terdaftar di env tujuan, plus "+ Daftarkan tenant". Pilihan ini membuka form kecil: `tenant_id` (wajib, format UUID), `group_id`, kode, nama. Form memakai `POST /api/tenants` ke env tujuan, sama seperti "+ Tambah" di sidebar dan quick-add di Export SQL, dan menolak `tenant_id` yang sudah terdaftar di env itu. Pendaftaran terjadi saat user menekan "Daftarkan", sebelum menyalin. Kalau penyalinan kemudian dibatalkan atau gagal, tenant tetap terdaftar; itu tidak berbahaya dan bisa dihapus dari daftar seperti biasa. Env + tenant yang sama persis dengan sumber tidak bisa dipilih.
4. **Daftar config**: dikelompokkan per domain (Tenant Configurations, Pipeline Workflow). Tiap baris berisi kotak centang, `config_type`, dan status hasil membandingkan sumber dengan tujuan:
   - **Baru**: hanya ada di sumber. Bisa dicentang.
   - **Akan ditimpa**: ada di keduanya, isinya beda. Bisa dicentang, dan tercentang dari awal (keputusan user). Baris ini juga menampilkan ringkasan otomatis "yang berubah" (bagian 6).
   - **Sama**: tidak bisa dicentang, dilewati.
   - **Ganda**: ada lebih dari satu baris aktif di sumber atau tujuan. Tidak bisa dicentang, dengan keterangan.
   - Config yang hanya ada di tujuan ditampilkan di bawah dalam keadaan redup dengan label "Hanya di tujuan, dibiarkan".

   Ada centang "pilih semua" per kelompok, dan ringkasan jumlah di bawah daftar: "N baru, M ditimpa, K dilewati".
5. **Catatan (alasan)**: wajib, tidak boleh kosong atau hanya spasi, maksimal 500 karakter.
6. **Tombol utama**:
   - Env tujuan bisa ditulis: "Salin N config…" membuka konfirmasi ketik kode tenant tujuan, seperti Salin ke Kanan. Tombol mati bila N = 0, tenant tujuan belum dipilih, atau catatan kosong.
   - Env tujuan Production (read-only): tombol berubah jadi "Unduh SQL". Untuk Production, `tenant_id` dan `group_id` diisi manual seperti di Export SQL yang ada. Mode untuk config yang sudah ada di tujuan = Timpa (sesuai keputusan "Akan ditimpa" tercentang). File SQL berisi kedua tabel bila keduanya dipilih (bagian 7).
7. **Hasil**: setelah selesai, popup menampilkan ringkasan per config (dibuat / ditimpa / dilewati), tautan ke Riwayat, dan bila sumber atau tujuan adalah env + tenant yang sedang terbuka di Studio, daftar config dan editor dimuat ulang.

**`GLOBAL_DEFAULT`**:
- Tidak bisa dipilih sebagai tenant tujuan di popup ini. Menimpa config global berdampak ke semua tenant, jadi perubahan global tetap lewat Simpan di editor.
- Boleh menjadi sumber (misalnya untuk mengisi tenant baru dari config bawaan). Baris yang dibuat di tujuan selalu `is_default = false` dan memakai `group_id` tenant tujuan.
- "Duplikat tenant…" tidak muncul di menu klik kanan `GLOBAL_DEFAULT`; "Salin ke…" di config-nya tetap ada.

Esc menutup popup kecuali saat proses berjalan atau saat konfirmasi terbuka, sama seperti dialog Salin yang ada (`useDialogEsc`). Teks UI berbahasa Indonesia; satu tombol utama, sisanya ghost.

## 5. Penulisan ke env tujuan

Mesin yang dipakai sama dengan Salin ke Kanan (`compare/copyConfigs.ts`, `POST /api/compare/copy`), diperluas agar:

- Menerima **daftar config terpilih per domain**, bukan "semua yang beda".
- Menulis **dua tabel dalam satu transaksi** di DB tujuan. Kedua tabel ada di DB yang sama, jadi bila salah satu gagal, semuanya batal.
- Tetap memakai semua pengaman yang ada:
  - `assertWritable` lebih dulu.
  - Cadangkan dulu ke History, lalu tulis.
  - Versi tujuan yang dilihat user (`expectedTargetVersions`, per domain) dan daftar yang dikonfirmasi (`confirmedCreate`/`confirmedOverwrite`, per domain) dicek ulang di server. Bila berbeda, respons 409 `TARGET_CHANGED` sebelum batch, cadangan, atau tulis apa pun.
  - Advisory lock per tabel + tenant tujuan, diambil dalam urutan tetap (`tenant_configurations` dulu, lalu `pipeline_workflow_configurations`) supaya dua penyalinan bersamaan tidak saling mengunci.
  - Aturan COMMIT tidak pasti: cadangan disimpan dan batch ditandai gagal dengan pesan yang sudah ada.

Pilihan bentuk API, yaitu endpoint baru atau perluasan `POST /api/compare/copy` yang tetap kompatibel dengan Salin ke Kanan, diserahkan ke builder.

## 6. Catatan perubahan wajib

**Bentuk catatan.** Setiap entri History yang dibuat alur di bawah berisi:

`<alasan dari user> — <ringkasan otomatis>`

**Ringkasan otomatis** dibuat BFF tanpa AI, dari diff JSON isi lama dan isi baru (setelah `canonicalize`):

- Config baru: `Config baru`.
- Ditimpa: `Ubah N field: a.b, c[2].d, e (+K lainnya) · tambah X · hapus Y`. Path ditulis bertitik dengan indeks larik `[i]`. Maksimal 5 path ditampilkan. Bagian "tambah"/"hapus" hanya muncul bila jumlahnya lebih dari 0.
- Untuk Salin/Duplikat, asal salinan ikut ditulis: `Disalin dari development · IDM · Ubah 3 field: …`.
- Entri cadangan isi lama tetap diberi penanda "Sebelum …" seperti sekarang, ditambah alasan user.

**Berlaku untuk:**

| Alur | Catatan wajib | Keterangan |
| :-- | :-- | :-- |
| Simpan (dialog) | ya | Kolom alasan mulai kosong (tidak lagi terisi "Update via Tenant Studio"); tombol Simpan mati sampai diisi. Dialog menampilkan ringkasan otomatis sebagai pratinjau. |
| Simpan cepat | tidak | Tetap "Update via Tenant Studio", tetapi ringkasan otomatis tetap ditambahkan. |
| Salin ke… / Duplikat tenant | ya | Satu alasan untuk seluruh salinan; ringkasan otomatis per config. |
| Salin ke Kanan (layar Bandingkan) | ya | Disamakan dengan popup baru. |
| Sync preset | ya | Dialog alasan sebelum menulis. |
| Sync Center push | ya | Satu alasan untuk satu kali push (bisa banyak file); ringkasan otomatis per config. |
| Unduh SQL (Export) | ya | Alasan ditulis di komentar header SQL dan di batch; tidak masuk History karena belum menerapkan apa pun. |

BFF menolak (400) permintaan tulis tanpa alasan yang terisi untuk alur-alur bertanda "ya". Simpan cepat mengirim teks bawaannya sendiri, jadi aturan server cukup "tidak boleh kosong". Aturan "harus diketik user" dijaga di UI.

Pratinjau ringkasan otomatis di dialog Simpan dan di popup Salin boleh dihitung di web atau diminta dari BFF; itu pilihan builder. Teks yang **disimpan** selalu dihitung BFF.

## 7. Riwayat (batch) dan SQL

- Satu Salin/Duplikat = **satu batch** di `tenant_studio.config_change_batches` (`kind = "salin"`), walaupun berisi dua tabel. Untuk dua domain, `domain = "semua"` dan `config_types` diberi awalan domain (`tenant_config:X`, `workflow_pipeline:Y`) supaya tidak tertukar. `counts` dipecah per domain.
- Kolom baru `note text` di `config_change_batches` untuk alasan user. Migrasinya aditif dan idempoten di `apps/bff/src/studioSchema.ts`, dengan pola sama seperti `migrateChangeBatches`. Karena BFF berjalan dengan `tsx watch` dan migrasi langsung jalan ke Neon bersama, user diminta izin sebelum file itu disimpan, seperti sebelumnya.
- Panel Riwayat menampilkan alasan dan label domain "Semua" untuk batch dua tabel.
- Unduh SQL untuk Production dengan dua domain: satu file, satu `BEGIN … COMMIT`, bagian per tabel, aturan idempoten yang sama (UPDATE + `INSERT … WHERE NOT EXISTS`). Nama file `<KODE_TENANT_TUJUAN>_semua_<tanggal>.sql` untuk dua tabel; untuk satu tabel tetap seperti sekarang.

## 8. Path config yang bentrok di DB tujuan

ATS mencari config lewat path **tanpa filter tenant** (`TenantConfigurationDbRepository.findByPath`: `WHERE deleted_at IS NULL AND path = :path`, `getOne()`). Di NeonDB, setiap path yang terisi saat ini dipakai satu tenant saja (contoh: `/ats/vacancy-massive`, `/ats/lsi/candidate/candidate-pool`); banyak baris lain ber-path `NULL`.

Fakta yang mengikat:

- Baris dengan `path = NULL` tidak pernah cocok dengan `path = :path`, jadi tidak ikut bentrok.
- Bentrok terjadi bila **di DB tujuan** sudah ada baris aktif milik tenant lain dengan path yang sama. Ini tidak hanya terjadi di env yang sama. Contoh: menduplikat IDM dev ke tenant baru di staging, padahal IDM staging sudah memakai path yang sama, juga bentrok. Jadi pengecekan dilakukan terhadap DB tujuan untuk **setiap** salinan.
- Path yang ditulis = path sumber, atau bila kosong, diturunkan dari `config_type` (aturan spec sebelumnya). Pengecekan dilakukan terhadap path akhir ini.
- Masalah ini juga sudah ada di Salin ke Kanan dan Export SQL pada branch `feat/bandingkan-antar-env`. Aturan yang dipilih berlaku untuk ketiganya lewat satu fungsi bersama. Untuk Export SQL ke "Production (isi manual)" tujuan tidak bisa dibaca, jadi pengecekan dilakukan di dalam SQL: bila path sudah dipakai tenant lain, SQL membatalkan diri dengan pesan yang jelas.

**Keputusan user (opsi A):** config yang path-nya bentrok diberi status **"Path bentrok"**, dan kolom path di barisnya bisa diedit. Config itu tidak bisa dicentang atau disalin sampai path-nya unik di DB tujuan.

- **Saran awal:** kolom langsung terisi saran berawalan kode tenant tujuan (huruf kecil, `_` → `-`). Path yang diawali `/ats/` disisipi setelah `/ats/`, misalnya `/ats/vacancy-massive` → `/ats/idm-staging/vacancy-massive`. Path lain diberi awalan `<kode>/`. Bila saran itu pun sudah dipakai, ditambah akhiran `-2`, `-3`, dan seterusnya. (Rumus saran: keputusan Claude.)
- **Validasi:** path yang diedit dicek unik saat diketik (terhadap DB tujuan, tidak termasuk baris milik tenant tujuan sendiri), lalu dicek ulang di server di dalam transaksi. Bila saat itu sudah dipakai, respons 409 dan tidak ada yang ditulis.
- **Jejak:** path yang diganti dikirim per config dan ikut tercatat di ringkasan otomatis History: `path: /ats/vacancy-massive → /ats/idm-staging/vacancy-massive`.
- **Cakupan:** baris "Path bentrok" yang sama dipakai di dialog Salin ke Kanan dan Export SQL, lewat komponen dan fungsi yang sama.
- **Production (isi manual):** tujuan tidak bisa dibaca, jadi kolom path tetap bisa diedit manual dan SQL memeriksa sendiri. Bila path sudah dipakai tenant lain, SQL membatalkan diri (`RAISE EXCEPTION` di dalam `DO` block sebelum menulis) dengan pesan berisi path-nya.

Catatan untuk user: tenant tujuan hanya mendapat config lewat path baru itu kalau frontend ATS memanggil path tersebut. Ini batasan ATS (`findByPath` tanpa tenant), di luar Studio.

## 9. Kesalahan dan kasus tepi

- Tenant tujuan belum dipilih, catatan kosong, atau tidak ada yang dicentang → tombol utama mati, dengan alasan tertulis di dekat tombol.
- Tujuan berubah sejak popup dibuka → 409 `TARGET_CHANGED` dengan daftar config, tidak ada yang ditulis, dan popup menawarkan "Muat ulang".
- Env tujuan read-only selain Production → tombol menjelaskan bahwa env itu hanya-baca (seperti Salin ke Kanan sekarang).
- Env tujuan tidak terjangkau → pesan galat per sisi; tidak ada yang ditulis.
- Koneksi putus atau hasil tidak pasti → pesan netral "Hasil tidak pasti" seperti sekarang, mengarahkan ke Riwayat.
- Pendaftaran tenant gagal → pesan di form kecil; daftar config belum dimuat.
- Sumber berisi config Ganda → baris tidak bisa dicentang; config lain tetap bisa disalin.

## 10. Siapa yang memutuskan apa

**Keputusan user**

- Pintu masuk klik kanan config ("Salin ke…") dan klik kanan tenant ("Duplikat tenant…").
- Popup memilih env tujuan dan tenant tujuan; tenant baru didaftarkan di popup.
- Tenant sudah ada di ATS; Studio tidak membuatnya.
- Duplikat tenant menyalin kedua tabel sekaligus.
- "Akan ditimpa" tercentang dari awal.
- Setiap penimpaan wajib punya History dengan catatan dari user.
- Catatan wajib juga untuk Simpan biasa, Sync preset, dan Sync Center push. Simpan cepat dikecualikan.
- Catatan = alasan user (wajib) + ringkasan otomatis.
- Path bentrok: opsi A (status "Path bentrok", path bisa diedit dengan saran awal, wajib unik sebelum disalin).

**Keputusan Claude** (bisa dikoreksi)

- Satu popup untuk kedua pintu masuk; tombol tambahan di form Edit Tenant.
- "Salin ke…" dari baris config hanya menampilkan domain config itu.
- Pendaftaran tenant baru terjadi terpisah, sebelum menyalin, dan tidak dibatalkan bila salinan gagal.
- Production lewat "Unduh SQL" dengan mode Timpa; satu file untuk dua tabel.
- Satu batch untuk dua tabel (`domain = "semua"`), kolom baru `note`.
- Salin ke Kanan dan Unduh SQL ikut wajib catatan.
- Format ringkasan otomatis (maks 5 path, "+K lainnya").
- Simpan cepat tetap mendapat ringkasan otomatis.
- Catatan maksimal 500 karakter.
- Entri tetap "Production (isi manual)"; profil `readonly` mana pun = mode Unduh SQL; status "Tujuan tidak dibaca" untuk Production manual.
- `GLOBAL_DEFAULT` tidak bisa menjadi tujuan; boleh menjadi sumber dengan `is_default = false`.
- Cek bentrok path dilakukan terhadap DB tujuan untuk setiap salinan, dan berlaku juga untuk Salin ke Kanan dan Export SQL.

## 11. Diserahkan ke builder

- Bentuk API (endpoint baru atau perluasan yang kompatibel).
- Pratinjau ringkasan otomatis dihitung di web atau di BFF.
- Pembagian komponen web (memakai ulang `CopyConfigsDialog`/`ExportSqlDialog` atau komponen baru).
- Tata letak detail popup, selama urutan dan aturan di bagian 4 terpenuhi.
- Uji: fungsi murni (rencana per domain, ringkasan otomatis, validasi alasan, SQL dua tabel) wajib punya tes. Wiring DB dan UI mengikuti pola sebelumnya: dicek dengan `tsc` dan checklist uji tulis yang dijalankan user. AI tidak menulis ke DB mana pun.
