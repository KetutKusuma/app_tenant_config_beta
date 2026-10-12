# 📋 Checklist & Test Cases Pengujian Tenant Configuration Studio

Dokumen ini berisi daftar skenario pengujian (*test cases*) terstruktur untuk memverifikasi seluruh fitur yang baru saja dibangun: **Local Preset Editor**, **Sync Center**, **Pre-flight Validator Guardrail**, **Dokumentasi Dalam Aplikasi**, dan **Audit Trail Neon DB**.

Anda dapat menandai kotak centang `[ ]` menjadi `[x]` setelah berhasil menguji masing-masing skenario.

---

## 🎯 Ringkasan Status Pengujian

| Modul | Total Skenario | Status |
| :--- | :---: | :---: |
| **1. Local Preset Editor (Window Kanan)** | 8 Test Cases | `[ ]` Belum Diuji |
| **2. Sync Center (Bidirectional Sync)** | 6 Test Cases | `[ ]` Belum Diuji |
| **3. Pre-Flight Linter & Guardrail** | 4 Test Cases | `[ ]` Belum Diuji |
| **4. Dokumentasi Interaktif (DocsModal)** | 4 Test Cases | `[ ]` Belum Diuji |
| **5. Audit Trail & Version History** | 3 Test Cases | `[ ]` Belum Diuji |
| **6. Hapus Config (Validasi Ketik Nama)** | 4 Test Cases | `[ ]` Belum Diuji |
| **7. Format JSON & Linter Inspector** | 4 Test Cases | `[ ]` Belum Diuji |
| **8. Skill Tenant Configuration Antigravity** | 1 Test Case | `[x]` Selesai & Valid |
| **9. Split Screen & Komparasi Antar Tenant** | 8 Test Cases | `[ ]` Belum Diuji |
| **10. JSON Delta & Perbedaan Struktural (JSON Output)** | 9 Test Cases | `[ ]` Belum Diuji |
| **TOTAL** | **51 Test Cases** | `[ ]` Siap Pengujian |

---

## 🧪 Modul 1: Local Preset Editor (Window Kanan - Edit File Disk)

Fokus: Memastikan file lokal di folder preset (`/stable`) dapat diedit, diformat, dibatalkan, dan disimpan langsung ke disk tanpa mengubah database secara tidak sengaja.

- [ ] **TC-1.1: Membuka File Preset ke Window Kanan**
  - **Langkah:**
    1. Klik tombol **Presets (N)** di header atas untuk membuka laci katalog file preset.
    2. Klik salah satu file preset (misal: `candidate.example.json` atau `CANDIDATE.json`).
  - **Hasil yang Diharapkan:**
    - Split screen terbuka secara otomatis (Window Kiri: Database Live, Window Kanan: Preset Lokal).
    - Header window kanan menampilkan judul file dan path file.
    - Isi file JSON muncul rapi di Monaco Editor sebelah kanan.

- [ ] **TC-1.2: Deteksi Status Perubahan / Dirty Badge**
  - **Langkah:**
    1. Pada window kanan, ubah sedikit teks JSON (misal tambahkan spasi atau ganti satu label).
  - **Hasil yang Diharapkan:**
    - Muncul badge merah **"Belum disimpan"** di samping nama file pada header window kanan.
    - Tombol **Simpan File** dan tombol **Revert** aktif (tidak lagi disabled).

- [ ] **TC-1.3: Format JSON Instan `{ }`**
  - **Langkah:**
    1. Pada window kanan, buat indentasi JSON menjadi berantakan atau rapatkan barisnya.
    2. Klik tombol **`{ }`** di header window kanan.
  - **Hasil yang Diharapkan:**
    - Seluruh isi JSON di window kanan otomatis terformat rapi dengan indentasi 2 spasi.

- [ ] **TC-1.4: Revert / Batalkan Perubahan**
  - **Langkah:**
    1. Setelah mengubah teks di window kanan, klik tombol **Revert** (ikon putar balik).
    2. Muncul dialog konfirmasi browser, klik **OK**.
  - **Hasil yang Diharapkan:**
    - Isi editor kembali persis sama dengan isi file terakhir di disk.
    - Badge "Belum disimpan" menghilang.

