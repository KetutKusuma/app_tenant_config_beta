# Desain: Perangkat Aktif & Riwayat Login

Tanggal: 2026-11-28 · Repo: `app_tenant_config_beta` · Status: menunggu persetujuan
Melanjutkan: `docs/superpowers/specs/2026-11-27-kelola-akun-admin-design.md` (Kelola Akun, sudah di-merge ke `feat/docker-deploy`)

## 1. Latar belakang & tujuan

Setelah setiap orang punya akun sendiri, user ingin tahu **akun ini login dari perangkat apa saja**, **menyimpan riwayat login**, dan bisa **mengeluarkan perangkat** dari jarak jauh.

Kondisi sekarang:
- Setiap login membuat baris di `tenant_studio.studio_sessions` (`user_agent`, `created_at`, `last_seen_at`, `expires_at`).
- Baris itu dihapus saat logout atau ketika kedaluwarsa, jadi riwayatnya hilang.
- IP tidak dicatat.
- BFF belum memasang `trust proxy`. Di server (Docker di belakang Tailscale Funnel), `req.ip` selalu IP gateway Docker. Akibatnya kunci "5 kali gagal → terkunci 15 menit" (`email|req.ip`) berlaku untuk semua orang yang login dengan email itu.

**Tujuan**
1. Setiap user bisa melihat perangkat yang sedang login ke akunnya dan riwayat login akunnya, lalu mengeluarkan perangkat lain.
2. Admin bisa melihat perangkat dan riwayat login semua akun, termasuk percobaan login gagal, dan bisa mengeluarkan perangkat akun mana pun.
3. IP yang dicatat adalah IP asli klien, bukan IP proxy.

## 2. Non-goals

- **Blokir perangkat** (keputusan user: tidak dikerjakan).
- Lokasi/geo-IP, notifikasi email saat login dari perangkat baru, deteksi anomali.
- Penghapusan otomatis riwayat lama. Volume kecil, jadi riwayat disimpan permanen. *(keputusan saya)*
- Tombol "keluar dari semua perangkat lain". Ganti password sudah melakukan ini. *(keputusan saya)*
- Library parser user agent pihak ketiga. Cukup parser kecil buatan sendiri. *(keputusan saya)*

## 3. Anti-goals

- User biasa bisa melihat atau mengeluarkan sesi milik akun lain.
- Token sesi, atau hash-nya, ikut terkirim ke frontend. Frontend hanya boleh menerima `id` sesi (uuid baris).
- Percobaan login gagal untuk email yang tidak terdaftar bisa dilihat oleh user biasa.
- Mencatat password, termasuk password yang salah ketik, di mana pun.
- IP palsu dari header `X-Forwarded-For` yang dikirim klien langsung ikut dipercaya.

## 4. Desain

### 4.1 IP asli klien

- Di `main.ts`: `app.set("trust proxy", "loopback, uniquelocal")`. Express hanya membaca `X-Forwarded-For` dari hop yang berasal dari loopback atau jaringan privat (Docker bridge 172.16/12, Tailscale serve lokal). Setelah itu `req.ip` berisi IP klien.
- Ini sekaligus membuat kunci percobaan login gagal kembali per orang (per `email|IP`).
- **Perlu dicek di server**: Tailscale Funnel harus mengirim `X-Forwarded-For` ke `127.0.0.1:4000`. Kalau tidak, IP yang tercatat tetap IP internal. Ini dicek saat deploy dan dicatat. Fitur lain tetap berjalan.

### 4.2 Data (migrasi idempoten di `initAuthSchema`)

```sql
ALTER TABLE tenant_studio.studio_sessions
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS device_label text;

CREATE TABLE IF NOT EXISTS tenant_studio.studio_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES tenant_studio.studio_users(id),  -- NULL bila email tidak terdaftar
  email text NOT NULL,                                     -- email yang diketik (sudah lowercase)
  kind text NOT NULL,        -- login_berhasil | login_gagal | login_terkunci | logout | dikeluarkan
  reason text,               -- khusus login_gagal: password_salah | tidak_terdaftar | nonaktif
  ip text,
  device_label text,
  user_agent text,           -- dipotong 300 karakter, sama seperti sesi
  session_id uuid,           -- sesi terkait (tanpa FK; sesi bisa sudah dihapus)
  actor_name text,           -- untuk 'dikeluarkan': siapa yang mengeluarkan
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_login_events_user ON tenant_studio.studio_login_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_login_events_created ON tenant_studio.studio_login_events (created_at DESC);
```

