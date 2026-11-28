# Perangkat Aktif & Riwayat Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User dan admin bisa melihat perangkat yang sedang login, membaca riwayat login permanen, dan mengeluarkan perangkat. IP yang dicatat adalah IP asli klien.

**Architecture:** Fungsi murni (label perangkat, SQL event login, pemetaan sesi, paginasi) diuji dengan `node:test`. `auth.ts` mencatat event saat login/logout dan memperbarui IP sesi. Endpoint sesi milik sendiri ada di file baru `routes/sessions.ts`; endpoint admin ditambahkan ke `routes/users.ts`. Web memakai satu komponen `DevicesPanel` untuk mode "sendiri" dan "admin".

**Tech Stack:** Express 4 + pg (`tsx --test`), React 18 + Tailwind + lucide-react, Postgres Neon (DB audit = database `ats_db`, schema `tenant_studio`).

**Spec:** `docs/superpowers/specs/2026-11-28-perangkat-riwayat-login-design.md`

## Global Constraints

- `app.set("trust proxy", "loopback, uniquelocal")`. Nilai lain tidak boleh.
- Event login: `kind` ∈ `login_berhasil | login_gagal | login_terkunci | logout | dikeluarkan`. `reason` (khusus `login_gagal`) ∈ `password_salah | tidak_terdaftar | nonaktif`.
- `email` di event dipotong 254 karakter, `user_agent` dipotong 300 karakter.
- `login_terkunci` ditulis sekali per masa kunci.
- Kegagalan menulis event login tidak boleh menggagalkan login/logout (try/catch + `console.warn`, tanpa data sensitif).
- Password (benar atau salah) dan token/hash sesi tidak pernah masuk event, log, atau respons. Frontend hanya menerima `id` sesi.
- Respons login gagal tetap `"Email atau password salah."` untuk semua alasan (tidak membocorkan status akun).
- Sesi yang sedang dipakai tidak bisa dikeluarkan lewat endpoint mana pun: 400 `"Gunakan Logout untuk perangkat ini."`
- `:id`/`:sid` bukan UUID → 404. Sesi tidak ada atau bukan milik akun itu → 404 `"Sesi tidak ditemukan."`
- Paginasi riwayat: `limit` 1..200, default 50, `before` ISO (tidak valid → diabaikan), `nextBefore` = `createdAt` baris terakhir bila halaman penuh, selain itu null.
- Semua SQL memakai `esc()`. Perubahan DB hanya lewat migrasi idempoten. Teks UI dalam Bahasa Indonesia; satu tombol utama, aksi lain ghost/icon-only.
- Agent tidak menyimpan tenant config dan tidak menulis ke Neon dengan SQL manual (SELECT boleh).

## Review Focus

1. **`X-Forwarded-For` palsu dari klien yang tidak lewat proxy** tidak boleh dipercaya. Request dari IP publik langsung dengan header palsu → `req.ip` tetap IP koneksi (Task 1, tes `trustProxy`).
2. **Login gagal berulang selama terkunci** hanya menghasilkan satu `login_terkunci` per masa kunci (Task 2, tes `consumeLockNotice`).
3. **User A mencoba `DELETE /api/auth/sessions/<sesi milik B>`** → 404, sesi B tetap ada (Task 3, uji curl).
4. **Event untuk email tak terdaftar** tidak muncul di `/api/auth/login-history` user mana pun (filter `user_id = req.user.id`; Task 3, uji curl dengan email asal).
5. **UA aneh atau sangat panjang** (kosong, curl, 5000 karakter) tidak membuat error; label jatuh ke fallback dan UA dipotong (Task 1, tes `deviceLabel` dan `buildLoginEventSql`).

---

### Task 1: Fungsi murni — label perangkat, trust proxy, SQL event, pemetaan sesi, paginasi

**Files:**
- Create: `apps/bff/src/users/device.ts`, `apps/bff/src/users/loginEvents.ts`, `apps/bff/src/users/sessions.ts`, `apps/bff/src/trustProxy.ts`
- Test: `apps/bff/src/users/device.test.ts`, `apps/bff/src/users/loginEvents.test.ts`, `apps/bff/src/users/sessions.test.ts`, `apps/bff/src/trustProxy.test.ts`
- Modify: `apps/bff/src/routes/users.ts` (pakai `parsePageQuery` di `/api/admin/user-events`, perilaku tidak berubah)