- [ ] **TC-1.5: Simpan File ke Disk & Verifikasi Cadangan (`.bak`)**
  - **Langkah:**
    1. Lakukan perubahan kecil di window kanan (misal ubah label view).
    2. Klik tombol **Simpan File** (ikon disket warna kuning/oranye).
  - **Hasil yang Diharapkan:**
    - Muncul notifikasi sukses: `💾 File <nama>.json berhasil disimpan (cadangan lama: .bak)`.
    - Badge "Belum disimpan" menghilang.
    - Di disk lokal, file asli terupdate dan otomatis dibuat file cadangan `<nama>.json.bak`.

- [ ] **TC-1.6: Salin Database Live ke Window Preset**
  - **Langkah:**
    1. Klik tombol **Download** (ikon panah bawah ke tray) di header window kanan.
  - **Hasil yang Diharapkan:**
    - Isi editor database (window kiri) disalin ke editor preset lokal (window kanan).
    - Muncul notifikasi: `📋 Isi editor database disalin ke window preset lokal`.
    - File di disk belum berubah sampai tombol "Simpan File" ditekan.

- [ ] **TC-1.7: Terapkan Window Preset ke Database Editor**
  - **Langkah:**
    1. Klik tombol **Terapkan ke Live** di header window kanan.
  - **Hasil yang Diharapkan:**
    - Isi editor preset diterapkan ke window kiri (Database Live) untuk direview.
    - Window kiri bertanda `Modified`.

- [ ] **TC-1.8: Guarded Close (Pencegahan Kehilangan Data)**
  - **Langkah:**
    1. Lakukan perubahan di window kanan hingga muncul badge "Belum disimpan".
    2. Klik tombol **X** di sudut kanan atas window preset.
  - **Hasil yang Diharapkan:**
    - Muncul dialog konfirmasi peringatan: *"Window lokal punya perubahan yang belum disimpan ke file. Tutup dan buang perubahan?"*.
    - Jika klik Batal, window tetap terbuka. Jika klik OK, window tertutup.

---

## 🔄 Modul 2: Sync Center (Bidirectional Synchronizer)

Fokus: Membandingkan konfigurasi database dengan file lokal secara kanonikal dan menyinkronkan data secara terpilih (*granular*).

- [ ] **TC-2.1: Membuka Modal Sync Center**
  - **Langkah:**
    1. Pilih salah satu tenant di sidebar kiri.
    2. Klik tombol **Sync Center Presets** di header atas (atau tombol **Sync ke DB** di drawer Presets).
  - **Hasil yang Diharapkan:**
    - Modal Sync Center terbuka menampilkan tabel seluruh `config_type` milik tenant terpilih.
    - Muncul kolom: *Config (Database)*, *File Preset Lokal*, *Status*, dan *Diubah (DB)*.

- [ ] **TC-2.2: Akurasi Status Kanonikal (Sama / Berbeda / Belum Ada File)**
  - **Langkah:**
    1. Perhatikan badge status pada baris-baris tabel:
       - Hijau: **Sama** (jika isi DB dan file identik).
       - Kuning: **Berbeda** (jika ada nilai berbeda).
       - Abu-abu: **Belum Ada File** (jika belum terhubung ke file).
  - **Hasil yang Diharapkan:**
    - Perbedaan urutan key JSONB di database tidak memicu status "Berbeda" (karena menggunakan algoritma kanonikal rekursif).

- [ ] **TC-2.3: Pemetaan Manual File Preset via Dropdown**
  - **Langkah:**
    1. Pada baris yang statusnya "Belum Ada File", buka dropdown *File Preset Lokal*.
    2. Pilih salah satu file `.json` dari daftar.
  - **Hasil yang Diharapkan:**
    - Pemetaan tersimpan di database audit (`tenant_studio.preset_links`).
    - Status baris otomatis diperbarui (menjadi *Sama* atau *Berbeda*).
    - Muncul badge kecil `link` penanda tautan tersimpan.

- [ ] **TC-2.4: Tombol Bandingkan (Side-by-Side Diff)**
  - **Langkah:**
    1. Cari baris yang berstatus **Berbeda**.
    2. Klik tombol **Bandingkan** di kolom paling kanan.
  - **Hasil yang Diharapkan:**
    - Modal tertutup dan workspace utama langsung membuka mode **Diff Editor**.
    - Baris-baris yang berbeda tersorot jelas (warna merah untuk versi DB, hijau untuk versi file).

