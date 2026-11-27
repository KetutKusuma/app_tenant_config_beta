# Desain: Kelola Akun (khusus Admin) & Jejak Pelaku Perubahan

Tanggal: 2026-11-27 · Repo: `app_tenant_config_beta` · Status: menunggu persetujuan

## 1. Latar belakang & tujuan

Saat ini Tenant Studio hanya memiliki **satu akun** (`ketutkusuma0910@yopmail.com`), dibuat otomatis dari `STUDIO_DEFAULT_EMAIL` / `STUDIO_DEFAULT_PASSWORD` ketika tabel user masih kosong. Akun yang sama juga dipakai server MCP (`STUDIO_MCP_EMAIL`). Belum ada cara menambah akun selain `INSERT` manual ke database.

Akibatnya, semua orang yang memakai Studio login dengan akun yang sama, sehingga riwayat perubahan config tidak bisa menunjukkan siapa yang sebenarnya mengubah. Studio kini juga dapat diakses publik lewat Tailscale Funnel, sehingga akun bersama makin berisiko.

**Tujuan**
1. Setiap orang memiliki akun sendiri, dan hanya **admin** yang bisa membuat atau mengelola akun.
2. Setiap perubahan config tercatat atas nama akun pelakunya secara andal, memakai ID dan bukan hanya nama.
3. Perubahan pada akun (dibuat, dinonaktifkan, direset, dan seterusnya) juga tercatat: siapa melakukannya, kepada siapa, dan kapan.

## 2. Non-goals (tidak dikerjakan)

- Pendaftaran mandiri (self sign-up), undangan lewat email/SMTP, SSO/OAuth.
- Peran ketiga (mis. hanya-baca) atau izin per env/per layanan. Hanya ada **dua peran: `admin` dan `user`** (keputusan user).
- Menghapus akun secara permanen. Akun hanya **dinonaktifkan**, supaya jejak riwayat tetap utuh.
- Mengisi ulang `author_id` pada riwayat lama. Baris lama tetap hanya punya `author_name`.
- Mengubah perilaku MCP (tetap hanya-baca).

## 3. Anti-goals (gagal walau "jalan")

- User biasa bisa menaikkan perannya sendiri, atau memanggil endpoint admin langsung lewat curl.
- Studio kehilangan semua admin aktif, misalnya admin terakhir menonaktifkan atau menurunkan dirinya sendiri.
- Akun yang dinonaktifkan masih bisa memakai sesi lamanya.
- Pelaku perubahan masih bisa dipalsukan lewat body request. `authorName` dari frontend harus tetap diabaikan.
- Log aktivitas akun bisa diubah atau dihapus lewat aplikasi.

## 4. Kondisi sekarang (hasil pengecekan)

- Auth ada di `apps/bff/src/auth.ts`: tabel `tenant_studio.studio_users`, `studio_sessions`, dan `studio_user_preferences` di **DB audit = database `ats_db` pada host Neon** (`AUDIT_DB_URL`). Ini bukan database `neondb`.
- Migrasi skema dijalankan idempoten saat BFF start (`initAuthSchema`, `studioSchema.ts`). Pola ini dipertahankan: perubahan DB dilakukan lewat migrasi kode, bukan SQL manual.
- `actorName(req)` mengambil `display_name` user login, lalu dipakai di `routes/configs.ts`, `routes/sync.ts`, `routes/references.ts`, `routes/compare.ts`, dan `presetSync.ts`. Hasilnya ditulis ke `tenant_config_histories.author_name` dan `config_change_batches.author_name`.
- Frontend masih mengirim `authorName` hardcode ("Studio User", "Studio Developer", "Sync Center"), tetapi BFF sudah menimpanya dengan user login.
- Panel Riwayat (`HistoryPanel.tsx`) dan Log Batch (`ChangeBatchesPanel.tsx`) menampilkan `author_name`.
- Menu user (ganti password, logout) ada di `StudioHeader.tsx`.

## 5. Desain

### 5.1 Data (migrasi idempoten di `initAuthSchema`)

