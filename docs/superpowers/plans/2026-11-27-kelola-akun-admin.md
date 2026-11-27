# Kelola Akun (Admin) & Jejak Pelaku — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin bisa membuat dan mengelola akun Studio. Setiap perubahan akun dan config tercatat atas nama akun pelakunya (ID + nama).

**Architecture:** Aturan validasi dan penjagaan dibuat sebagai fungsi murni di `apps/bff/src/users/rules.ts` dan diuji dengan `node:test`. Handler Express di `apps/bff/src/routes/users.ts` memakai aturan itu di dalam transaksi pg. Migrasi skema ditambahkan ke `initAuthSchema`, yang berjalan idempoten saat BFF start. Penulisan history dan batch memakai tipe `Actor { id, name }` sebagai pengganti string nama. Web mendapat modal "Kelola Akun" dan tooltip email di riwayat.

**Tech Stack:** Express 4 + pg (BFF, `tsx --test`), React 18 + Tailwind + lucide-react (web), Postgres Neon (DB audit = database `ats_db`, schema `tenant_studio`).

**Spec:** `docs/superpowers/specs/2026-11-27-kelola-akun-admin-design.md`

## Global Constraints

- Peran hanya `'admin' | 'user'`. Tidak ada peran lain.
- Password minimal 8 karakter (`MIN_PASSWORD_LENGTH` yang sudah ada). Password acak buatan sistem 16 karakter.
- Akun baru dan akun yang direset selalu `must_change_password = true`.
- Akun tidak pernah dihapus, hanya `is_active = false`.
- Password dan hash tidak boleh masuk `studio_user_events.details`, log console, atau respons, kecuali password sementara yang dikembalikan sekali di respons create/reset.
- Nama pelaku selalu diambil dari `req.user`, tidak pernah dari body request.
- Semua SQL memakai helper `esc()` dari `apps/bff/src/db.ts` (pola yang sudah ada). Transaksi memakai `auditDb.connect()` + `BEGIN/COMMIT/ROLLBACK`.
- Teks UI dalam Bahasa Indonesia. Satu tombol utama per layar; aksi lain ghost/icon-only.
- Perubahan DB hanya lewat migrasi kode. Tidak ada DDL/DML manual ke Neon. Cek Neon cukup dengan `SELECT`.

## Review Focus

1. **Dua admin saling menurunkan secara bersamaan** (race): admin aktif tidak boleh habis. Hitungan admin harus dibaca dengan `SELECT ... FOR UPDATE` di dalam transaksi (Task 3, uji manual langkah 3.6).
2. **Email dengan huruf besar atau spasi** (`" Budi@X.com "`) harus dinormalisasi menjadi `budi@x.com`, dan dianggap duplikat bila sudah ada (Task 2: `normalizeEmail`, Task 3: 409).
3. **User biasa memanggil `/api/admin/*` langsung lewat curl** harus mendapat 403, termasuk akun yang masih `must_change_password` (Task 3 langkah 3.5).
4. **Admin mereset password sendiri lewat endpoint admin** ditolak; admin harus memakai Ganti Password (Task 2: `checkUserChange` dengan aksi `reset_password`).
5. **Akun yang dinonaktifkan dengan tab masih terbuka**: request berikutnya 401, dan web ter-logout saat tab kembali fokus (Task 5 langkah 5.6).

---

### Task 1: Skema peran, event, author_id + `role` di StudioUser

**Files:**
- Modify: `apps/bff/src/auth.ts` (fungsi `initAuthSchema`, `toStudioUser`, `loadUserById`, interface `StudioUser`)
- Modify: `apps/bff/src/studioSchema.ts` (kolom `author_id`)
- Test: `apps/bff/src/users/rules.test.ts` (dibuat di Task 2; Task 1 diverifikasi lewat Neon)

**Interfaces:**
- Produces: `StudioUser.role: "admin" | "user"`. Tabel `tenant_studio.studio_user_events`. Kolom `studio_users.role`, `studio_users.created_by`, `tenant_config_histories.author_id`, `config_change_batches.author_id`.