- [ ] **TC-2.5: Eksekusi Pull Terpilih (DB → File Lokal)**
  - **Langkah:**
    1. Di Sync Center, centang satu item yang berstatus **Berbeda**.
    2. Klik tombol **Pull terpilih ke Lokal** (warna oranye/amber).
    3. Konfirmasi dialog browser.
  - **Hasil yang Diharapkan:**
    - File lokal di disk ditimpa dengan nilai dari database.
    - File lama dicadangkan sebagai `.bak`.
    - Status baris tersebut di tabel berubah menjadi **Sama** (hijau).

- [ ] **TC-2.6: Eksekusi Push Terpilih (File Lokal → DB)**
  - **Langkah:**
    1. Centang satu item yang ingin diunggah dari file ke database.
    2. Klik tombol **Push terpilih ke DB** (warna hijau).
    3. Konfirmasi dialog browser.
  - **Hasil yang Diharapkan:**
    - Data di `public.tenant_configurations` terupdate dengan isi file.
    - Kondisi database sebelum perubahan otomatis tersimpan sebagai versi baru di riwayat history Neon DB.
    - Status baris berubah menjadi **Sama** (hijau).

---

## 🛡️ Modul 3: Pre-Flight Linter & Guardrail Validator

Fokus: Memastikan validasi berjalan dan mencegah runtime error 500 UUID sebelum disimpan ke database.

- [ ] **TC-3.1: Validasi Konfigurasi Normal**
  - **Langkah:**
    1. Muat salah satu konfigurasi yang valid.
    2. Klik tombol **Validate** di header atas.
  - **Hasil yang Diharapkan:**
    - Muncul panel hijau di bawah editor: *"Semua struktur JSON & guardrail valid! Tidak ada kesalahan sintaks atau view yang terdeteksi."*

- [ ] **TC-3.2: Pencegahan Error Kritis `resolvePaths` pada `isFile: true`**
  - **Langkah:**
    1. Pada salah satu view yang memiliki `"isFile": true`, tambahkan properti:
       `"resolvePaths": ["$candidate.profilePhotoMedia"]`
    2. Klik tombol **Validate**.
  - **Hasil yang Diharapkan:**
    - Muncul peringatan merah:
      *"Ditemukan 'resolvePaths' pada isFile view '...'. Ini memicu runtime error '500 invalid input syntax for type uuid' di ATS!"*

- [ ] **TC-3.3: Deteksi Duplikasi Nama `view`**
  - **Langkah:**
    1. Tambahkan dua elemen di array `views` dengan nama view yang sama (misal `"view": "duplicateTest"`).
    2. Klik tombol **Validate**.
  - **Hasil yang Diharapkan:**
    - Muncul peringatan error merah bahwa nama view harus unik.

- [ ] **TC-3.4: Deteksi Custom Field Tanpa Mapping View**
  - **Langkah:**
    1. Tambahkan custom field di `customData.fields`: `{"key": "testFieldBaru", "type": "TEXT"}` tanpa menambahkan mapping di `views`.
    2. Klik tombol **Validate**.
  - **Hasil yang Diharapkan:**
    - Muncul catatan peringatan kuning: *"Custom field 'testFieldBaru' terdaftar di customData, tapi belum memiliki view mapping di array views."*

---

## 📖 Modul 4: Dokumentasi Terintegrasi (`DocsModal`)

Fokus: Menguji aksesibilitas, pencarian, dan kegunaan buku panduan di dalam aplikasi.

- [ ] **TC-4.1: Membuka Modal Panduan**
  - **Langkah:**
    1. Klik tombol **📖 Panduan** di header atas.
  - **Hasil yang Diharapkan:**
    - Modal buku panduan terbuka dengan tema gelap modern.
    - Menampilkan daftar topik di panel kiri dan penjelasan di panel kanan.