**Interfaces:**
- Produces:
  ```ts
  // device.ts
  export function deviceLabel(ua: string | null | undefined): string;
  // trustProxy.ts
  export const TRUST_PROXY = "loopback, uniquelocal";
  // loginEvents.ts
  export type LoginEventKind = "login_berhasil" | "login_gagal" | "login_terkunci" | "logout" | "dikeluarkan";
  export type LoginFailReason = "password_salah" | "tidak_terdaftar" | "nonaktif";
  export interface LoginEventInput {
    userId: string | null; email: string; kind: LoginEventKind; reason?: LoginFailReason | null;
    ip: string | null; userAgent: string | null; sessionId?: string | null; actorName?: string | null;
  }
  export function buildLoginEventSql(e: LoginEventInput): string;   // satu INSERT ... ; memakai esc + deviceLabel
  export async function recordLoginEvent(db: { query(sql: string): Promise<unknown> }, e: LoginEventInput): Promise<void>; // tidak pernah throw
  export interface LoginEventRow { id: string; email: string; kind: LoginEventKind; reason: LoginFailReason | null;
    deviceLabel: string; ip: string | null; actorName: string | null; createdAt: string; userRegistered: boolean }
  export function toLoginEventRow(row: any): LoginEventRow;   // deviceLabel fallback dari user_agent; userRegistered = row.user_id != null
  // sessions.ts
  export interface SessionRow { id: string; deviceLabel: string; ip: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }
  export function toSessionRow(row: any, currentSessionId: string | null): SessionRow;
  export const UUID_RE: RegExp;   // pindahkan dari routes/users.ts bila sudah ada di sana, lalu import di sana
  export function parsePageQuery(q: { limit?: unknown; before?: unknown }): { limit: number; before: string | null };
  ```

