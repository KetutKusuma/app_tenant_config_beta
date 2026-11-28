# Edit & Simpan di Layar Bandingkan + Config Tetap Saat Pindah — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Kedua sisi diff di layar Bandingkan antar env bisa diedit dan disimpan ke env masing-masing.
- Saat pindah tenant/env/layanan/domain, editor utama membuka tipe config yang sama dengan sebelumnya.

**Architecture:**
- Logika murni ada di `apps/web/src/studio/compareEdit.ts`, yaitu syarat edit, dirty, dan pemilihan config. File ini diuji dengan `node:test` lewat `tsx` milik paket bff, karena web belum punya test runner.
- `useEnvCompare` memegang draf.
- `EnvCompareScreen` menampilkan tombol dan mengatur alur simpan.
- `useCoreActions.selectTenant` memakai `pickConfigAfterSwitch`.
- Tidak ada perubahan BFF.

**Tech Stack:** React 18, `@monaco-editor/react` DiffEditor, Tailwind, lucide-react, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-28-edit-di-bandingkan-design.md`

**Branch:** dikerjakan setelah rencana `2026-11-28-perangkat-riwayat-login.md`, di branch yang sama (`feat/perangkat-login`).

## Global Constraints

- Simpan hanya lewat `PUT /api/configs/:configId`, dengan `changeSummary` dari `askReason` dan `expectedVersion: row.version_token`, plus header `X-Target-Env: <env sisi>`. Jangan kirim `groupId`.
- Sisi dengan `targetEnvs[].readonly`, sisi `null`, dan baris `ganda` tidak bisa diedit.
- UI hanya punya satu tombol utama (Export SQL). Simpan/Kembalikan adalah tombol ghost. Semua teks UI berbahasa Indonesia, persis seperti di spec §4.
- **AI/subagent tidak boleh menyimpan config**, termasuk di development, baik lewat UI, curl, maupun SQL. Uji simpan dilakukan user di browser.
- `compareEdit.ts` hanya boleh memakai `import type`, supaya bisa dijalankan `tsx` di luar Vite.

## Review Focus

1. **Draf hilang diam-diam.** Muat ulang setelah menyimpan satu sisi tidak boleh menghapus draf sisi lain. Pindah config, env, atau tenant, tukar sisi, Salin ke Kanan, Esc, dan X semuanya harus meminta konfirmasi lebih dulu. → Task 2 Step 3 (manual), `isDirty` di Task 1.
2. **Kursor lompat atau ketikan tertimpa saat mengetik.** Ini terjadi kalau prop `original`/`modified` di-set ulang di setiap ketikan. → Task 2 Step 4 (cek manual).
3. **Sisi read-only atau baris Ganda masih bisa diedit.** → test `sideEditable` di Task 1.
4. **Pindah env memakai `activeConfigType` yang sudah di-reset.** `resetWorkspace()` mengosongkan tipe, jadi nilainya harus ditangkap sebelum itu. → Task 3 Step 3.
5. **Editor utama memakai versi usang** setelah config yang sama disimpan dari layar Bandingkan. → Task 2 Step 3 (sinkron `loadConfig` / `isDbNewer`).

---

### Task 1: Fungsi murni `compareEdit.ts` + test

**Files:**
- Create: `apps/web/src/studio/compareEdit.ts`
- Test: `apps/web/src/studio/compareEdit.test.ts`
- Modify: `apps/web/tsconfig.json` — tambah `"exclude": ["src/**/*.test.ts"]` (web tidak punya `@types/node`, jadi `tsc` build akan gagal pada `node:test`)

**Interfaces:**
- Produces:
  - `prettyValue(value: unknown): string`: mengembalikan `""` untuk `null`/`undefined`, selain itu `JSON.stringify(value, null, 2)`.
  - `sideEditable(entry: CompareEntry | null, side: "left" | "right", envReadonly: boolean): boolean`
  - `isDirty(draft: string | undefined, row: ConfigRow | null): boolean`: `false` kalau `draft === undefined` atau `row === null`. Selain itu `draft !== prettyValue(row.value)`.
  - `pickConfigAfterSwitch<T extends { config_type: string }>(configs: T[], preferType?: string | null): { config: T | null; missingType: string | null }`

- [ ] **Step 1: Tulis test** (`node:test` + `node:assert/strict`, impor `./compareEdit.ts`):
  - `sideEditable`:
    - entry `beda` dengan kedua sisi terisi, sisi kiri, env tidak readonly → `true`;
    - env readonly → `false`;
    - entry `hanya_kiri` dengan sisi `right` → `false`;
    - entry `ganda` → `false`;
    - `entry` bernilai `null` → `false`.
  - `isDirty`:
    - `undefined` → `false`;
    - draf sama dengan `prettyValue(row.value)` → `false`;
    - draf beda → `true`;
    - `row` bernilai `null` → `false`.
  - `pickConfigAfterSwitch` dengan daftar `[{config_type:"A"},{config_type:"CANDIDATE_STABLE"},{config_type:"B"}]`:
    - `"B"` → config B, `missingType: null`;
    - `"X"` → `CANDIDATE_STABLE`, `missingType: "X"`;
    - daftar `[{A},{B}]` dengan `"X"` → A, `missingType: "X"`;
    - `[]` dengan `"X"` → `{ config: null, missingType: null }`;
    - `""` atau `undefined` → `CANDIDATE_STABLE`, `missingType: null`.
- [ ] **Step 2: Jalankan dan pastikan gagal.** Perintah: `pnpm --filter bff exec tsx --test ../web/src/studio/compareEdit.test.ts`. Hasil yang diharapkan: FAIL karena modul belum ada.
- [ ] **Step 3: Implementasikan `compareEdit.ts`** sesuai Interfaces. Gunakan hanya `import type { CompareEntry, ConfigRow } from "../types"`.
- [ ] **Step 4: Jalankan lagi dan pastikan lulus.** Perintah yang sama, hasil yang diharapkan: semua PASS. Lalu jalankan `pnpm --filter web build` dan pastikan lulus.
- [ ] **Step 5: Commit** dengan pesan `feat(web): logika edit layar Bandingkan dan pemilihan config saat pindah`.

### Task 2: Edit & simpan di layar Bandingkan

**Files:**
- Modify: `apps/web/src/studio/useEnvCompare.ts`
- Modify: `apps/web/src/components/studio/EnvCompareScreen.tsx`
- Modify (opsional): `apps/web/src/components/studio/PaneTitle.tsx`, untuk menambah slot `actions?: ReactNode`

**Interfaces:**
- Consumes: `prettyValue`, `sideEditable`, `isDirty` (Task 1); `askReason`, `setStatusMessage`, `targetEnvName`, `selectedConfigId`, `activeConfigType`, `currentGroupId`, `jsonContent`, `originalContent`, `loadConfig`, `setIsDbNewer` dari `useStudio()`. Kalau ada yang tidak diekspos context, tambahkan ke ekspor `useCoreActions`/`useStudioState` yang sudah ada.
- Produces, dari `useEnvCompare`:
  - `drafts: { left?: string; right?: string }`
  - `setDraft(side: "left" | "right", text: string | undefined): void`
  - `hasDirty: boolean`: ada sisi yang `isDirty` untuk entry terpilih.
  - `guard(action: () => void): void`: kalau `hasDirty`, minta `confirm("Ada editan yang belum disimpan di <TYPE>. Buang editan?")` dulu. Kalau user setuju, kosongkan draf lalu jalankan aksinya.
  - Draf dikosongkan otomatis saat `selectedType`, `left`, atau `right` berubah.

- [ ] **Step 1: Draf di `useEnvCompare`.**
  - Tambahkan state `drafts`, `setDraft`, `hasDirty`, dan `guard` sesuai Interfaces.
  - `reload()` **tidak** boleh mengosongkan draf.
  - Draf hanya dikosongkan saat `selectedType`, `left.env`, `left.tenantId`, `right.env`, atau `right.tenantId` berubah.
- [ ] **Step 2: Diff editable.**
  - Buat `DIFF_OPTIONS` per render: `originalEditable: sideEditable(entry,"left",leftEnv?.readonly)` dan `readOnly: !sideEditable(entry,"right",rightEnv?.readonly)`.
  - Di `handleMount`, pasang `getOriginalEditor().onDidChangeModelContent` dan `getModifiedEditor().onDidChangeModelContent`. Keduanya memanggil `setDraft(side, value)`, atau `undefined` kalau nilainya sama dengan baseline.
  - Teks editor diisi `drafts.left ?? leftText`, begitu juga untuk kanan.
- [ ] **Step 3: Judul panel dan simpan.**
  - Di tiap sisi yang editable, tampilkan titik kuning saat dirty dan tombol ghost `Simpan` dan `Kembalikan` (disabled kalau tidak dirty). Sisi lain diberi label `read-only` bila env-nya readonly.
  - Implementasikan `saveSide(side)` persis seperti spec §4.1 langkah 1–5. Setelah berhasil: `setDraft(side, undefined)`, lalu `await c.reload()`. Draf sisi lain tetap ada.
  - Sinkron editor utama: kalau `side.env === targetEnvName` dan `row.id === selectedConfigId`, cek editor utama. Bila tidak dirty (`jsonContent === originalContent`), panggil `loadConfig(row.id, activeConfigType, currentGroupId)`. Bila dirty, panggil `setIsDbNewer(true)`.
  - Bungkus aksi-aksi ini dengan `c.guard`:
    - klik baris daftar;
    - `changeEnv`;
    - ganti tenant di `SidePicker`;
    - `swap`;
    - Salin ke Kanan;
    - tombol X;
    - handler Esc (Esc di dalam Monaco tetap diabaikan seperti sekarang).
- [ ] **Step 4: Verifikasi tanpa menyimpan.**
  - `pnpm --filter web build` → lulus.
  - Di browser: buka layar Bandingkan untuk dua env non-readonly, lalu cek:
    - kedua sisi bisa diketik dan kursor tidak lompat;
    - titik dirty muncul, dan Kembalikan memulihkan isi;
    - pindah config menampilkan konfirmasi;
    - Esc menampilkan konfirmasi;
    - baris "Hanya Kanan" tidak bisa diedit di sisi kiri.
  - **Jangan menekan Simpan sampai dialog alasan dikonfirmasi.** Cukup buka dialog alasan lalu Batal untuk memastikan ringkasan diff tampil.
  - Kalau browser tidak tersedia, laporkan bahwa langkah ini diserahkan ke user.
- [ ] **Step 5: Commit** dengan pesan `feat(web): edit dan simpan kedua sisi di layar Bandingkan antar env`.

### Task 3: Config tetap saat pindah

**Files:**
- Modify: `apps/web/src/studio/useCoreActions.ts`, yaitu `selectTenant` (~baris 149), `fetchTenants` (~baris 50), `handleSwitchTargetService`, `handleSwitchTargetEnv`, `handleSwitchDomain`, dan pemanggil pindah tenant manual (~baris 525).
- Modify, kalau memanggil `fetchTenants`: `apps/web/src/studio/useCrudActions.ts`. Tidak wajib diubah; parameter baru bersifat opsional.

**Interfaces:**
- Consumes: `pickConfigAfterSwitch` (Task 1).
- Produces:
  - `selectTenant(tenant: Tenant, preferType?: string | null): Promise<void>`
  - `fetchTenants(selectCode?: string, preferType?: string | null): Promise<void>`

- [ ] **Step 1:** `selectTenant` memakai `pickConfigAfterSwitch(json.data, preferType)`. Kalau `missingType` terisi, tampilkan `setStatusMessage("⚠️ <missingType> tidak ada di <tenant.name>, membuka <config.config_type>.")`, lalu hapus setelah 4000 ms. Untuk `config === null`, perilakunya tetap seperti sekarang.
- [ ] **Step 2:** `fetchTenants` meneruskan `preferType` ke `selectTenant`.
- [ ] **Step 3:** Di `handleSwitchTargetService`, `handleSwitchTargetEnv`, dan `handleSwitchDomain`, simpan `const keepType = activeConfigType` **sebelum** `resetWorkspace()`, lalu kirim ke `fetchTenants(..., keepType)`. Pindah tenant manual memanggil `selectTenant(t, activeConfigType)`.
- [ ] **Step 4:** Pastikan pesan ⚠️ tidak langsung tertimpa pesan `🌐 Target env…`, `🧩 Layanan aktif…`, atau `🔀 Domain aktif…`. Caranya bebas, misalnya pesan pindah tidak ditampilkan saat ada `missingType`, atau pesannya digabung.
- [ ] **Step 5: Verifikasi.**
  - `pnpm --filter web build` → lulus.
  - Di browser:
    - buka `APPLICANT_STABLE`, lalu pindah env → tetap `APPLICANT_STABLE`;
    - pindah ke tenant yang tidak punya tipe itu → muncul pesan ⚠️ dan `CANDIDATE_STABLE` yang terbuka.
  - Kalau browser tidak tersedia, serahkan ke user.
- [ ] **Step 6: Commit** dengan pesan `feat(web): pertahankan tipe config saat pindah tenant, env, layanan, domain`.

### Task 4: Penutup

- [ ] **4.1** `pnpm build && pnpm --filter bff test && pnpm --filter bff exec tsx --test ../web/src/studio/compareEdit.test.ts` → lulus.
- [ ] **4.2** Perbarui vault `Vaults/Jobseeker/app_tenant_config_beta/`:
  - Frontend-Studio: layar Bandingkan sekarang bisa diedit, dan config tetap saat pindah.
  - Keputusan-dan-Riwayat: ubah baris "Bandingkan antar env … hanya untuk melihat" menjadi "kedua sisi bisa diedit & disimpan (2026-11-28)". Tambah baris riwayat 2026-11-28 dengan open item: uji simpan kiri/kanan dan 409 oleh user.