- [ ] **TC-4.2: Navigasi Antar Topik Pembahasan**
  - **Langkah:**
    1. Klik menu **views & resolvePaths** di panel kiri.
    2. Klik menu **Keamanan (decryptable)** di panel kiri.
    3. Klik menu **FAQ & Troubleshooting**.
  - **Hasil yang Diharapkan:**
    - Isi konten di panel kanan berganti sesuai topik dengan transisi mulus.
    - Kotak peringatan merah mengenai error 500 UUID terlihat jelas pada tab `views`.

- [ ] **TC-4.3: Fitur Live Search Dokumen**
  - **Langkah:**
    1. Ketik kata kunci `"resolvePaths"` atau `"uuid"` pada kotak pencarian di sudut kanan atas modal panduan.
  - **Hasil yang Diharapkan:**
    - Menu di sisi kiri otomatis terfilter hanya menampilkan topik yang relevan.

- [ ] **TC-4.4: Tombol 1-Klik Salin Contoh JSON**
  - **Langkah:**
    1. Pada tab `views` atau `validation`, klik tombol **Salin JSON**.
  - **Hasil yang Diharapkan:**
    - Tombol berubah menjadi ikon centang hijau **"Disalin!"**.
    - Potongan kode JSON tersalin ke clipboard dan dapat langsung di-paste ke Monaco Editor.

---

## 📜 Modul 5: Audit Trail & Version History (Neon DB)

Fokus: Memastikan setiap perubahan tersimpan ke riwayat audit dan dapat di-rollback.

- [ ] **TC-5.1: Simpan Konfigurasi dengan Commit Summary**
  - **Langkah:**
    1. Ubah salah satu nilai JSON di editor kiri (Database Live).
    2. Klik tombol **Save** di header atas.
    3. Masukkan ringkasan perubahan di prompt browser (misal: *"Uji coba update view"*).
  - **Hasil yang Diharapkan:**
    - Data tersimpan ke PostgreSQL.
    - Muncul notifikasi sukses: `✅ Berhasil disimpan! Versi N tercatat di Neon DB`.

- [ ] **TC-5.2: Membuka Panel Riwayat Versi**
  - **Langkah:**
    1. Klik tombol **History (N)** di header atas.
  - **Hasil yang Diharapkan:**
    - Laci riwayat terbuka di sebelah kanan.
    - Versi terbaru tercatat lengkap dengan nomor versi, waktu, author, dan ringkasan commit.

- [ ] **TC-5.3: Perbandingan & Restore Versi**
  - **Langkah:**
    1. Pada salah satu versi lama di laci History, klik tombol **Bandingkan**.
    2. Klik tombol **Restore**.
  - **Hasil yang Diharapkan:**
    - Tombol Bandingkan membuka mode Diff side-by-side dengan versi terpilih.
    - Tombol Restore mengembalikan isi editor ke snapshot versi tersebut.

---

## 🗑️ Modul 6: Hapus Konfigurasi dengan Validasi Ketik Nama

Fokus: Memastikan konfigurasi tidak dapat terhapus secara tidak sengaja tanpa memasukkan nama konfigurasi secara persis.

- [ ] **TC-6.1: Menampilkan Modal Hapus Konfigurasi**
  - **Langkah:**
    1. Pada sidebar daftar konfigurasi, arahkan kursor (hover) ke salah satu item konfigurasi (atau klik ikon tong sampah di samping nama config aktif pada top bar editor).
    2. Klik ikon tong sampah (`Trash2`).
  - **Hasil yang Diharapkan:**
    - Muncul modal popup peringatan: *"Hapus Konfigurasi: <CONFIG_TYPE>"*.
    - Menampilkan kotak peringatan merah dengan penjelasan bahwa data akan dihapus dan snapshot disimpan ke audit Neon DB.
    - Menampilkan input teks untuk mengetik nama konfigurasi.

- [ ] **TC-6.2: Tombol Hapus Disabled Jika Teks Tidak Cocok / Kosong**
  - **Langkah:**
    1. Saat modal terbuka dan input teks masih kosong, perhatikan tombol **Hapus Konfigurasi**.
    2. Ketikkan nama yang salah (misal: `"SALAH"` atau huruf kecil tidak sesuai).
  - **Hasil yang Diharapkan:**
    - Tombol **Hapus Konfigurasi** dalam kondisi **DISABLED** (warna redup/abu-abu, kursor dilarang).
    - Muncul hint: *"Nama harus cocok persis (case-sensitive)"*.