```sql
ALTER TABLE tenant_studio.studio_users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('admin','user')),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES tenant_studio.studio_users(id);

-- Bootstrap admin: jika belum ada admin, akun STUDIO_DEFAULT_EMAIL menjadi admin;
-- bila env itu kosong / tidak ditemukan, pakai user aktif tertua.
UPDATE tenant_studio.studio_users SET role = 'admin'
WHERE id = COALESCE(
        (SELECT id FROM tenant_studio.studio_users WHERE email = <STUDIO_DEFAULT_EMAIL> AND is_active),
        (SELECT id FROM tenant_studio.studio_users WHERE is_active ORDER BY created_at LIMIT 1))
  AND NOT EXISTS (SELECT 1 FROM tenant_studio.studio_users WHERE role = 'admin');

CREATE TABLE IF NOT EXISTS tenant_studio.studio_user_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES tenant_studio.studio_users(id),
  actor_name text NOT NULL,
  target_user_id uuid REFERENCES tenant_studio.studio_users(id),
  target_email text NOT NULL,
  action text NOT NULL,      -- create | update | deactivate | activate | reset_password
  details jsonb,             -- mis. {"role":{"from":"user","to":"admin"}}; TIDAK PERNAH berisi password/hash
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_user_events_created ON tenant_studio.studio_user_events (created_at DESC);

ALTER TABLE tenant_studio.tenant_config_histories ADD COLUMN IF NOT EXISTS author_id uuid;
ALTER TABLE tenant_studio.config_change_batches   ADD COLUMN IF NOT EXISTS author_id uuid;
```

- Akun default dari `.env` yang dibuat untuk tabel kosong langsung diberi `role = 'admin'`.
- Per 2026-11-27, `studio_users` di `ats_db` hanya berisi satu akun (`ketutkusuma0910@yopmail.com`), sehingga bootstrap pasti memilih akun itu. Pemilihan lewat `STUDIO_DEFAULT_EMAIL` tetap dipakai sebagai pengaman. *(keputusan saya)*
- `author_id` sengaja **tanpa foreign key**, karena history ditulis di banyak jalur dan sebagian lewat batch. Akun juga tidak pernah dihapus, jadi FK tidak diperlukan. *(keputusan saya)*

### 5.2 BFF

**Tipe & helper**
- `StudioUser` mendapat `role: 'admin' | 'user'`, sehingga `/api/auth/me` dan respons login ikut mengembalikannya.
- `actorId(req)` mengembalikan `req.user.id`. Semua jalur yang sekarang memanggil `actorName(req)` untuk menulis history atau batch juga menulis `author_id`.
- Middleware `requireAdmin` mengembalikan 403 `{ code: "FORBIDDEN" }` bila `req.user.role !== 'admin'`.

**Endpoint baru** (file baru `routes/users.ts`, semuanya di belakang `requireAdmin`)

| Method | Path | Fungsi |
| :-- | :-- | :-- |
| GET | `/api/admin/users` | Daftar akun: email, nama, peran, aktif, wajib ganti password, login terakhir, dibuat oleh, dibuat kapan |
| POST | `/api/admin/users` | Buat akun `{ email, displayName, role, password? }` |
| PATCH | `/api/admin/users/:id` | Ubah `{ displayName?, role?, isActive? }` |
| POST | `/api/admin/users/:id/reset-password` | Set password sementara baru |
| GET | `/api/admin/user-events?limit=&before=` | Log aktivitas akun, terbaru dulu, dengan paginasi |

**Aturan**
- Email di-*trim* dan diubah ke huruf kecil, harus berformat email yang valid, dan harus unik. Email duplikat menghasilkan 409 dengan pesan "Email sudah terdaftar." Email **tidak bisa diubah** setelah akun dibuat. *(keputusan saya: email adalah identitas login)*
- Password sementara: kalau admin tidak mengisinya, BFF membuatkan password acak sepanjang 16 karakter. Password itu dikembalikan **sekali** di respons dan tidak pernah disimpan dalam bentuk teks. Akun baru dan akun yang direset selalu mendapat `must_change_password = true`. Minimal panjang password 8 karakter, sama seperti sekarang.
- Admin **tidak boleh** menonaktifkan atau menurunkan perannya sendiri lewat endpoint ini.
- Setiap aksi yang membuat jumlah admin aktif menjadi 0 ditolak dengan 409.
- Saat akun dinonaktifkan atau password-nya direset, semua `studio_sessions` milik akun itu dihapus.
- Setiap aksi yang berhasil menulis satu baris ke `studio_user_events` **dalam transaksi yang sama** dengan perubahannya.
- Pembaruan profil sendiri (ganti password) tetap lewat `/api/auth/change-password` dan tidak dicatat di event. *(keputusan saya: log difokuskan pada tindakan admin; `last_login_at` sudah ada)*