Kapan baris ditulis:

| Kejadian | kind | user_id |
|---|---|---|
| Login sukses | `login_berhasil` (+ `session_id`) | akun |
| Password salah / email tidak terdaftar / akun nonaktif | `login_gagal` | akun bila email terdaftar, NULL bila tidak |
| Ditolak karena sedang terkunci | `login_terkunci` | akun bila terdaftar, NULL bila tidak |
| Logout | `logout` (+ `session_id`) | akun |
| Sesi diakhiri lewat tombol Keluarkan | `dikeluarkan` (+ `session_id`, `actor_name`) | pemilik sesi |

Aturan tambahan penulisan event *(keputusan saya)*:
- `email` dipotong maksimal 254 karakter.
- `login_terkunci` ditulis **sekali per masa kunci** (percobaan pertama yang ditolak), bukan setiap request selama terkunci. Ini menahan banjir baris dari internet (Funnel publik).
- Akun tidak pernah dihapus permanen (aturan Kelola Akun), jadi FK `user_id` tanpa cascade aman.

Sesi yang berakhir karena kedaluwarsa, ganti password, nonaktifkan akun, atau reset password tidak ditulis sebagai event baru. Kejadian admin sudah tercatat di `studio_user_events`. *(keputusan saya)*

Kegagalan menulis event login **tidak boleh menggagalkan login**. Event dicatat setelah keputusan login, dengan try/catch dan `console.warn`. *(keputusan saya)*

### 4.3 Label perangkat

Fungsi murni `deviceLabel(userAgent: string | null): string` di `apps/bff/src/users/device.ts` menghasilkan `"<Browser> · <OS>"`, misalnya `"Chrome · Windows"`, `"Safari · iPhone"`, atau `"Edge · Windows"`.
- Browser: Edge (`Edg/`), Opera (`OPR/`), Firefox, Chrome (termasuk `CriOS`), Safari. Urutan cek penting karena UA Chrome mengandung "Safari" dan UA Edge mengandung "Chrome".
- OS: iPhone, iPad, Android, Windows, macOS, ChromeOS, Linux.
- UA kosong atau tidak dikenali menghasilkan `"Perangkat tidak dikenal"`. Bagian yang tidak dikenali saja menjadi `"Browser lain"` / `"OS lain"`.
- UA curl dan Node (mis. dari MCP) menghasilkan `"curl"` / `"Node.js · Server"`. Akun MCP bisa terlihat lewat label ini. *(keputusan saya)*

Label disimpan saat sesi atau event dibuat, jadi tidak dihitung ulang setiap kali dibaca.

### 4.4 BFF — endpoint

**Untuk akun sendiri** (semua user login; ada di `auth.ts` atau file baru `routes/sessions.ts`):

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/auth/sessions` | Sesi aktif akun sendiri: `{ data: SessionRow[] }` |
| DELETE | `/api/auth/sessions/:id` | Keluarkan satu sesi milik sendiri. Sesi yang sedang dipakai ditolak 400 "Gunakan Logout untuk perangkat ini." |
| GET | `/api/auth/login-history?limit=&before=` | Riwayat login akun sendiri (`user_id = req.user.id`): `{ data: LoginEventRow[], nextBefore }` |

**Untuk admin** (di `routes/users.ts`, di belakang `requireAdmin`):

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/admin/users/:id/sessions` | Sesi aktif akun mana pun |
| DELETE | `/api/admin/users/:id/sessions/:sid` | Keluarkan sesi akun mana pun. Juga ditulis ke `studio_user_events` dengan action `revoke_session` dan `details: { device, ip }` |
| GET | `/api/admin/login-history?userId=&limit=&before=` | Riwayat login semua akun, termasuk email tak terdaftar (`user_id` NULL). Filter `userId` opsional |