- [ ] **TC-6.3: Tombol Hapus Enabled Hanya Saat Teks Cocok Persis**
  - **Langkah:**
    1. Ketikkan nama konfigurasi persis sama dengan nama aslinya (misal: `APPLICANT_STABLE`).
  - **Hasil yang Diharapkan:**
    - Muncul teks hijau: *"✓ Nama cocok! Tombol hapus aktif."*.
    - Tombol **Hapus Konfigurasi** berubah menjadi warna merah menyala dan bisa diklik.

- [ ] **TC-6.4: Eksekusi Penghapusan & Verifikasi Database / History**
  - **Langkah:**
    1. Setelah tombol aktif, klik **Hapus Konfigurasi**.
  - **Hasil yang Diharapkan:**
    - Modal tertutup dan muncul notifikasi sukses: `🗑️ Konfigurasi '<CONFIG_TYPE>' berhasil dihapus. Snapshot terakhir dicatat di riwayat audit v...`.
    - Konfigurasi tersebut hilang dari daftar konfigurasi tenant di sidebar.
    - Editor beralih ke konfigurasi berikutnya yang masih ada (atau kosong jika semua sudah terhapus).
    - Di database Neon DB, riwayat snapshot terakhir tercatat sebagai versi baru dengan ringkasan commit `DELETED: ...`.

---

## 📐 Modul 7: JSON Formatting & Pre-Flight Validation Inspector

Fokus: Memastikan format JSON 2 spasi tersedia di seluruh editor dan hasil validasi linter selalu tampil jelas tanpa terpotong atau tersembunyi di bawah layar.

- [ ] **TC-7.1: Format JSON pada Editor Utama (Tombol Header & Editor Bar)**
  - **Langkah:**
    1. Pada editor konfigurasi aktif, buat format JSON berantakan atau hapus indentasi.
    2. Klik tombol **Format JSON** pada Top Header atau tombol **Format** pada bar editor.
  - **Hasil yang Diharapkan:**
    - Seluruh konten JSON langsung rapi dengan indentasi 2 spasi standar.
    - Muncul toast notifikasi: `✨ JSON database berhasil diformat rapi (indent 2 spasi).`

- [ ] **TC-7.2: Format JSON pada Window Database Live (Side-by-Side Mode)**
  - **Langkah:**
    1. Buka split screen (Side-by-Side).
    2. Klik tombol **Format** pada header window kiri (Window Database Live).
  - **Hasil yang Diharapkan:**
    - JSON pada window kiri terformat rapi secara independen.

- [ ] **TC-7.3: Validasi Linter dengan Panel Terbuka Otomatis & Rincian Masalah**
  - **Langkah:**
    1. Masukkan konfigurasi yang memicu guardrail (misal view tanpa properti `view` atau `isFile` dengan `resolvePaths`).
    2. Klik tombol **Validate** di header atas.
  - **Hasil yang Diharapkan:**
    - Panel inspeksi linter di bawah editor terbuka secara otomatis (docked, tidak terpotong atau tersembunyi).
    - Menampilkan badge jumlah error (merah) dan peringatan (kuning).
    - Menampilkan daftar setiap masalah secara spesifik beserta path JSON (`[views[0]]`, dll.) dan pesan solusi.
    - Muncul tombol toggle `Linter (X)` pada header editor yang dapat diklik untuk buka/tutup panel.

- [ ] **TC-7.4: Validasi Lolos (Zero Issue Green Card)**
  - **Langkah:**
    1. Pastikan seluruh struktur JSON valid dan guardrail terpenuhi.
    2. Klik tombol **Validate**.
  - **Hasil yang Diharapkan:**
    - Panel menampilkan card hijau: *"Semua struktur JSON & guardrail ATS valid! Tidak ada kesalahan sintaks atau view yang terdeteksi."*
    - Badge *"Semua Valid"* muncul di header panel.

---

## 🧠 Modul 8: Tenant Configuration Skill Specification

Fokus: Memastikan skill modular Antigravity tersimpan di sistem global dan dapat digunakan oleh agen AI lainnya.