### 5.3 Web

- **Menu header**: item "Kelola Akun" (ikon `Users`) hanya muncul untuk admin, di menu user `StudioHeader.tsx` di dekat Ganti Password.
- **Layar/modal "Kelola Akun"** dengan dua tab:
  - **Akun**: tabel berisi Nama, Email, Peran (badge), Status (Aktif/Nonaktif, tanda "wajib ganti password"), Login terakhir, dan Dibuat oleh. Ada satu tombol utama "Tambah Akun". Aksi per baris dibuat ghost/icon-only: ubah nama/peran, reset password, nonaktifkan/aktifkan. Ini sesuai aturan UI Studio: satu tombol utama, teks Indonesia.
  - **Log Aktivitas**: daftar kronologis berformat "*Admin X* menonaktifkan *email Y* · waktu", ditambah detail perubahan peran.
- **Dialog Tambah Akun**: email, nama tampilan, peran (default `user`), dan password (opsional, dengan tombol "Buatkan otomatis"). Setelah berhasil, password sementara ditampilkan sekali dengan tombol salin dan catatan "berikan ke pemilik akun; wajib diganti saat login pertama".
- **Reset password**: dialog konfirmasi, lalu tampilan sekali-lihat yang sama.
- **Nonaktifkan**: dialog konfirmasi biasa yang menjelaskan bahwa sesi akun langsung berakhir. Aksi ini bisa dibatalkan dengan mengaktifkan kembali, jadi tidak memakai ketik-untuk-konfirmasi. *(keputusan saya)*
- **Riwayat & Log Batch**: tetap menampilkan `author_name`. Bila `author_id` ada, tooltip menampilkan email akun tersebut (BFF melakukan join ke `studio_users` di query history dan batch).
- **Akun dinonaktifkan saat tabnya terbuka**: server langsung menolak request berikutnya, karena middleware sudah memuat ulang user dengan `is_active = true` di setiap request. Di web, logout terjadi pada aksi berikutnya (401 lewat `UNAUTHORIZED_EVENT`), ditambah cek ringan `/api/auth/me` saat tab kembali fokus. Tidak memakai polling atau push. *(keputusan saya)*
- Hapus `authorName` hardcode yang dikirim frontend, karena tidak dipakai BFF. *(pembersihan kecil, opsional)*

### 5.4 Operasional setelah rilis

1. Deploy, lalu BFF start dan migrasi berjalan. Akun `ketutkusuma0910@yopmail.com` otomatis menjadi admin.
2. Admin membuat akun untuk setiap anggota tim.
3. Semua instance Studio yang memakai `AUDIT_DB_URL` yang sama (lokal dan Docker/Funnel) harus diperbarui ke build baru. Build lama tidak mengenal aturan admin.
4. Buat **akun terpisah untuk MCP** (peran `user`), lalu perbarui `STUDIO_MCP_EMAIL` / `STUDIO_MCP_PASSWORD`. Setelah itu sesi dan aktivitas MCP tidak lagi tercampur dengan akun admin.

## 6. Pengujian

- Unit/integrasi BFF: user biasa mendapat 403 di semua `/api/admin/*`. Pembuatan dengan email duplikat atau huruf besar ditolak/dinormalisasi. Penurunan diri sendiri dan admin terakhir ditolak. Nonaktifkan dan reset menghapus sesi. Setiap aksi menulis tepat satu event tanpa password. Simpan config mengisi `author_id`.
- Manual (oleh user di Studio): login sebagai admin, buat akun, login sebagai akun baru (wajib ganti password), ubah config, lalu cek Riwayat menampilkan nama dan email akun baru. Nonaktifkan akun itu; tab yang masih terbuka harus ter-logout pada aksi berikutnya atau saat tab difokuskan lagi.

## 7. Diserahkan ke builder

Struktur komponen web (modal atau layar penuh), detail paginasi log, format waktu, dan pemecahan file BFF, selama mengikuti pola yang sudah ada (`esc`, router per area, teks Indonesia).
