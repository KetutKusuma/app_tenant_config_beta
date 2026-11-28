# Edit & Simpan di Layar Bandingkan + Config Tetap Saat Pindah — Desain

Tanggal: 2026-11-28 · Status: disetujui user (keputusan di chat 2026-11-25 dan 2026-11-28)

## 1. Latar belakang & tujuan

Layar **Bandingkan antar env** (`EnvCompareScreen.tsx`) saat ini hanya untuk melihat. Diff Monaco dipasang `readOnly: true` dan `originalEditable: false`. User meminta perubahan ini pada 2026-11-25:

> "ketika dia membandingkan antar .env itu kan dia read only saya ingin dia bisa edit juga dan bisa langsung simpan"

Rancangannya sudah diusulkan saat itu, tetapi tidak dikerjakan karena pertanyaan terbuka belum dijawab. Pada 2026-11-28 user menjawab: **kedua sisi bisa diedit**.

Permintaan kedua dari sesi yang sama juga belum dibuat. Saat pindah tenant, env, atau layanan, editor utama selalu membuka `CANDIDATE_STABLE` (`useCoreActions.ts` `selectTenant`). User ingin config dengan tipe yang sama tetap terbuka. User setuju ini dikerjakan sekalian.

## 2. Non-goals

- Edit pada sisi yang config-nya tidak ada (status "Hanya Kiri" atau "Hanya Kanan"). Belum ada baris di DB untuk diperbarui, jadi untuk kasus ini tetap pakai "Salin ke Kanan…".
- Edit pada baris berstatus "Ganda".
- Validasi linter otomatis sebelum simpan. Tombol Simpan utama di editor juga tidak memvalidasi.
- Shortcut keyboard (Ctrl+S) di layar Bandingkan.
- Menyimpan banyak config sekaligus.

## 3. Anti-goals

- Menyimpan tanpa alasan perubahan, atau tanpa cek versi (`expectedVersion`).
- Bisa mengedit sisi yang env-nya read-only (`targetEnvs[].readonly`).
- Editan hilang diam-diam ketika user pindah config, mengganti env/tenant sisi, menukar sisi, atau menutup layar.
- Menulis config lewat jalur lain selain `PUT /api/configs/:configId`.

## 4. Desain

### 4.1 Edit di layar Bandingkan

**Kapan sebuah sisi bisa diedit.** Semua syarat berikut harus terpenuhi:

- env sisi itu tidak `readonly`;
- `entry.left` (atau `entry.right`) tidak `null`;
- status baris bukan `ganda`.

Opsi Monaco mengikuti syarat itu: `originalEditable` untuk kiri, `readOnly` untuk kanan (modified).

**Draf.** Draf hanya disimpan untuk config yang sedang dipilih.

- Draf per sisi disimpan sebagai `{ left?: string; right?: string }`. Draf tetap ada ketika perbandingan dimuat ulang.
- Sebuah sisi dianggap *dirty* kalau teksnya berbeda dari `JSON.stringify(value, null, 2)` milik baris DB-nya.

**Judul panel.** Di judul tiap sisi yang bisa diedit ada:

- titik kuning "belum disimpan" saat sisi itu dirty;
- tombol ghost **Simpan** dan **Kembalikan**, keduanya hanya aktif saat dirty. Export SQL tetap jadi satu-satunya tombol utama.

Sisi read-only diberi label kecil "read-only".

**Simpan.** Urutannya:

1. Kalau teks gagal di-`JSON.parse`, tampilkan `JSON tidak valid: <pesan>` dan jangan kirim request.
2. Panggil `askReason({ title: "Simpan <CONFIG_TYPE>", description: "<label env> · <nama tenant>. Versi sebelumnya otomatis diarsipkan ke History.", before: <value DB>, after: <hasil parse> })`. Kalau hasilnya `null`, batalkan.
3. Kirim `PUT /api/configs/<row.id>` dengan header `X-Target-Env: <env sisi>` dan body `{ value, changeSummary, expectedVersion: row.version_token }`. `groupId` tidak dikirim, jadi tetap sama. Konfirmasi env yang dilindungi (428) sudah ditangani `api()`.
4. Tangani hasilnya:
   - **Berhasil:** hapus draf sisi itu. Tampilkan pesan status `✅ Tersimpan ke <label env> (versi <n>).` lalu muat ulang perbandingan. Draf sisi lain tidak ikut hilang.
   - **409:** tampilkan `confirm("<pesan server>\n\nMuat ulang perbandingan? Editanmu disalin ke clipboard dulu.")`. Kalau user setuju, salin draf ke clipboard, hapus draf sisi itu, lalu muat ulang.
   - **Error lain:** `Gagal menyimpan: <pesan>`. Draf tetap ada.
5. Sinkronkan dengan editor utama. Kalau env sisi = env aktif dan `row.id` = config yang terbuka di editor utama:
   - editor utama tidak dirty → muat ulang config itu;
   - editor utama dirty → tandai `isDbNewer`.

**Konfirmasi buang editan.** Muncul kalau ada draf dirty, dengan teks `Ada editan yang belum disimpan di <CONFIG_TYPE>. Buang editan?`, pada aksi-aksi berikut:

- memilih config lain di daftar;
- mengganti env atau tenant salah satu sisi;
- tukar sisi;
- Salin ke Kanan;
- tutup layar (tombol X maupun Esc).

Kalau user memilih batal, aksi itu tidak jalan.

### 4.2 Config tetap saat pindah tenant/env/layanan/domain

Fungsi murni `pickConfigAfterSwitch(configs, preferType)` mengembalikan `{ config, missingType }`. Urutan pilihannya:

1. config dengan `config_type === preferType`;
2. `CANDIDATE_STABLE`;
3. config pertama;
4. `null` kalau daftar kosong.

`missingType` berisi `preferType` hanya kalau `preferType` diisi tetapi tidak ditemukan.

`selectTenant(tenant, preferType?)` memakai fungsi ini. Tipe yang sedang dibuka dikirim oleh:

- pindah tenant manual;
- pindah env;
- pindah layanan;
- pindah domain;
- `fetchTenants` (diteruskan lewat parameter baru).

Nilai tipe itu diambil **sebelum** `resetWorkspace()`. Saat pindah domain, daftar tipe biasanya berbeda, jadi wajar kalau jatuh ke langkah 2 atau 3.

Kalau `missingType` terisi, tampilkan pesan status `⚠️ <TYPE> tidak ada di <nama tenant>, membuka <TYPE baru>.` selama ±4 detik. Pesan ini tidak boleh langsung tertimpa pesan "Target env: …".

## 5. Pengujian

- **Unit test `pickConfigAfterSwitch`**, dengan 5 kasus:
  - tipe ada;
  - tipe tidak ada tapi ada `CANDIDATE_STABLE`;
  - tidak ada keduanya;
  - daftar kosong;
  - `preferType` kosong, yang menghasilkan `missingType: null`.
- **Unit test `sideEditable`** (syarat edit) dan `isDirty`.
- **Uji manual oleh user di browser.** AI tidak boleh menyimpan config, termasuk di development:
  - edit dan simpan sisi kiri dan kanan;
  - 409 ketika config diubah dari tab lain;
  - sisi read-only;
  - konfirmasi buang editan;
  - pindah env sambil membuka `APPLICANT_STABLE`.

## 6. Diserahkan ke builder

- Cara menjaga kursor saat draf dipasang kembali ke Monaco setelah muat ulang. Prop `original`/`modified` boleh diisi `draft ?? baseline`, asal kursor tidak lompat saat mengetik.
- Letak persis tombol di judul panel dan teks tooltip-nya.