- [ ] **TC-8.1: Verifikasi File Skill Antigravity `~/.gemini/config/skills/tenant-configuration/SKILL.md`**
  - **Langkah:**
    1. Periksa keberadaan file di `/Users/ketutkusuma/.gemini/config/skills/tenant-configuration/SKILL.md`.
    2. Hitung jumlah baris dokumen.
  - **Hasil yang Diharapkan:**
    - File tersedia dengan frontmatter valid (`name: tenant-configuration`).
    - Jumlah baris melebihi 1000 baris (mencakup schema, grammar, guardrails, production JSON examples, dan AI recipes).

---

## ⇄ Modul 9: Komparasi Split Screen & Diff Antar Tenant (Cross-Tenant Comparison)

Fokus: Memastikan dua tenant berbeda di database dapat dibandingkan langsung secara berdampingan (Side-by-Side) atau selisih baris (Diff Editor), dengan dukungan transfer views, penukaran posisi (swap), dan penyimpanan instan.

- [ ] **TC-9.1: Buka Modal Bandingkan Antar Tenant dari Top Header**
  - **Langkah:**
    1. Pastikan satu tenant sedang aktif di editor utama (misal: *Indomaret (IDM)*).
    2. Klik tombol **Bandingkan Tenant** (ikon `ArrowLeftRight` warna ungu) pada Top Header.
  - **Hasil yang Diharapkan:**
    - Muncul modal popup: *"Bandingkan Konfigurasi Antar Tenant"*.
    - Menampilkan kartu ringkasan Tenant Aktif (Window Kiri) dan kartu Tenant Pembanding (Window Kanan).
    - Menampilkan dropdown pilihan Tenant Pembanding dan dropdown jenis konfigurasi target.
    - Menampilkan opsi pilihan mode tampilan awal (*Side-by-Side* atau *Diff Editor Mode*).

- [ ] **TC-9.2: Buka Komparasi Cepat lewat Ikon ArrowLeftRight di Sidebar Tenant**
  - **Langkah:**
    1. Pada sidebar daftar tenant sebelah kiri, cari tenant lain (misal: *Alfamart (ALFA)*).
    2. Klik ikon panah bolak-balik (`ArrowLeftRight`) di samping kode tenant tersebut.
  - **Hasil yang Diharapkan:**
    - Split screen langsung terbuka tanpa modal, membandingkan tenant aktif dengan tenant yang diklik pada config type yang sama.
    - Muncul toast notifikasi: `⇄ Split aktif: <Tenant A> vs <Tenant B> (<CONFIG_TYPE>)`.

- [ ] **TC-9.3: Komparasi Antar Tenant dalam Mode Diff (Highlight Selisih Baris Berwarna)**
  - **Langkah:**
    1. Saat split screen aktif, alihkan ke **Diff Mode** (atau pilih Diff Editor di modal).
  - **Hasil yang Diharapkan:**
    - Monaco Diff Editor terbuka dengan jelas:
      - Kiri (Original): Konfigurasi Tenant Pembanding.
      - Kanan (Modified): Konfigurasi Tenant Aktif.
    - Baris yang berbeda ditandai dengan warna merah (dihapus/hanya di tenant kiri) dan hijau (ditambahkan/hanya di tenant kanan).
    - Header diff menampilkan label nama kedua tenant secara proporsional.

- [ ] **TC-9.4: Komparasi Antar Tenant dalam Mode Side-by-Side (Dua Editor Mandiri)**
  - **Langkah:**
    1. Saat split screen aktif, klik tombol **Side-by-Side**.
  - **Hasil yang Diharapkan:**
    - Layar terbagi dua secara horizontal:
      - Window Kiri: Database Live Tenant Aktif (berbingkai biru/indigo).
      - Window Kanan: Database Live Tenant Pembanding (berbingkai ungu).
    - Keduanya dapat di-scroll dan diedit secara independen.

- [ ] **TC-9.5: Ganti Tenant / Config Pembanding Langsung dari Dropdown Header Window Kanan**
  - **Langkah:**
    1. Pada header window kanan (Side-by-Side), klik dropdown tenant dan pilih tenant ke-3.
    2. Atau klik dropdown config type dan pilih jenis konfigurasi lain (misal `VACANCY_STABLE`).
  - **Hasil yang Diharapkan:**
    - Isi editor window kanan langsung terupdate dengan konfigurasi tenant yang baru dipilih tanpa perlu menutup split screen.