- [ ] **1.1 Tulis tes yang gagal:**
  - `deviceLabel`:
    - Chrome Windows (`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`) → `"Chrome · Windows"`
    - Edge Windows (UA yang sama + ` Edg/131.0.0.0`) → `"Edge · Windows"`
    - Safari iPhone (`Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1`) → `"Safari · iPhone"`
    - Chrome iPhone (`... CriOS/131.0 Mobile/15E148 Safari/604.1`) → `"Chrome · iPhone"`
    - Safari macOS (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15`) → `"Safari · macOS"`
    - Firefox Linux (`Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0`) → `"Firefox · Linux"`
    - Chrome Android (`Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36`) → `"Chrome · Android"` (Android dicek sebelum Linux)
    - `curl/8.7.1` → `"curl"`; `node` / `undici` → `"Node.js · Server"`; `""`, `null`, `undefined` → `"Perangkat tidak dikenal"`; `"Foo/1.0 (Windows NT 10.0)"` → `"Browser lain · Windows"`
  - `trustProxy.test.ts`: app express dengan `app.set("trust proxy", TRUST_PROXY)` dan route yang mengembalikan `req.ip`.
    - Request dari 127.0.0.1 dengan `X-Forwarded-For: 203.0.113.7` → `"203.0.113.7"`.
    - Request dengan `X-Forwarded-For: 203.0.113.7, 198.51.100.9` dari loopback → `"198.51.100.9"` (hop publik terakhir yang tidak dipercaya, bukan nilai pertama yang bisa dipalsukan klien).
  - `buildLoginEventSql`:
    - Email 300 karakter → SQL berisi email 254 karakter.
    - UA 5000 karakter → dipotong 300.
    - SQL memuat label `deviceLabel(ua)`.
    - `userId: null` → `NULL`.
    - Tidak ada kolom password di SQL.
  - `recordLoginEvent`: db palsu yang `query` melempar error → fungsi resolve tanpa throw.
  - `toSessionRow`:
    - `current` true hanya bila `row.id === currentSessionId`.
    - `device_label` null + `user_agent` Chrome Windows → `"Chrome · Windows"`.
    - Tanggal menjadi ISO.
    - Objek hasil tidak punya `token_hash` atau `user_agent`.
  - `toLoginEventRow`: `user_id` null → `userRegistered:false`.
  - `parsePageQuery`:
    - `{}` → `{limit:50,before:null}`; `{limit:"0"}` → 1; `{limit:"999"}` → 200.
    - `{before:"bukan-tanggal"}` → `before:null`; `{before:"2026-11-28T10:00:00.000Z"}` → string ISO itu.
- [ ] **1.2** `pnpm --filter bff test` → FAIL (modul belum ada).
- [ ] **1.3** Implementasikan. `deviceLabel` memakai urutan cek browser Edge(`Edg/`) → Opera(`OPR/`) → Firefox(`Firefox/`|`FxiOS`) → Chrome(`Chrome/`|`CriOS`) → Safari(`Safari/`), dan OS iPhone → iPad → Android → Windows → macOS(`Macintosh`) → ChromeOS(`CrOS`) → Linux. Ganti parsing limit/before di `/api/admin/user-events` dengan `parsePageQuery`.
- [ ] **1.4** `pnpm --filter bff build && pnpm --filter bff test` → semua PASS (termasuk 205 tes lama).
- [ ] **1.5** Commit: `feat(bff): label perangkat, trust proxy, helper event login dan sesi`

### Task 2: Pencatatan login/logout, IP asli, skema

**Files:**
- Modify: `apps/bff/src/main.ts` (`app.set("trust proxy", TRUST_PROXY)` sebelum `registerAuth`)
- Modify: `apps/bff/src/auth.ts` (DDL, login, logout, middleware sesi, kunci login)
- Test: `apps/bff/src/auth.test.ts` (baru; hanya fungsi kunci login)

**Interfaces:**
- Consumes: Task 1 (`recordLoginEvent`, `deviceLabel`, `TRUST_PROXY`).
- Produces:
  - Kolom `studio_sessions.ip`, `studio_sessions.device_label`; tabel `studio_login_events` (DDL spec §4.2, persis, termasuk kolom `reason`).
  - `req.sessionId: string` (augmentasi `Express.Request`), diisi middleware untuk sesi valid.
  - `export function consumeLockNotice(key: string): boolean` di `auth.ts`: true hanya pada panggilan pertama selama satu masa kunci aktif; masa kunci baru → true lagi.

- [ ] **2.1 Tulis tes yang gagal** di `auth.test.ts`:
  - Panggil `recordFailedLogin(k)` sampai terkunci (export `recordFailedLogin` dan `loginLockedMs` bila belum).
  - `consumeLockNotice(k)` → true, lalu false, lalu false.
  - Kunci yang berbeda → true.
  - Bila mengimpor `auth.ts` menyeret `db.ts`, tutup pool di `after()` seperti `users.test.ts`.
- [ ] **2.2** Jalankan → FAIL.
- [ ] **2.3** Implementasi:
  - DDL di `initAuthSchema` (spec §4.2).
  - `failedLogins` entry mendapat flag `lockNoticed`; `consumeLockNotice` membacanya dan menyetelnya.
  - **Login**:
    - Query user **tanpa** filter `is_active` (ambil `id, password_hash, is_active`).
    - Saat terkunci: bila `consumeLockNotice` → tulis `login_terkunci` (user_id bila email terdaftar), lalu respons 429 seperti sekarang.
    - Tidak ada baris → `login_gagal/tidak_terdaftar`. Ada tapi `is_active=false` → `login_gagal/nonaktif`. Password salah → `login_gagal/password_salah`. Ketiganya tetap `recordFailedLogin` dan respons 401 `"Email atau password salah."`.
    - Sukses → INSERT sesi dengan `ip = req.ip ?? null` dan `device_label = deviceLabel(ua)`, `RETURNING id`, lalu `login_berhasil` dengan `sessionId`.
  - **Logout**: ambil `id, user_id` sesi sebelum DELETE, lalu tulis `logout` dengan `sessionId`.
  - **Middleware**:
    - SELECT sesi ikut `ip, user_agent`; set `req.sessionId`.
    - Bila `req.ip` ada dan berbeda dari `session.ip` → `UPDATE studio_sessions SET ip, device_label` (pakai UA request saat ini).
    - Logika sliding 1 jam tetap.
  - Semua penulisan event lewat `recordLoginEvent(auditDb, …)`, tanpa `await` yang bisa menggagalkan respons (boleh di-await karena tidak pernah throw).
- [ ] **2.4** `pnpm --filter bff build && pnpm --filter bff test` → PASS.
- [ ] **2.5 Verifikasi dengan BFF yang sedang jalan** (`pnpm dev` milik user di :4000; jangan jalankan BFF baru):
  - Login gagal 1x dengan email `sdd-nope-<n>@example.com` dan 1x dengan password salah untuk akun admin (`STUDIO_MCP_EMAIL`), lalu login sukses (kredensial dari `.env`, jangan dicetak; buang tanda kutip pembungkus bila ada).
  - Kirim `X-Forwarded-For: 203.0.113.7` pada login sukses.
  - Cek Neon (SELECT): `SELECT email, kind, reason, ip, device_label FROM tenant_studio.studio_login_events ORDER BY created_at DESC LIMIT 5;` → `login_gagal/tidak_terdaftar` (user_id null), `login_gagal/password_salah`, `login_berhasil` dengan ip `203.0.113.7` dan label `curl`.
  - Logout → baris `logout`.
  - **Penting**: password salah ke akun admin ikut menambah hitungan kunci. Jangan lebih dari 1 kali.
- [ ] **2.6** Commit: `feat(bff): catat riwayat login, IP asli klien, IP sesi`

### Task 3: Endpoint sesi & riwayat (sendiri + admin)

**Files:**
- Create: `apps/bff/src/routes/sessions.ts` (`export const router`)
- Modify: `apps/bff/src/main.ts` (pasang router sesi setelah `registerAuth`, sebelum `targetEnvMiddleware`)
- Modify: `apps/bff/src/routes/users.ts` (3 endpoint admin), `apps/bff/src/users/rules.ts` (`UserAction` + `"revoke_session"`)
- Test: `apps/bff/src/routes/sessions.test.ts` (baru), `apps/bff/src/routes/users.test.ts` (tambah kasus)

**Interfaces:**
- Consumes: Task 1 (`toSessionRow`, `toLoginEventRow`, `parsePageQuery`, `UUID_RE`, `buildLoginEventSql`), Task 2 (`req.sessionId`).
- Produces (dipakai Task 4):
  - `GET /api/auth/sessions` → `{ data: SessionRow[] }` (hanya `expires_at > NOW()`, urut `last_seen_at DESC`)
  - `DELETE /api/auth/sessions/:id` → `{ success: true }`
  - `GET /api/auth/login-history?limit&before` → `{ data: LoginEventRow[], nextBefore: string|null }` (`WHERE user_id = req.user.id`)
  - `GET /api/admin/users/:id/sessions` → `{ data: SessionRow[] }`
  - `DELETE /api/admin/users/:id/sessions/:sid` → `{ success: true }`
  - `GET /api/admin/login-history?userId&limit&before` → `{ data: LoginEventRow[], nextBefore }` (`userId` bukan UUID → diabaikan)

- [ ] **3.1 Tulis tes yang gagal:**
  - `users.test.ts`: tambah tiga endpoint admin baru ke tabel kasus 403 FORBIDDEN untuk user biasa.
  - `sessions.test.ts` (pola yang sama, stub `req.user` dan `req.sessionId`):
    - `DELETE /api/auth/sessions/bukan-uuid` → 404 `"Sesi tidak ditemukan."`.
    - `DELETE /api/auth/sessions/<sama dengan req.sessionId>` → 400 `"Gunakan Logout untuk perangkat ini."`.
    - Kedua kasus harus selesai tanpa query DB (validasi sebelum query).
- [ ] **3.2** Jalankan → FAIL.
- [ ] **3.3** Implementasi:
  - DELETE (sendiri maupun admin) memakai transaksi: `DELETE FROM studio_sessions WHERE id=$sid AND user_id=$owner RETURNING id, ip, device_label, user_agent`.
    - 0 baris → ROLLBACK + 404.
    - Ada baris → tulis `buildLoginEventSql({ kind:"dikeluarkan", userId: owner, email: <email pemilik>, sessionId, actorName: req.user.displayName, ip/userAgent dari baris sesi })` di client yang sama.
    - Untuk admin, juga INSERT `studio_user_events` (action `revoke_session`, `details: { device, ip }`), lalu COMMIT.
  - Cek "sesi yang sedang dipakai" (`sid === req.sessionId`) dilakukan sebelum transaksi.
  - Admin: `:id` akun harus ada (404 `"Akun tidak ditemukan."` bila tidak).
- [ ] **3.4** `pnpm --filter bff build && pnpm --filter bff test` → PASS.
- [ ] **3.5 Verifikasi curl** ke BFF yang sedang jalan:
  - Aktifkan sementara `sdd-test-1@example.com` lewat endpoint admin, reset password-nya, login, dan ganti password.
  - Buat dua sesi untuk akun uji (dua cookie jar).
  - `GET /api/auth/sessions` dari jar A → 2 sesi, `current` benar di A.
  - Jar A `DELETE` sesi B → 200; jar B `GET /api/auth/me` → 401.
  - Jar A `DELETE` sesinya sendiri → 400.
  - Jar A `DELETE` id sesi milik admin → 404, dan sesi admin tetap jalan.
  - `GET /api/auth/login-history` jar A tidak memuat email `sdd-nope-*`.
  - Admin: `GET /api/admin/login-history` memuat `sdd-nope-*` dengan `userRegistered:false`.
  - Admin `DELETE` sesi akun uji → event `revoke_session` di `/api/admin/user-events`.
  - Setelah selesai: nonaktifkan lagi `sdd-test-1` lewat API dan hapus cookie jar.
- [ ] **3.6** Commit: `feat(bff): endpoint perangkat aktif dan riwayat login`

### Task 4: Web — Perangkat & Riwayat Login

**Files:**
- Create: `apps/web/src/components/studio/DevicesPanel.tsx` (tab Perangkat Aktif + Riwayat Login; prop `mode: { kind: "self" } | { kind: "admin"; userId: string; email: string }`)
- Create: `apps/web/src/components/studio/LoginHistoryList.tsx` (daftar + "Muat lebih banyak"; dipakai `DevicesPanel` dan tab admin)
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/types.ts`, `apps/web/src/components/studio/StudioHeader.tsx`, `apps/web/src/components/studio/GlobalOverlays.tsx`, `apps/web/src/studio/useStudioState.ts` (state modal, pola `setShowChangePassword`), `apps/web/src/components/studio/ManageAccountsModal.tsx` (aksi baris "Perangkat", tab "Riwayat Login", kata kerja `revoke_session`)

**Interfaces:**
- Consumes: endpoint Task 3; `SessionRow`, `LoginEventRow` (salin bentuknya ke `types.ts`).
- Produces di `api.ts`: `listMySessions()`, `revokeMySession(id)`, `listMyLoginHistory(before?)`, `listUserSessions(userId)`, `revokeUserSession(userId, sid)`, `listLoginHistory({ userId?, before? })`.

Teks tetap (persis):
- Menu: `"Perangkat & Riwayat Login"` (ikon `MonitorSmartphone`). Tab: `"Perangkat Aktif"`, `"Riwayat Login"`. Badge: `"Perangkat ini"`. Tombol ikon: title `"Keluarkan"`. Konfirmasi: `"Keluarkan perangkat <deviceLabel>? Perangkat itu harus login ulang."`
- Baris perangkat: `<deviceLabel>` · `<ip ?? "IP tidak diketahui">` · `"Login <waktu>"` · `"Terakhir aktif <waktu>"`.
- Riwayat: `login_berhasil`→`"Login berhasil"`; `login_gagal` + `password_salah`→`"Login gagal (password salah)"`, `tidak_terdaftar`→`"Login gagal (email tidak terdaftar)"`, `nonaktif`→`"Login gagal (akun nonaktif)"`; `login_terkunci`→`"Login ditolak (terkunci)"`; `logout`→`"Logout"`; `dikeluarkan`→`"Dikeluarkan oleh <actorName>"`. Format baris: `<teks> · <deviceLabel> · <ip> · <waktu lokal>`. Di mode admin, awali dengan `<email>`, dan tambahkan `" (tidak terdaftar)"` bila `userRegistered` false.
- Log Aktivitas: `revoke_session` → `"mengeluarkan perangkat"` + `" (<details.device>)"`.

- [ ] **4.1** Tambahkan tipe dan fungsi API.
- [ ] **4.2** Buat `LoginHistoryList` dan `DevicesPanel`. Tombol Keluarkan tidak tampil di baris `current`. Setelah keluarkan berhasil, daftar dimuat ulang. Error BFF ditampilkan apa adanya.
- [ ] **4.3** Menu "Perangkat & Riwayat Login" untuk semua user, membuka modal berisi `DevicesPanel` mode self.
- [ ] **4.4** Kelola Akun: aksi baris ikon "Perangkat" (semua baris, termasuk akun sendiri) membuka `DevicesPanel` mode admin. Tab ketiga "Riwayat Login" berisi `LoginHistoryList` untuk semua akun.
- [ ] **4.5** `pnpm --filter web build` → lulus.
- [ ] **4.6** Commit: `feat(web): perangkat aktif dan riwayat login`

### Task 5: Penutup

- [ ] **5.1** `pnpm build && pnpm --filter bff test` → lulus.
- [ ] **5.2** Vault `Vaults/Jobseeker/app_tenant_config_beta/`:
  - Database (tabel/kolom baru), BFF-API (endpoint, trust proxy), Frontend-Studio (modal, tab).
  - Keputusan-dan-Riwayat: baris 2026-11-28 dengan keputusan (blokir perangkat ditiadakan atas keputusan user, riwayat permanen, terkunci dicatat sekali per masa kunci) dan open item (cek IP asli lewat Funnel di server).
  - Status hub: Kelola Akun sudah di-merge ke `feat/docker-deploy`; fitur ini ada di branch `feat/perangkat-login`.
- [ ] **5.3** Tidak ada perubahan repo lain. Commit hanya bila ada (mis. README).