- [ ] **1.1** Di `initAuthSchema`, tambahkan DDL dari spec §5.1, persis: kolom `role` (default `'user'`, CHECK), `created_by`, dan tabel `studio_user_events` + index. Taruh setelah blok `CREATE TABLE` yang sudah ada.
- [ ] **1.2** Ubah INSERT user default (saat tabel kosong) agar menyertakan `role = 'admin'`.
- [ ] **1.3** Tambahkan query bootstrap admin dari spec §5.1, dengan `<STUDIO_DEFAULT_EMAIL>` = `esc((process.env.STUDIO_DEFAULT_EMAIL || "").trim().toLowerCase())`. Jalankan setelah blok user default.
- [ ] **1.4** Di `studioSchema.ts`, pada fungsi migrasi yang berisi `ALTER TABLE ... config_change_batches`, tambahkan `ADD COLUMN IF NOT EXISTS author_id uuid` untuk `tenant_config_histories` dan `config_change_batches`.
- [ ] **1.5** Tambahkan `role` ke `StudioUser`, ke `SELECT` di `loadUserById` (`u.role`), dan ke `toStudioUser` (`role: row.role === "admin" ? "admin" : "user"`).
- [ ] **1.6** Jalankan `pnpm --filter bff build`. Expected: tanpa error TypeScript.
- [ ] **1.7** Jalankan `pnpm dev:bff`, tunggu log start, lalu cek Neon (dbx, database `ats_db`):
  `SELECT email, role FROM tenant_studio.studio_users;` → `ketutkusuma0910@yopmail.com | admin`.
  `SELECT to_regclass('tenant_studio.studio_user_events');` → tidak null.
  Restart BFF sekali lagi untuk memastikan migrasi idempoten (tanpa error).
- [ ] **1.8** Commit: `feat(bff): kolom role, studio_user_events, author_id`

### Task 2: Aturan akun (fungsi murni)

**Files:**
- Create: `apps/bff/src/users/rules.ts`
- Test: `apps/bff/src/users/rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Role = "admin" | "user";
  export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
  export function normalizeEmail(raw: unknown): string;                       // trim + lowercase, "" bila bukan string
  export function parseCreateUserBody(body: unknown): Parsed<{ email: string; displayName: string; role: Role; password: string | null }>;
  export function parseUpdateUserBody(body: unknown): Parsed<{ displayName?: string; role?: Role; isActive?: boolean }>;
  export function generateTempPassword(): string;                             // 16 karakter, crypto.randomBytes, alfabet tanpa 0/O/l/1
  export type UserAction = "create" | "update" | "deactivate" | "activate" | "reset_password";
  export function checkUserChange(i: {
    actorId: string;
    target: { id: string; role: Role; isActive: boolean };
    action: "update" | "reset_password";
    change?: { role?: Role; isActive?: boolean };
    activeAdminCount: number;           // admin aktif SEBELUM perubahan
  }): { ok: true } | { ok: false; status: 403 | 409; error: string };
  export function describeUpdate(before: { displayName: string; role: Role; isActive: boolean },
                                 change: { displayName?: string; role?: Role; isActive?: boolean }):
    { action: UserAction; details: Record<string, { from: unknown; to: unknown }> } | null; // null bila tidak ada yang berubah
  ```

Pesan error (tepat seperti ini):
- `"Format email tidak valid."` · `"Peran harus admin atau user."` · `"Password minimal 8 karakter."` · `"Nama tampilan maksimal 100 karakter."` · `"Tidak ada perubahan yang dikirim."` · `"isActive harus boolean."`
- `"Tidak bisa menurunkan peran atau menonaktifkan akun sendiri."` (403) · `"Gunakan menu Ganti Password untuk akun sendiri."` (403) · `"Minimal harus ada satu admin aktif."` (409)