- [ ] **TC-9.6: Tukar Posisi Tenant (Tombol Swap Kiri <-> Kanan)**
  - **Langkah:**
    1. Pada toolbar split perbandingan, klik tombol **Swap** (ikon `ArrowLeftRight`).
  - **Hasil yang Diharapkan:**
    - Posisi tenant bertukar: Tenant yang tadinya di window kanan menjadi tenant aktif utama di window kiri, dan tenant yang tadinya di kiri berpindah ke window kanan.
    - Muncul toast notifikasi: `⇄ Posisi tenant ditukar: ... sekarang di kiri (aktif), ... di kanan.`
    - Seluruh context editor dan sidebar menyesuaikan tenant yang baru aktif.

- [ ] **TC-9.7: Salin Missing Views & Terapkan Konfigurasi Antar Tenant**
  - **Langkah:**
    1. Klik tombol **Missing Views** pada window kanan.
    2. Atau klik **Terapkan ke Live**.
  - **Hasil yang Diharapkan:**
    - Tombol *Missing Views* mendeteksi view yang ada di tenant pembanding namun belum ada di tenant aktif, lalu menggabungkannya ke editor kiri.
    - Tombol *Terapkan ke Live* menyalin seluruh JSON tenant pembanding ke editor live tenant aktif untuk ditinjau.

- [ ] **TC-9.8: Simpan Perubahan Langsung ke Database Tenant Pembanding**
  - **Langkah:**
    1. Edit isi JSON pada window kanan (tenant pembanding).
    2. Muncul badge **"Modified"**.
    3. Klik tombol **Save to Tenant** di header window kanan, masukkan keterangan commit.
  - **Hasil yang Diharapkan:**
    - Perubahan tersimpan langsung ke database tenant pembanding di Neon DB.
    - Snapshot audit trail baru tercatat di tabel `tenant_studio.tenant_config_histories` milik tenant pembanding.

---

## 🔬 Modul 10: JSON Delta & Perbedaan Struktural Antar Konfigurasi (JSON Output)

Fokus: Memverifikasi fitur kalkulasi selisih/delta antara dua konfigurasi JSON yang ditampilkan sebagai dokumen JSON terstruktur lengkap dengan RFC 6902 JSON Patch dan analisis views.

- [ ] **TC-10.1: Buka Mode JSON Delta dari Toolbar Split Screen**
  - **Langkah:**
    1. Buka split screen (bisa perbandingan preset, history, atau antar tenant).
    2. Pada switcher mode di toolbar atas (`Side-by-Side` | `Visual Diff` | `JSON Delta`), klik **JSON Delta**.
  - **Hasil yang Diharapkan:**
    - Layar berganti menampilkan *JSON Delta Inspector*.
    - Menampilkan dokumen JSON hasil perbandingan dengan penyorotan sintaks (Monaco Editor).
    - Terlihat ringkasan pill: `+X Ditambahkan`, `-Y Dihapus`, `~Z Diubah`, dan `W Views Diff`.

- [ ] **TC-10.2: Buka Mode JSON Delta Langsung dari Modal Perbandingan Antar Tenant**
  - **Langkah:**
    1. Klik ikon **Bandingkan Antar Tenant** (`ArrowLeftRight`) pada salah satu kartu tenant di sidebar.
    2. Pada bagian *3. Mode Tampilan*, pilih kartu **JSON Delta** (ikon dokumen kode biru).
    3. Klik **Buka Split Perbandingan**.
  - **Hasil yang Diharapkan:**
    - Split screen terbuka langsung dalam mode *JSON Delta Inspector*.
    - Header menunjukkan perbandingan: `Baseline: Tenant A ➔ Target: Tenant B`.