Bentuk data:
- `SessionRow = { id, deviceLabel, ip: string|null, createdAt, lastSeenAt, expiresAt, current: boolean }`. `current` = sesi milik cookie request ini. Urutan: `last_seen_at DESC`, hanya `expires_at > NOW()`.
- `LoginEventRow = { id, email, kind, reason: string|null, deviceLabel, ip, actorName, createdAt }`.
- Riwayat milik sendiri hanya memuat baris dengan `user_id = req.user.id`. User **bisa** melihat percobaan gagal terhadap emailnya sendiri (beserta IP-nya); percobaan untuk email tak terdaftar hanya ada di riwayat admin. Pada riwayat sendiri, `reason` praktis hanya `password_salah` (akun nonaktif tidak bisa login untuk melihatnya).
- Sesi/event lama tanpa `device_label` diberi label saat dibaca: `deviceLabel(user_agent)`; tanpa migrasi data. *(keputusan saya)* Paginasi sama dengan `user-events` (limit 1..200, default 50).

Aturan:
- `:id`/`:sid` yang bukan UUID → 404. Sesi yang tidak ditemukan atau bukan milik akun itu → 404 "Sesi tidak ditemukan." (tidak membocorkan keberadaan sesi akun lain).
- Admin boleh mengeluarkan sesi miliknya sendiri lewat endpoint admin, kecuali sesi yang sedang dipakai (aturan 400 yang sama).
- Hapus sesi, tulis event `dikeluarkan`, dan (untuk admin) tulis `studio_user_events` dalam satu transaksi.
- `last_seen_at` tetap diperbarui paling sering 1x per jam (perilaku lama). "Terakhir aktif" bisa meleset hingga 1 jam. *(keputusan saya: tidak menambah beban tulis DB)*
- Bila IP request berbeda dari `ip` sesi, middleware langsung memperbarui `ip` (dan `device_label`) sesi itu, tanpa menunggu siklus 1 jam. Penulisan hanya terjadi saat IP berubah, jadi cookie curian yang dipakai dari IP lain langsung terlihat di daftar perangkat. *(keputusan saya)*
- User yang masih wajib ganti password tetap boleh membuka endpoint `/api/auth/sessions*` dan `/api/auth/login-history` (prefix `/auth/` sudah diizinkan middleware). *(keputusan saya)*

### 4.5 Web

- **Menu user (semua user)**: item baru "Perangkat & Riwayat Login" membuka modal dengan dua tab:
  - **Perangkat Aktif**: daftar `deviceLabel`, IP, "Login <waktu>", dan "Terakhir aktif <waktu>". Sesi saat ini diberi badge "Perangkat ini". Perangkat lain punya tombol ikon "Keluarkan" dengan dialog konfirmasi biasa.
  - **Riwayat Login**: daftar kronologis. Contoh: `Login berhasil · Chrome · Windows · 103.x.x.x · 28 Nov 14:02`; `Login gagal (password salah)`; `Dikeluarkan oleh <actorName>`. Ada tombol "Muat lebih banyak".
- **Kelola Akun (admin)**:
  - Aksi baris baru "Perangkat" (ikon) membuka komponen yang sama untuk akun itu, memakai endpoint admin.
  - Tab baru **Riwayat Login** berisi semua akun, termasuk email tak terdaftar yang ditandai "(tidak terdaftar)".
- Dikeluarkan dari perangkat lain tidak butuh kerja tambahan di web: request berikutnya dari perangkat itu mendapat 401, ditambah cek saat tab difokuskan yang sudah ada.

## 5. Pengujian

- Unit: `deviceLabel` untuk UA Chrome/Windows, Safari/iPhone, Safari/macOS, Edge, Firefox/Linux, Chrome Android, curl, kosong.
- Unit/route tanpa DB (pola `users.test.ts`): user biasa 403 di endpoint admin baru; `:id` bukan UUID → 404.
- Manual (agent, lewat curl ke BFF lokal dengan akun uji `sdd-test-*`): login sukses dan gagal tercatat; `GET /api/auth/sessions` menandai `current`; mengeluarkan sesi lain membuat cookie sesi itu 401; sesi sendiri ditolak 400; user A tidak bisa menghapus sesi user B (404).
- Manual (user, di server): IP di daftar perangkat adalah IP publik HP/laptop, bukan `172.x`. Bila masih `172.x`, catat bahwa Funnel tidak meneruskan `X-Forwarded-For`.

## 6. Diserahkan ke builder

Letak file endpoint akun sendiri (auth.ts vs file baru), tata letak modal, format waktu, dan pemecahan komponen web, selama mengikuti pola Kelola Akun.