- [ ] **2.1 Tulis tes yang gagal** di `rules.test.ts` (gaya `node:test` + `assert/strict`, import dari `./rules.js`):
  - `normalizeEmail(" Budi@X.com ")` → `"budi@x.com"`; `normalizeEmail(5)` → `""`.
  - `parseCreateUserBody({ email: "budi@x" })` → `{ ok:false, error:"Format email tidak valid." }` (regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`).
  - `parseCreateUserBody({ email:"Budi@X.com" })` → ok, `email:"budi@x.com"`, `displayName:"budi"` (default = bagian sebelum @), `role:"user"`, `password:null`.
  - `role:"viewer"` → `"Peran harus admin atau user."`; `password:"1234567"` → `"Password minimal 8 karakter."`; `displayName:"x".repeat(101)` → `"Nama tampilan maksimal 100 karakter."`; `password:""` diperlakukan sebagai `null`.
  - `parseUpdateUserBody({})` → `"Tidak ada perubahan yang dikirim."`; `{ isActive:"false" }` → `"isActive harus boolean."`; `{ email:"a@b.co" }` saja → `"Tidak ada perubahan yang dikirim."` (email diabaikan).
  - `generateTempPassword()` panjang 16, dua panggilan berbeda, tidak mengandung `0`, `O`, `l`, `1`.
  - `checkUserChange`: aktor = target dengan `change:{role:"user"}` → 403 pesan akun sendiri; aktor = target dengan `change:{isActive:false}` → 403 yang sama; aktor = target dengan `action:"reset_password"` → 403 Ganti Password; target admin lain, `activeAdminCount:1`, `change:{role:"user"}` → 409 (kasus tidak mungkin tapi tetap dijaga); target admin lain, `activeAdminCount:2`, `change:{isActive:false}` → ok; target user, `activeAdminCount:1`, `change:{isActive:false}` → ok; aktor = target dengan `change:{}` (hanya ganti nama) → ok.
  - `describeUpdate({displayName:"A",role:"user",isActive:true}, {isActive:false})` → `{ action:"deactivate", details:{ isActive:{from:true,to:false} } }`; `{isActive:true}` dari false → `"activate"`; `{role:"admin"}` → `"update"` dengan `details.role`; nilai sama dengan sebelumnya → `null`.
- [ ] **2.2** Jalankan `pnpm --filter bff test`. Expected: FAIL (modul `./rules.js` tidak ditemukan).
- [ ] **2.3** Implementasikan `rules.ts` sesuai Interfaces. `checkUserChange` menghitung `wouldRemoveAdmin = target.role==="admin" && target.isActive && (change.role==="user" || change.isActive===false)`; 409 bila `wouldRemoveAdmin && activeAdminCount <= 1`. Cek akun sendiri didahulukan sebelum cek admin terakhir.
- [ ] **2.4** Jalankan `pnpm --filter bff test`. Expected: semua PASS, termasuk tes lama.
- [ ] **2.5** Commit: `feat(bff): aturan validasi kelola akun`

### Task 3: Endpoint admin `/api/admin/*`

**Files:**
- Create: `apps/bff/src/routes/users.ts`
- Modify: `apps/bff/src/auth.ts` (export `hashPassword`, tambah `requireAdmin`)
- Modify: `apps/bff/src/main.ts` (pasang router setelah `registerAuth`)

**Interfaces:**
- Consumes: semua fungsi dari Task 2; `StudioUser.role` (Task 1).
- Produces (dipakai Task 5):
  - `export function requireAdmin(req, res, next)` di `auth.ts` → 403 `{ code:"FORBIDDEN", error:"Hanya admin yang boleh mengakses fitur ini." }`.
  - `GET /api/admin/users` → `{ data: AdminUserRow[] }`, dengan `AdminUserRow = { id, email, displayName, role, isActive, mustChangePassword, lastLoginAt: string|null, createdAt: string, createdByName: string|null }`, urut `created_at ASC`.
  - `POST /api/admin/users` body `{ email, displayName?, role?, password? }` → 201 `{ user: AdminUserRow, tempPassword: string }`; 409 `"Email sudah terdaftar."`.
  - `PATCH /api/admin/users/:id` body `{ displayName?, role?, isActive? }` → `{ user: AdminUserRow }`; 404 `"Akun tidak ditemukan."`.
  - `POST /api/admin/users/:id/reset-password` body `{ password? }` → `{ tempPassword: string }`.
  - `GET /api/admin/user-events?limit=50&before=<ISO>` → `{ data: UserEventRow[], nextBefore: string|null }`, dengan `UserEventRow = { id, actorName, targetEmail, action, details, createdAt }`; `limit` dibatasi 1..200.

- [ ] **3.1** Export `hashPassword` dan tambahkan `requireAdmin` di `auth.ts`.
- [ ] **3.2** Buat `routes/users.ts` (`export const router`), semua route diawali `requireAdmin`. Setiap aksi tulis memakai satu client transaksi:
  - create: `parseCreateUserBody` → `password ?? generateTempPassword()` → INSERT (`must_change_password=true`, `created_by=req.user.id`). Tangkap error kode `23505` → 409. Tulis event `create` dengan `details: { role, displayName }`.
  - patch: `SELECT ... FROM studio_users WHERE id=$ FOR UPDATE`, lalu `SELECT count(*) FROM studio_users WHERE role='admin' AND is_active FOR UPDATE` (kunci baris admin agar perubahan serentak berurutan) → `checkUserChange` → `describeUpdate` (null → kembalikan user apa adanya, tanpa event) → UPDATE (`updated_at=NOW()`). Bila `isActive` menjadi false, `DELETE FROM studio_sessions WHERE user_id=$`. Tulis event dari `describeUpdate`.
  - reset-password: `checkUserChange({ action:"reset_password", ... })` → UPDATE hash + `must_change_password=true` → hapus semua sesi akun → event `reset_password` dengan `details: {}`.
  - Event: `actor_user_id=req.user.id`, `actor_name=req.user.displayName`, `target_email` = email target.
- [ ] **3.3** Pasang di `main.ts`: `app.use(userRoutes)` setelah `registerAuth(...)` dan sebelum `targetEnvMiddleware`, supaya endpoint admin tidak bergantung pada header env/service. Cek bahwa `targetEnvMiddleware` tidak menolak path `/api/admin/*`; kalau menolak, kecualikan path itu di middleware.
- [ ] **3.4** Jalankan `pnpm --filter bff build && pnpm --filter bff test`. Expected: lulus.
- [ ] **3.5** Verifikasi manual dengan curl ke BFF lokal (login admin → simpan cookie `-c/-b`):
  - create `{"email":" Coba.User@Example.com ","role":"user"}` → 201, `email:"coba.user@example.com"`, ada `tempPassword`; ulangi → 409.
  - Login sebagai akun baru → `GET /api/admin/users` → 403 (`PASSWORD_CHANGE_REQUIRED` atau `FORBIDDEN`). Ganti password, ulangi → 403 `FORBIDDEN`.
  - Admin `PATCH` dirinya sendiri `{"role":"user"}` → 403. `reset-password` dirinya sendiri → 403.
  - `PATCH` akun baru `{"isActive":false}` → 200; request dengan cookie akun baru → 401.
  - `SELECT action, actor_name, target_email, details FROM tenant_studio.studio_user_events ORDER BY created_at;` → `create`, `deactivate`; `details` tanpa password/hash.
- [ ] **3.6** Uji race: promosikan akun uji menjadi admin, lalu kirim dua `PATCH {"role":"user"}` serentak (dua curl dengan `&`), di mana admin A menurunkan B dan admin B menurunkan A. Expected: satu 200 dan satu 409 atau 403; `SELECT count(*) ... role='admin' AND is_active` ≥ 1.
- [ ] **3.7** Setelah uji, nonaktifkan akun uji lewat endpoint (bukan SQL manual).
- [ ] **3.8** Commit: `feat(bff): endpoint admin kelola akun dan log aktivitas`

### Task 4: `author_id` di riwayat & batch

**Files:**
- Modify: `apps/bff/src/auth.ts` (`Actor`, `actor()`)
- Modify: `apps/bff/src/presetSync.ts:52-75` (`snapshotBeforeChange`)
- Modify: `apps/bff/src/compare/batches.ts:26,37-50,73` (`NewBatch.author`, `createBatch`, kolom SELECT)
- Modify: `apps/bff/src/routes/configs.ts` (INSERT ~79-90 dan ~226-236, query history ~273)
- Modify: `apps/bff/src/routes/sync.ts:166`, `apps/bff/src/routes/references.ts:345`, `apps/bff/src/routes/compare.ts:398,418,585,591,614,622`
- Modify: `apps/bff/src/compare/sqlExport.ts:25` hanya bila tipe `author` diteruskan dari `NewBatch`

**Interfaces:**
- Produces:
  - `export interface Actor { id: string | null; name: string }`
  - `export function actor(req, fallbackName = "Studio User", suffix = ""): Actor` → `{ id: req.user?.id ?? null, name: (req.user?.displayName ?? fallbackName) + suffix }`. `actorName` tetap ada dan memanggil `actor(req, fallback).name`.
  - `snapshotBeforeChange(row, summary, author: Actor, scope, batchId?)`, `NewBatch.author: Actor`.
  - Respons `GET /api/configs/:configId/histories` mendapat field `author_email: string | null` (LEFT JOIN `studio_users u ON u.id = h.author_id`). Daftar batch (kolom di `batches.ts:73`) mendapat `author_email` dengan join yang sama.

- [ ] **4.1** Tambahkan `Actor` dan `actor()` di `auth.ts`.
- [ ] **4.2** Ubah `snapshotBeforeChange` dan `createBatch` agar menulis `author_name = author.name` dan `author_id = author.id`.
- [ ] **4.3** Ganti semua pemanggil ke `actor(req, ...)`. Sync Center memakai `actor(req, "Preset Sync", " (Sync Center)")`. Teks summary yang memakai nama pakai `.name`.
- [ ] **4.4** Dua INSERT langsung di `configs.ts` ikut menulis `author_id`.
- [ ] **4.5** Tambahkan `author_email` di query history dan daftar batch.
- [ ] **4.6** Jalankan `pnpm --filter bff build && pnpm --filter bff test`. Expected: lulus. Perbarui fixture tes lama (`compare.test.ts`, `copyConfigs`) bila tipe `author` berubah.
- [ ] **4.7** Verifikasi: simpan satu config di env `neondb` lewat Studio, lalu `SELECT author_name, author_id FROM tenant_studio.tenant_config_histories ORDER BY created_at DESC LIMIT 1;` → `author_id` = id admin.
- [ ] **4.8** Commit: `feat(bff): catat author_id di riwayat dan batch`

### Task 5: Web — Kelola Akun, tooltip pelaku, cek sesi saat fokus

**Files:**
- Modify: `apps/web/src/components/AuthGate.tsx` (tipe user + `role`; cek `/api/auth/me` saat `visibilitychange`/`focus`)
- Modify: `apps/web/src/types.ts` (`author_email?: string | null` di tipe history & batch; `AdminUserRow`, `UserEventRow` sesuai Task 3)
- Modify: `apps/web/src/lib/api.ts` (fungsi admin)
- Create: `apps/web/src/components/studio/ManageAccountsModal.tsx`
- Modify: `apps/web/src/components/studio/StudioHeader.tsx` (item menu khusus admin)
- Modify: tempat state modal disimpan (ikuti pola `setShowChangePassword` di `useStudioState.ts` / `GlobalOverlays.tsx`)
- Modify: `apps/web/src/components/studio/HistoryPanel.tsx:50`, `ChangeBatchesPanel.tsx:200` (`title` = email)
- Modify: `useCrudActions.ts:303`, `useCompareActions.ts:239`, `useSyncCenter.ts:193`, `useCoreActions.ts:484` (hapus `authorName` hardcode)

**Interfaces:**
- Consumes: endpoint dan bentuk respons Task 3, `author_email` dari Task 4.
- Produces di `api.ts`: `listUsers()`, `createUser(body)`, `updateUser(id, body)`, `resetUserPassword(id, password?)`, `listUserEvents(before?)`, semuanya lewat wrapper `api()` yang sudah ada.

- [ ] **5.1** Tambahkan `role` ke tipe user di AuthGate dan fungsi admin di `api.ts`.
- [ ] **5.2** Buat `ManageAccountsModal` dengan tab **Akun** dan **Log Aktivitas** sesuai spec §5.3:
  - Tombol utama "Tambah Akun". Aksi per baris icon-only dengan `title`: Ubah, Reset password, Nonaktifkan/Aktifkan. Aksi ubah peran dan nonaktifkan disembunyikan pada baris akun sendiri.
  - Setelah create/reset berhasil, tampilkan panel sekali-lihat dengan password sementara, tombol Salin, dan teks "Berikan ke pemilik akun; wajib diganti saat login pertama."
  - Nonaktifkan memakai dialog konfirmasi berteks "Sesi akun ini akan langsung berakhir."
  - Log: `"<actorName> <kata kerja> <targetEmail> · <waktu lokal>"`. Kata kerja: create→"membuat akun", update→"mengubah", deactivate→"menonaktifkan", activate→"mengaktifkan kembali", reset_password→"mereset password". Untuk `details.role`, tambahkan `"(peran user → admin)"`. Ada tombol "Muat lebih banyak" bila `nextBefore`.
  - Error BFF ditampilkan apa adanya (`error`).
- [ ] **5.3** Tambahkan item "Kelola Akun" (ikon `Users`) di menu user `StudioHeader`, hanya bila `user.role === "admin"`.
- [ ] **5.4** Tambahkan `title={h.author_email ?? undefined}` di HistoryPanel dan ChangeBatchesPanel.
- [ ] **5.5** Hapus `authorName` hardcode di empat hook, setelah memastikan BFF tidak membacanya: `grep -rn "body.authorName\|req.body.authorName\|authorName }" apps/bff/src` tidak menemukan pembacaan.
- [ ] **5.6** Di AuthGate, saat `document.visibilityState === "visible"` atau `window` `focus`, panggil `/api/auth/me` (throttle minimal 30 detik). 401 sudah memicu `UNAUTHORIZED_EVENT` lewat `api()`.
- [ ] **5.7** Jalankan `pnpm --filter web build`. Expected: lulus.
- [ ] **5.8** Uji manual di browser (`pnpm dev`):
  1. Admin melihat menu "Kelola Akun"; user biasa tidak.
  2. Buat akun, salin password, login di jendela privat, wajib ganti password.
  3. Akun baru menyimpan config; Riwayat menampilkan namanya, dan hover menampilkan emailnya.
  4. Admin menonaktifkan akun itu; jendela privat ter-logout saat difokuskan lagi.
  5. Tab Log Aktivitas menampilkan create dan deactivate.
- [ ] **5.9** Commit: `feat(web): layar Kelola Akun untuk admin dan email pelaku di riwayat`

### Task 6: Penutup

- [ ] **6.1** Jalankan `pnpm build && pnpm --filter bff test`. Expected: lulus semua.
- [ ] **6.2** Perbarui `apps/mcp/README.md`: MCP sebaiknya memakai akun sendiri dengan peran `user`, dibuat admin lewat Kelola Akun.
- [ ] **6.3** Perbarui vault `Vaults/Jobseeker/app_tenant_config_beta/`: catatan Arsitektur/Database (tabel & kolom baru, endpoint admin), baris baru di Keputusan-dan-Riwayat, dan status singkat di hub.
- [ ] **6.4** Commit: `docs: kelola akun admin`