- [ ] **TC-10.3: Verifikasi Struktur Output JSON Delta (Full Analysis)**
  - **Langkah:**
    1. Pilih format tab **Full Analysis** pada toolbar JSON Delta.
    2. Periksa struktur dokumen JSON yang ditampilkan di editor.
  - **Hasil yang Diharapkan:**
    - Dokumen JSON memiliki struktur lengkap:
      - `_meta`: `generatedAt`, `baseline`, `target`, `direction`.
      - `summary`: `totalChanges`, `addedCount`, `removedCount`, `modifiedCount`, `viewsDiff`.
      - `viewsAnalysis`: daftar view yang hanya ada di baseline/target serta daftar properti view yang diubah.
      - `differences`: objek `added`, `removed`, `modified` dengan dot/bracket paths.
      - `rfc6902Patch`: array standar operasi JSON Patch (`add`, `remove`, `replace`).

- [ ] **TC-10.4: Beralih ke Format Compact Delta & RFC 6902 Patch**
  - **Langkah:**
    1. Klik tab **Compact Delta**.
    2. Amati isi JSON: hanya memuat objek `summary`, `added`, `removed`, dan `modified`.
    3. Klik tab **RFC 6902 Patch**.
    4. Amati isi JSON: langsung memuat array operasi patch `[ { op, path, value, oldValue } ]`.
  - **Hasil yang Diharapkan:**
    - Transisi format berlangsung instan tanpa reload halaman.
    - JSON valid dan terindentasi rapi (2 spasi).

- [ ] **TC-10.5: Analisis Spesifik Views Only (`viewsAnalysis`)**
  - **Langkah:**
    1. Klik tab **Views Only**.
  - **Hasil yang Diharapkan:**
    - Editor menampilkan fokus analisis array views:
      - `onlyInBaseline`: daftar nama view yang hanya ada di konfigurasi baseline.
      - `onlyInTarget`: daftar nama view yang hanya ada di konfigurasi target.
      - `modifiedViews`: nama view dengan rincian perubahan properti spesifik (`label`, `is_required`, dll).

- [ ] **TC-10.6: Tukar Arah Perbandingan (Tombol Tukar Arah)**
  - **Langkah:**
    1. Pada bar informasi arah (`Baseline: ... ➔ Target: ...`), klik tombol **Tukar Arah** (`ArrowLeftRight`).
  - **Hasil yang Diharapkan:**
    - Posisi baseline dan target bertukar posisi.
    - Dokumen JSON delta dikalkulasi ulang secara reaktif:
      - Objek yang sebelumnya berstatus `added` kini menjadi `removed` (dan sebaliknya).
      - Nilai `baseline` dan `target` pada objek `modified` tertukar.

- [ ] **TC-10.7: Salin Dokumen JSON Delta (Copy to Clipboard)**
  - **Langkah:**
    1. Klik tombol **Salin JSON**.
    2. Buka text editor eksternal dan lakukan Paste (`Cmd+V` / `Ctrl+V`).
  - **Hasil yang Diharapkan:**
    - Tombol menampilkan animasi umpan balik: centang hijau **"Tersalin!"**.
    - Dokumen JSON delta tersalin utuh ke clipboard.

- [ ] **TC-10.8: Unduh Dokumen JSON Delta sebagai File `.json`**
  - **Langkah:**
    1. Klik tombol **Unduh .json**.
  - **Hasil yang Diharapkan:**
    - File terunduh otomatis melalui browser dengan nama terstruktur (contoh: `delta-live-vs-staging-applicant_stable.json`).
    - Isi file adalah JSON valid yang dapat dibuka dan diproses tool otomatisasi lainnya.

- [ ] **TC-10.9: Resiliensi Penanganan Syntax Error pada JSON Input**
  - **Langkah:**
    1. Beralih sebentar ke mode **Side-by-Side**, lalu hapus satu tanda kurung kurawal `}` pada salah satu editor sehingga format JSON menjadi tidak valid.
    2. Beralih kembali ke mode **JSON Delta**.
  - **Hasil yang Diharapkan:**
    - Aplikasi tidak crash.
    - Muncul banner peringatan merah di atas editor: *"Syntax Error pada salah satu konfigurasi..."*
    - Monaco editor menampilkan JSON error berpenjelasan ramah yang memandu pengguna untuk memperbaiki tanda baca JSON.

---

> *Catatan: Anda dapat membuka file ini kapan saja atau mengedit tanda centang `[ ]` menjadi `[x]` saat melakukan verifikasi fungsional.*



