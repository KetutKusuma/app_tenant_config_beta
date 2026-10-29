# Bandingkan Antar Env, Export SQL, dan Salin Config: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat alur simpan yang ada mencadangkan isi lama sebelum menulis, lalu menambah layar Bandingkan antar env (semua config satu tenant) dengan Export SQL dan Salin ke Kanan, berikut riwayat batch-nya.

**Architecture:** Logika murni (urutan cadangkan-dulu, status banding, pembuat SQL, rencana dan orkestrasi salin) diletakkan di modul BFF tanpa koneksi DB dan diuji dengan `node:test`. Route Express tipis di `routes/compare.ts` merangkai modul itu dengan `poolFor(env)` dan `auditDb`. Di web ada satu layar overlay baru (`EnvCompareScreen`) dengan state lokal sendiri, ditambah dua dialog dan satu panel riwayat. Studio lama hanya diubah di menu Bandingkan, judul panel split, dan label History.

**Tech Stack:** Express 4 + `pg` (SQL string + `esc()`), React 18 + Vite + Tailwind, `@monaco-editor/react`, `tsx` 4.23 / Node 22.23 (`tsx --test`, tanpa dependensi baru).

**Spec:** `docs/superpowers/specs/2026-10-29-bandingkan-antar-env-export-sql-salin-design.md`. Baca bersama rencana ini; nomor bagian "§" merujuk ke spec.

## Global Constraints

- Teks UI berbahasa Indonesia.
- Satu tombol utama per header/dialog. Aksi lain ghost atau icon-only dengan `title`. Tidak ada tombol berwarna penuh lain yang mencolok.
- Aksi berbahaya memakai `TypeToConfirmDialog` dari `apps/web/src/components/ui.tsx`.
- Semua nilai di SQL wajib lewat `esc()` dari `apps/bff/src/db.ts`. Tidak ada ORM.
- Skema DB target `ats_db` **tidak diubah**. Perubahan skema hanya di Neon schema `tenant_studio`, lewat migrasi idempotent di `apps/bff/src/studioSchema.ts`.
- **Sebelum menyimpan perubahan `studioSchema.ts`, beri tahu user.** `tsx watch` langsung me-restart BFF dan menjalankan migrasi ke Neon.
- **Executor tidak boleh menulis ke DB target mana pun** (development, neondb, staging, production): tidak lewat UI, API, MCP, maupun SQL. Executor juga tidak boleh menjalankan SQL hasil export. Aturan user: AI hanya mengusulkan. Uji yang menulis ke DB dilakukan user dengan checklist di Task 13.
- Production read-only: tidak ada jalur kode yang menulis ke profil read-only (`assertWritable` tetap jadi penjaga).
- Bentuk respons API mengikuti konvensi: sukses `{ data }` atau `{ success, ... }`, gagal `{ error }` (+ `code` bila ada). Kode status yang sudah ada tidak berubah.
- Jangan menyentuh aturan validator `resolvePaths`.
- Editor Monaco memakai tema `studio-dark` (`STUDIO_THEME`, `defineStudioTheme` dari `apps/web/src/lib/monacoTheme.ts`).
- Kerjakan di branch `feat/bandingkan-antar-env`. Commit per task.

## Review Focus

1. **JSON berisi `'`, `\`, `$`, baris baru, atau unicode di Export SQL.** Literal SQL harus menghasilkan JSON yang persis sama saat dijalankan. Diuji di Task 7 (`buildExportSql menjaga isi JSON apa adanya`).
2. **Config yang hanya beda urutan key** harus berstatus Sama dengan N = 0, dan kedua panel diff menampilkan teks identik. Diuji di Task 3 (`urutan key tidak dihitung beda`, `nilai dikembalikan dalam bentuk kanonik`).
3. **DB salah satu env tidak terjangkau** (VPN development mati). Banding harus memberi error yang menyebut sisi dan env, bukan 500 kosong. Diuji di Task 3 (`loadSides menyebut sisi yang gagal`).
4. **`GLOBAL_DEFAULT` sebagai sumber atau tujuan.** Kondisi harus `tenant_id IS NULL`, nilai `tenant_id`/`group_id` = `NULL`, tidak pernah string `'GLOBAL_DEFAULT'`. Diuji di Task 4 (`tenantWhere`) dan Task 7 (`tujuan GLOBAL_DEFAULT`).
5. **Tujuan berubah antara Bandingkan dan Salin, atau tombol Salin diklik dua kali.** Salin harus batal seluruhnya (409) tanpa menulis apa pun, dan tombol nonaktif selama proses berjalan. Diuji di Task 10 (`staleConfigTypes`). Tombol nonaktif dicek di Task 12.

---

## File Structure

**BFF (`apps/bff`)**

| File | Tanggung jawab |
| :-- | :-- |
| `package.json` | script `test` |
| `src/backupFirst.ts` (baru) | `backupThenWrite`: urutan cadangkan → tulis → buang cadangan bila gagal |
| `src/presetSync.ts` | `snapshotBeforeChange` mengembalikan id; `discardSnapshot`, `discardBatchSnapshots` |
| `src/routes/configs.ts`, `src/routes/references.ts`, `src/routes/sync.ts` | tiga alur tulis memakai `backupThenWrite`; endpoint histories ikut kolom batch |
| `src/compare/types.ts` (baru) | tipe bersama banding/export/salin |
| `src/compare/compareEntries.ts` (baru) | status banding, hitung perubahan, nilai kanonik, `loadSides` |
| `src/compare/tenantRows.ts` (baru) | `tenantWhere`, `fetchTenantRows`, `fetchTenantMeta` |
| `src/compare/sqlExport.ts` (baru) | pembuat SQL, nama file, `resolveGroupId` |
| `src/compare/copyConfigs.ts` (baru) | `planCopy`, `staleConfigTypes`, `runCopy` |
| `src/compare/batches.ts` (baru) | akses tabel `config_change_batches` |
| `src/routes/compare.ts` (baru) | `GET /api/compare`, `POST /api/compare/export-sql`, `POST /api/compare/copy`, `GET /api/compare/batches[/:id]` |
| `src/studioSchema.ts` | migrasi `config_change_batches` + kolom `batch_id` |
| `src/main.ts` | daftarkan `compareRoutes` |

**Web (`apps/web/src`)**

| File | Tanggung jawab |
| :-- | :-- |
| `lib/api.ts` | header `X-Target-Env` eksplisit tidak ditimpa |
| `types.ts` | tipe banding/batch; `HistoryItem` + kolom batch |
| `studio/useEnvCompare.ts` (baru) | state layar Bandingkan (sisi, tenant per env, entri, centang) |
| `components/studio/PaneTitle.tsx` (baru) | judul panel: titik env, env, tenant, config_type |
| `components/studio/EnvCompareScreen.tsx` (baru) | layar Bandingkan penuh |
| `components/studio/ExportSqlDialog.tsx` (baru) | dialog Export SQL + form tambah tenant singkat |
| `components/studio/CopyConfigsDialog.tsx` (baru) | ringkasan Salin + popup konfirmasi |
| `components/studio/ChangeBatchesPanel.tsx` (baru) | panel Riwayat batch |
| `studio/useStudioState.ts`, `App.tsx`, `components/studio/StudioHeader.tsx` | flag `showEnvCompare`, mount, item menu |
| `components/studio/EditorArea.tsx` | judul per panel, tanpa "vs" |
| `components/studio/HistoryPanel.tsx` | label batch |

---

### Task 0: Branch dan commit dokumen

**Files:** `docs/superpowers/specs/2026-10-29-bandingkan-antar-env-export-sql-salin-design.md`, `docs/superpowers/plans/2026-10-29-bandingkan-antar-env-export-sql-salin.md`, `.gitignore` (sudah berisi `.superpowers/`)

- [ ] **Step 1:** `git switch -c feat/bandingkan-antar-env`
- [ ] **Step 2:** `git add .gitignore docs/superpowers && git commit -m "docs: spec & rencana bandingkan antar env, export SQL, salin"`

---

### Task 1: Test runner + `backupThenWrite` (§3a)

**Files:**
- Modify: `apps/bff/package.json` (scripts)
- Create: `apps/bff/src/backupFirst.ts`
- Test: `apps/bff/src/backupFirst.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BackupWriteResult<T> = { status: "written"; result: T; historyId: string } | { status: "stale" };
  export async function backupThenWrite<T>(steps: {
    backup: () => Promise<string>;               // id entri History
    write: () => Promise<T | null>;              // null = 0 baris (versi bentrok)
    discard: (historyId: string) => Promise<void>;
    onDiscardError?: (err: unknown) => void;     // default: console.error
  }): Promise<BackupWriteResult<T>>;
  ```

- [ ] **Step 1:** Tambah script di `apps/bff/package.json`: `"test": "tsx --test \"src/**/*.test.ts\""`.
- [ ] **Step 2: Tulis tes yang gagal** di `backupFirst.test.ts` (`node:test` + `node:assert/strict`). Setiap fake mencatat panggilannya ke array `calls`:
  - `backup gagal → write dan discard tidak dipanggil`: backup melempar `Error("neon down")` → `assert.rejects(..., /neon down/)`, `calls` = `["backup"]`.
  - `write null → cadangan dibuang, status stale`: backup → `"h1"`, write → `null` → hasil `{ status: "stale" }`, `calls` = `["backup", "write", "discard:h1"]`.
  - `write melempar → cadangan dibuang lalu error diteruskan`: write melempar `Error("db down")` → rejects `/db down/`, `calls` = `["backup", "write", "discard:h1"]`.
  - `sukses → tanpa discard`: write → `7` → `{ status: "written", result: 7, historyId: "h1" }`, `calls` = `["backup", "write"]`.
  - `discard gagal → onDiscardError dipanggil, hasil tetap stale`: write → `null`, discard melempar → `onDiscardError` dipanggil sekali, hasil `{ status: "stale" }`.
- [ ] **Step 3:** `cd apps/bff && pnpm test`. Harus FAIL (modul belum ada).
- [ ] **Step 4:** Implementasi `backupThenWrite` di `src/backupFirst.ts`, tanpa import DB. Kalau `discard` gagal di cabang write-throws, error asli tetap yang diteruskan.
- [ ] **Step 5:** `pnpm test`. Harus PASS 5 tes.
- [ ] **Step 6:** `git add apps/bff/package.json apps/bff/src/backupFirst* && git commit -m "feat(bff): helper backupThenWrite (cadangkan dulu, baru tulis)"`

---

### Task 2: Tiga alur tulis memakai cadangkan-dulu (§3a)

**Files:**
- Modify: `apps/bff/src/presetSync.ts` (`snapshotBeforeChange`, sekitar baris 51)
- Modify: `apps/bff/src/routes/configs.ts` (`PUT /api/configs/:configId`, sekitar baris 96–170)
- Modify: `apps/bff/src/routes/references.ts` (`sync-single`, sekitar baris 345–390)
- Modify: `apps/bff/src/routes/sync.ts` (`/api/sync/apply` cabang `if (row)` push, sekitar baris 232–265)

**Interfaces:**
- Consumes: `backupThenWrite` (Task 1).
- Produces:
  ```ts
  export async function snapshotBeforeChange(row: any, summary: string | ((version: number) => string), author: string, env: string): Promise<{ historyId: string; version: number }>;
  export async function discardSnapshot(historyId: string): Promise<void>;   // DELETE ... WHERE id = esc(historyId)
  ```

- [ ] **Step 1:** Ubah `snapshotBeforeChange`: INSERT memakai `RETURNING id` dan fungsi mengembalikan `{ historyId, version }`. Tambah `discardSnapshot`. Pemanggil di `sync.ts` baris ~283 (cabang create) tidak perlu berubah.
- [ ] **Step 2:** `PUT /api/configs/:configId`: hapus hitung versi dan INSERT history manual. Setelah cek `staleVersionError` (tetap 409 tanpa cadangan), panggil `backupThenWrite` dengan:
  - `backup` = `snapshotBeforeChange(currentConfig, changeSummary || ((v) => \`Snapshot sebelum perubahan v${v}\`), authorName, env)`
  - `write` = UPDATE yang sama seperti sekarang, mengembalikan `updRes.rows[0] ?? null`
  - `discard` = `discardSnapshot`

  Status `stale` → `409 staleVersionError("", "changed")`. Respons sukses tetap `{ success, message, version, versionToken }` dengan `version` dari hasil cadangan. Teks ringkasan default tidak berubah dari sekarang.
- [ ] **Step 3:** `sync-single`: pola yang sama. Ringkasan tetap `Synchronized from preset file: ${sourceFilename || "local file"}`. Respons tetap sama.
- [ ] **Step 4:** `sync/apply` cabang update: `backupThenWrite` dengan backup = `snapshotBeforeChange(row, \`Push dari file: ${path.basename(filePath)}\`, authorName, env)`. Status `stale` → `report("failed", "Database berubah saat proses push. Pull dulu, lalu coba lagi.")`. Backup gagal → `report("failed", "Gagal mencadangkan isi lama: " + msg)` dan DB tidak disentuh. `setPresetBase` hanya dipanggil setelah `written`.
- [ ] **Step 5:** `cd apps/bff && npx tsc --noEmit && pnpm test`. Harus lolos tanpa error.
- [ ] **Step 6:** `git commit -am "fix(bff): simpan/sync mencadangkan isi lama sebelum menulis ke DB"`

---

### Task 3: Logika status banding (§4)

**Files:**
- Create: `apps/bff/src/compare/types.ts`, `apps/bff/src/compare/compareEntries.ts`
- Test: `apps/bff/src/compare/compareEntries.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export interface ConfigRow { id: string; tenant_id: string | null; group_id: string | null; config_type: string; path: string | null; value: any; is_default: boolean; version_token: string }
  export type CompareStatus = "sama" | "beda" | "hanya_kiri" | "hanya_kanan" | "ganda";
  export interface CompareEntry { configType: string; status: CompareStatus; changeCount: number; left: ConfigRow | null; right: ConfigRow | null }
  export interface CompareSummary { total: number; sama: number; beda: number; hanyaKiri: number; hanyaKanan: number; ganda: number }
  export type Side = "kiri" | "kanan";
  ```
- Produces (`compareEntries.ts`):
  ```ts
  export function countJsonChanges(a: any, b: any): number;   // jumlah path daun yang ditambah/dihapus/diubah; array dibandingkan per indeks
  export function buildCompareEntries(left: ConfigRow[], right: ConfigRow[]): { entries: CompareEntry[]; summary: CompareSummary };
  export async function loadSides<T>(left: () => Promise<T>, right: () => Promise<T>, envLabels: { kiri: string; kanan: string }):
    Promise<{ ok: true; left: T; right: T } | { ok: false; side: Side; error: string }>;
  ```
  Aturan:
  - `value` di `left`/`right` hasil dikembalikan dalam bentuk `canonicalize()` (dari `presetSync.ts`).
  - Status `ganda` bila salah satu sisi punya >1 baris untuk config_type itu; `left`/`right` = baris pertama sisi masing-masing, `changeCount` = 0.
  - Urutan: beda, hanya_kiri, hanya_kanan, ganda, sama; di dalam kelompok A→Z.
  - Pesan error `loadSides`: `` `Env ${label} (${side}) tidak terjangkau: ${err.message}` ``.

- [ ] **Step 1: Tulis tes yang gagal:**
  - `urutan key tidak dihitung beda`: kiri `{a:1,b:{c:2,d:3}}`, kanan `{b:{d:3,c:2},a:1}` → status `"sama"`, `changeCount` 0.
  - `beda dihitung per path daun`: `{a:1,b:{c:2}}` vs `{a:1,b:{c:3},d:4}` → `changeCount` 2.
  - `array per indeks`: `countJsonChanges([1,2,3],[1,3])` → 2.
  - `hanya satu sisi`: tipe `X` hanya di kiri → `hanya_kiri`, `right` null; tipe `Y` hanya di kanan → `hanya_kanan`.
  - `ganda`: kiri punya 2 baris `Z` → status `"ganda"`, `summary.ganda` 1.
  - `urutan hasil`: input campuran → urutan status sesuai aturan, A→Z di tiap kelompok.
  - `nilai dikembalikan dalam bentuk kanonik`: `Object.keys(entries[0].left!.value)` = `["a","b"]` untuk input `{b:1,a:2}`.
  - `summary`: total dan per status cocok.
  - `loadSides menyebut sisi yang gagal`: right melempar `Error("ECONNREFUSED")`, labels `{kiri:"Development",kanan:"Staging"}` → `{ ok:false, side:"kanan", error:"Env Staging (kanan) tidak terjangkau: ECONNREFUSED" }`.
- [ ] **Step 2:** `pnpm test`. Harus FAIL.
- [ ] **Step 3:** Implementasi. `loadSides` menjalankan kedua fungsi paralel; kalau keduanya gagal, sisi kiri yang dilaporkan.
- [ ] **Step 4:** `pnpm test`. Harus PASS.
- [ ] **Step 5:** `git add apps/bff/src/compare && git commit -m "feat(bff): logika status banding antar env"`

---

### Task 4: Endpoint `GET /api/compare` (§4)

**Files:**
- Create: `apps/bff/src/compare/tenantRows.ts`, `apps/bff/src/routes/compare.ts`
- Test: `apps/bff/src/compare/tenantRows.test.ts`
- Modify: `apps/bff/src/main.ts` (import + `app.use(compareRoutes)` setelah `syncRoutes`)

**Interfaces:**
- Consumes: `buildCompareEntries`, `loadSides` (Task 3); `poolFor`, `listProfiles`, `baseTenantCode` (`envs.ts`); `domainOf`, `DomainSpec` (`domain.ts`).
- Produces:
  ```ts
  export function tenantWhere(tenantId: string): string;   // "GLOBAL_DEFAULT" → "tenant_id IS NULL", lainnya → `tenant_id = ${esc(id)}`
  export async function fetchTenantRows(pool: Pool, D: DomainSpec, tenantId: string, configTypes?: string[]): Promise<ConfigRow[]>;
  //   SELECT id, tenant_id, group_id, ${D.typeCol} AS config_type, ${D.pathSel}, value, is_default, updated_at::text AS version_token
  //   WHERE tenantWhere AND deleted_at IS NULL [AND typeCol IN (...)]
  export async function fetchTenantMeta(env: string, tenantId: string): Promise<{ tenantId: string; groupId: string | null; name: string; code: string; baseCode: string } | null>;
  //   dari tenant_studio.tenant_metadata (target_env, tenant_id); baseCode via baseTenantCode(code, suffix env)
  export function findProfile(name: string): TargetEnvProfile | undefined;   // dari listProfiles().profiles
  ```
- API:
  - `GET /api/compare?leftEnv=&leftTenant=&rightEnv=&rightTenant=` (domain dari header `X-Config-Domain`).
  - 200 → `{ data: { entries: CompareEntry[], summary: CompareSummary } }`
  - 400 → `{ error }` bila parameter kurang atau env tidak dikenal
  - 502 → `{ error, side }` dari `loadSides`

- [ ] **Step 1: Tulis tes yang gagal** `tenantRows.test.ts`: `tenantWhere("GLOBAL_DEFAULT")` = `"tenant_id IS NULL"`; `tenantWhere("019f-a")` = `"tenant_id = '019f-a'"`; `tenantWhere("a'b")` = `"tenant_id = 'a''b'"`.
- [ ] **Step 2:** `pnpm test`. Harus FAIL.
- [ ] **Step 3:** Implementasi `tenantRows.ts`, lalu route di `routes/compare.ts`. Route ini tidak memakai `req.targetDb`; setiap sisi memakai `poolFor(env)`.
- [ ] **Step 4:** `pnpm test && npx tsc --noEmit`. Harus PASS. Jangan memanggil endpoint ke DB dari sini; uji baca dilakukan lewat UI di Task 13.
- [ ] **Step 5:** `git add -A apps/bff && git commit -m "feat(bff): endpoint banding antar env"`

---

### Task 5: Layar Bandingkan di web (§4)

**Files:**
- Modify: `apps/web/src/lib/api.ts`. Ganti `if (activeTargetEnv) headers["X-Target-Env"] = activeTargetEnv;` dengan versi yang tidak menimpa header `X-Target-Env` yang sudah diisi pemanggil.
- Modify: `apps/web/src/types.ts`. Salin tipe `ConfigRow`, `CompareStatus`, `CompareEntry`, `CompareSummary` dari Task 3, ditambah `CompareSide`.
- Create: `apps/web/src/studio/useEnvCompare.ts`, `apps/web/src/components/studio/PaneTitle.tsx`, `apps/web/src/components/studio/EnvCompareScreen.tsx`
- Modify: `useStudioState.ts` (`showEnvCompare`, `setShowEnvCompare`, ekspor di objek state), `App.tsx` (mount `<EnvCompareScreen />` setelah `<CompareTenantModal />`), `StudioHeader.tsx` (item menu)

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface CompareSide { env: string; tenantId: string }
  // PaneTitle.tsx
  export function PaneTitle(props: { envLabel: string; envColor: string; tenantName?: string; tenantCode?: string; configType?: string; icon?: ReactNode; muted?: string }): JSX.Element;
  // useEnvCompare.ts
  export function useEnvCompare(): {
    left: CompareSide; right: CompareSide; setLeft(s: CompareSide): void; setRight(s: CompareSide): void; swap(): void;
    tenantsFor(env: string): Tenant[];  loadTenants(env: string): Promise<Tenant[]>;
    entries: CompareEntry[]; summary: CompareSummary | null; loading: boolean; error: { message: string; side?: "kiri" | "kanan" } | null; reload(): Promise<void>;
    selectedType: string | null; setSelectedType(t: string | null): void;
    checked: Set<string>; toggleChecked(t: string): void; checkDifferent(): void;   // centang semua beda + hanya_kiri
    query: string; setQuery(q: string): void; visibleEntries: CompareEntry[];
  };
  ```
- Aturan default saat layar dibuka (§4):
  - Kiri = env aktif + tenant aktif.
  - Kanan = `staging` bila ada dan ≠ env kiri; selain itu profil lain pertama (A→Z); kalau tidak ada, env yang sama.
  - Tenant kanan = tenant dengan `baseCode` sama; kalau tidak ada, `tenantId` kosong (daftar tidak dimuat).
- Tenant per env: `api("/api/tenants", { headers: { "X-Target-Env": env } })`.
- Baris `ganda` tidak bisa dicentang; `checkDifferent` melewatinya.

- [ ] **Step 1:** Ubah `api.ts`, `types.ts`, `useStudioState.ts`.
- [ ] **Step 2:** Buat `useEnvCompare.ts`. Ambil `targetEnvs`, `targetEnvName`, `selectedTenant`, `configDomain` dari `useStudio()`. Panggil `reload` setiap kiri, kanan, atau domain berubah dan kedua tenant terisi.
- [ ] **Step 3:** Buat `PaneTitle.tsx`. Warna titik memakai `ENV_DOT[envColor]` dari `types.ts`. Teks di-`truncate`, detail lengkap di `title`.
- [ ] **Step 4:** Buat `EnvCompareScreen.tsx` sebagai overlay `fixed inset-0 z-40`, mengikuti mockup opsi A.
  - **Bar atas:**
    - "Kiri" [env ▾][tenant ▾] ⇄ "Kanan" [env ▾][tenant ▾].
    - Ringkasan `"{total} config · {sama} sama · {beda} beda · {hanyaKiri+hanyaKanan} hanya satu sisi"`.
    - Slot tombol yang diisi di Task 12 (`Salin ke Kanan…`, `Export SQL (n)`) dan Task 13 (`Riwayat`), lalu ✕.
  - **Kolom daftar (lebar ±290px):**
    - Kotak cari, "{n} dipilih", ghost "Pilih yang beda".
    - Tiap baris: centang, config_type (mono), chip status: `Sama` / `Beda · N` / `Hanya Kiri` / `Hanya Kanan` / `Ganda`. Chip `Ganda` berwarna peringatan dan punya `title` "Ada lebih dari 1 config aktif bertipe ini; bereskan dulu".
  - **Diff:**
    - Dua `PaneTitle` dalam `grid grid-cols-2` di atas `DiffEditor` (`readOnly: true`, `originalEditable: false`, `renderSideBySide: true`, `useInlineViewWhenSpaceIsLimited: false`, `hideUnchangedRegions` seperti `EditorArea`).
    - Teks = `JSON.stringify(value, null, 2)`, atau `""` dengan `muted` "(tidak ada di kiri/kanan)".
    - Header kecil `"{N} perubahan"` memakai `changeCount` dari server, plus ↑/↓ `goToDiff`.
  - **Error:** tampilkan `error.message` di sisi yang gagal; sisi lain tetap bisa dipilih.
  - **Esc** menutup layar.
- [ ] **Step 5:** Tambah item menu di `StudioHeader.tsx` setelah item `tenant`: `{ key: "env", label: "Antar env / semua config…", hint: "Satu tenant di dua env, semua config", icon: <Layers .../>, onSelect: () => setShowEnvCompare(true) }`. Lima item lama tidak berubah.
- [ ] **Step 6:** `pnpm --filter web build`. Harus lolos tanpa error TypeScript.
- [ ] **Step 7:** `git add -A apps/web && git commit -m "feat(web): layar Bandingkan antar env"`

---

### Task 6: Judul per panel di split editor, tanpa "vs" (§8)

**Files:** Modify `apps/web/src/components/studio/EditorArea.tsx` (bar Visual Diff sekitar baris 74–110, header Side-by-Side, header JSON Delta)

**Interfaces:** Consumes `PaneTitle` (Task 5).

- [ ] **Step 1:** Di Visual Diff, ganti blok "Kiri vs Kanan" dengan `grid grid-cols-2` berisi dua `PaneTitle`. Tombol aksi yang ada tetap di bar yang sama, di sisi kanan. Pasang `renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false` di `DiffEditor` supaya judul selalu sejajar dengan sisinya.
  - **Kiri sesuai `splitSourceType`:**
    - `tenant`: env aktif · `compareTenant` · `compareConfigType`.
    - `preset`: ikon FolderOpen, "Preset Lokal", `splitTitle`.
    - `db`: ikon Database, "Database terbaru".
    - `history`: ikon History, `splitTitle`.
  - **Kanan:** env aktif · `selectedTenant` · `activeConfigType` dengan `muted` "Editor".
- [ ] **Step 2:** Samakan header Side-by-Side dan JSON Delta dengan pola yang sama. Cari dan hapus setiap teks `vs` yang tampil di UI split (`grep -n '>vs<\|"vs"\| vs ' EditorArea.tsx`). Pesan status di `useCompareActions.ts:92` (`... vs ...`) diganti `"⇄ Split aktif: kiri {A}, kanan {B} ({type})"`.
- [ ] **Step 3:** `pnpm --filter web build`. Harus lolos.
- [ ] **Step 4:** `git commit -am "feat(web): judul per panel di split editor, hapus label vs"`

---

### Task 7: Pembuat SQL export (§5)

**Files:**
- Create: `apps/bff/src/compare/sqlExport.ts`
- Test: `apps/bff/src/compare/sqlExport.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ExportTable { table: string; typeCol: string; hasPath: boolean }   // subset DomainSpec
  export interface ExportItem { configType: string; path: string | null; value: any; isDefault: boolean }
  export interface ExportSqlInput {
    domain: ExportTable; mode: "timpa" | "lewati";
    source: { env: string; tenantCode: string };
    target: { env: string; tenantId: string | null; groupId: string | null; tenantCode: string };   // tenantId null = GLOBAL_DEFAULT
    author: string; createdAt: Date; items: ExportItem[];
  }
  export function buildExportSql(input: ExportSqlInput): string;
  export function exportFileName(tenantCode: string, table: string, date: Date): string;   // "IDM_PROD_tenant_configurations_2026-10-29.sql" (tanggal lokal, tanpa "public.")
  export function resolveGroupId(tenantId: string | null, groupId: string | null | undefined): string | null;   // null tenant → null; kosong → tenantId
  export function defaultPath(configType: string): string;   // lowercase, "_" → "-"
  ```
- Header SQL, persis (`·` = U+00B7):
  ```
  -- Tenant Studio · Export SQL
  -- Catatan : dibuat oleh Tenant Studio dan TIDAK dijalankan otomatis. Periksa sebelum menjalankan.
  -- Tabel   : {table}
  -- Sumber  : {source.env} · {source.tenantCode}
  -- Tujuan  : {target.env} · {target.tenantCode} · tenant_id {tenantId|NULL} · group_id {groupId|NULL}
  -- Dibuat  : {YYYY-MM-DD HH:mm lokal} oleh {author} · {n} config · jika sudah ada: {timpa|lewati}
  ```
  Lalu baris kosong, `BEGIN;`, blok per item (`-- [i/n] {configType}` + statement dari §5, dipisah baris kosong), lalu `COMMIT;` diakhiri `\n`. Semua nilai lewat `esc()`, JSON sebagai `esc(JSON.stringify(value)) + "::jsonb"`. Kondisi tenant memakai `tenantWhere` (Task 4) atau versi setara untuk `tenantId` null. Kolom `path` hanya bila `hasPath`, berisi `item.path || defaultPath(configType)`. `is_default` dari item. `id` = `gen_random_uuid()`.

- [ ] **Step 1: Tulis tes yang gagal:**
  - `header dan pembungkus`: baris pertama `-- Tenant Studio · Export SQL`; memuat `-- Sumber  : development · IDM`; memuat `BEGIN;`; diakhiri `COMMIT;\n`.
  - `mode timpa`: 2 item → dua `-- [1/2]` / `-- [2/2]`, masing-masing `UPDATE public.tenant_configurations` dan `WHERE NOT EXISTS`.
  - `mode lewati`: tidak memuat `UPDATE`.
  - `tujuan GLOBAL_DEFAULT`: `tenantId: null` → memuat `tenant_id IS NULL`, tidak memuat `GLOBAL_DEFAULT` di luar header, nilai `NULL, NULL` untuk tenant_id/group_id.
  - `domain workflow`: tabel `public.pipeline_workflow_configurations`, kolom `workflow_config_type`, tidak memuat `path`.
  - `path cadangan`: `path: null`, tipe `CANDIDATE_STABLE` → memuat `'candidate-stable'`.
  - `buildExportSql menjaga isi JSON apa adanya`: `value = { note: "it's \\ $x\n", emoji: "✓" }` → SQL memuat `"'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb"`.
  - `resolveGroupId`: `("t", "")` → `"t"`; `("t", null)` → `"t"`; `(null, "g")` → `null`; `("t", "g")` → `"g"`.
  - `exportFileName`: `("IDM_PROD", "public.tenant_configurations", new Date(2026, 9, 29, 10, 0))` → `"IDM_PROD_tenant_configurations_2026-10-29.sql"`.
- [ ] **Step 2:** `pnpm test`. Harus FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** `pnpm test`. Harus PASS.
- [ ] **Step 5:** `git add apps/bff/src/compare/sqlExport* && git commit -m "feat(bff): pembuat SQL export yang aman dijalankan ulang"`

---

### Task 8: Skema batch + akses data batch (§7)

**Files:**
- Modify: `apps/bff/src/studioSchema.ts`. Tambah `migrateChangeBatches()` dan rangkai di `initStudioSchema` setelah `migrateTargetEnvColumns()`.
- Modify: `apps/bff/src/presetSync.ts`. `snapshotBeforeChange` menerima `batchId: string | null = null` (kolom `batch_id` di INSERT). Tambah `discardBatchSnapshots(batchId)`.
- Create: `apps/bff/src/compare/batches.ts`

**Interfaces:**
- Migrasi (idempotent):
  - `CREATE TABLE IF NOT EXISTS tenant_studio.config_change_batches (...)` dengan kolom persis seperti tabel di §7. `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `config_types text[] NOT NULL DEFAULT '{}'`, `counts jsonb`, `before_snapshot jsonb`, `created_at timestamptz NOT NULL DEFAULT now()`, `finished_at timestamptz`.
  - `CREATE INDEX IF NOT EXISTS config_change_batches_target_idx ON tenant_studio.config_change_batches (target_env, target_tenant_id, created_at DESC)`.
  - `ALTER TABLE tenant_studio.tenant_config_histories ADD COLUMN IF NOT EXISTS batch_id uuid`.
  - `CREATE INDEX IF NOT EXISTS tenant_config_histories_batch_idx ON tenant_studio.tenant_config_histories (batch_id)`.
- Produces (`batches.ts`):
  ```ts
  export type BatchKind = "salin" | "export_sql";
  export type BatchStatus = "menunggu" | "berhasil" | "gagal" | "diekspor";
  export interface NewBatch { kind: BatchKind; domain: string; sourceEnv: string; sourceTenantId: string; sourceTenantCode: string;
    targetEnv: string; targetTenantId: string; targetGroupId: string | null; targetTenantCode: string; mode: "timpa" | "lewati";
    configTypes: string[]; counts: Record<string, number>; status: BatchStatus; author: string; sqlText?: string; beforeSnapshot?: any | null }
  export async function createBatch(b: NewBatch): Promise<string>;
  export async function finishBatch(id: string, status: "berhasil" | "gagal", error?: string): Promise<void>;   // + finished_at = now()
  export interface BatchFilter { sourceEnv?: string; sourceTenantId?: string; targetEnv?: string; targetTenantId?: string; limit?: number }   // limit default 50, maks 200
  export async function listBatches(f: BatchFilter): Promise<any[]>;   // tanpa sql_text & before_snapshot
  export async function getBatch(id: string): Promise<any | null>;
  ```

- [ ] **Step 1:** **Beri tahu user** bahwa migrasi Neon akan berjalan saat file disimpan, dan tunggu konfirmasi.
- [ ] **Step 2:** Tulis migrasi + perubahan `presetSync.ts` + `batches.ts`.
- [ ] **Step 3:** `npx tsc --noEmit && pnpm test`. Harus lolos. Setelah BFF restart, cek log tidak berisi "Gagal menyiapkan tabel studio".
- [ ] **Step 4:** Verifikasi baca saja (boleh, Neon audit): `SELECT column_name FROM information_schema.columns WHERE table_schema='tenant_studio' AND table_name IN ('config_change_batches','tenant_config_histories') AND column_name IN ('id','batch_id','before_snapshot')` harus mengembalikan 3 baris. Jalankan di DB audit yang sama dengan `AUDIT_DB_URL`, yaitu Neon `ats_db`, schema `tenant_studio`.
- [ ] **Step 5:** `git commit -am "feat(bff): tabel config_change_batches + kolom batch_id"` (sertakan `batches.ts` dengan `git add`)

---

### Task 9: Endpoint Export SQL (§5, §7)

**Files:** Modify `apps/bff/src/routes/compare.ts`

**Interfaces:**
- Consumes: `fetchTenantRows`, `fetchTenantMeta`, `findProfile` (Task 4); `buildExportSql`, `exportFileName`, `resolveGroupId` (Task 7); `createBatch` (Task 8); `actorName` (`auth.ts`).
- API `POST /api/compare/export-sql`:
  - **Body:**
    ```ts
    { sourceEnv: string; sourceTenantId: string; configTypes: string[]; mode: "timpa" | "lewati";
      target: { kind: "profile"; env: string; tenantId: string } | { kind: "manual"; tenantId: string; groupId?: string } }
    ```
  - **200:** `{ data: { sql: string; fileName: string; batchId: string; beforeSnapshot: "tersimpan" | "tidak_tersedia"; warning: string | null } }`
  - **400 (`{ error }`):**
    - `configTypes` kosong.
    - Tipe tidak ada di sumber atau berstatus ganda di sumber. Pesan menyebut nama tipenya.
    - `manual.tenantId` bukan UUID (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) dan bukan `GLOBAL_DEFAULT`.
    - Tenant tujuan profil tidak terdaftar.
  - **Aturan:**
    - Isi sumber dibaca ulang saat request.
    - Tujuan `profile`: `group_id` dan kode dari `fetchTenantMeta`; `groupId` = `resolveGroupId(...)`.
    - Tujuan `manual`: `target_env` batch = `"production-manual"`, kode = `baseCode sumber + "_PROD"`, `env` di header SQL = `"production"`.
    - `before_snapshot`: bila tujuan `profile`, baca baris tujuan untuk tipe-tipe itu (`{ [type]: { id, value, updated_at } | null }`). Bila gagal atau tujuan `manual` tanpa profil `production`, simpan `null` dan isi `warning` = `"Isi lama di tujuan tidak bisa dicadangkan otomatis."`. Kalau profil bernama `production` ada, tujuan manual tetap mencoba membacanya.
    - Batch: `kind "export_sql"`, `status "diekspor"`, `counts { total: n }`, `sqlText`.
    - **Tidak ada tulis ke DB target mana pun.**

- [ ] **Step 1:** Implementasi route. Validasi body dalam fungsi murni `parseExportBody(body): { ok: true, value } | { ok: false, error }` di file yang sama, dan diekspor.
- [ ] **Step 2: Tulis tes** `routes/compare.test.ts` untuk `parseExportBody`: `configTypes` kosong → error; `manual.tenantId "abc"` → error menyebut "UUID"; `manual.tenantId "GLOBAL_DEFAULT"` → ok; body valid profil → ok.
- [ ] **Step 3:** `pnpm test && npx tsc --noEmit`. Harus PASS.
- [ ] **Step 4:** `git commit -am "feat(bff): endpoint export SQL + catat batch"` (sertakan file tes)

---

### Task 10: Rencana dan orkestrasi Salin (§6)

**Files:**
- Create: `apps/bff/src/compare/copyConfigs.ts`
- Test: `apps/bff/src/compare/copyConfigs.test.ts`

**Interfaces:**
- Consumes: `CompareEntry`, `ConfigRow` (Task 3).
- Produces:
  ```ts
  export interface CopyPlan { create: ConfigRow[]; overwrite: Array<{ source: ConfigRow; target: ConfigRow }>; same: string[]; targetOnly: string[]; duplicates: string[] }
  export function planCopy(entries: CompareEntry[]): CopyPlan;   // hanya_kiri→create(left), beda→overwrite, sama→same, hanya_kanan→targetOnly, ganda→duplicates
  export function staleConfigTypes(plan: CopyPlan, expected: Record<string, string | null>, currentTarget: ConfigRow[]): string[];
  //   untuk setiap tipe di create+overwrite: token tujuan sekarang (atau null) ≠ expected[tipe] (undefined dianggap null) → stale; hasil A→Z
  export interface CopyDeps {
    createBatch(): Promise<string>;
    backupOld(target: ConfigRow, batchId: string): Promise<void>;
    discardBatchBackups(batchId: string): Promise<void>;
    writeTarget(plan: CopyPlan): Promise<ConfigRow[]>;         // satu transaksi; mengembalikan baris yang baru dibuat
    recordCreated(row: ConfigRow, batchId: string): Promise<void>;
    finishBatch(batchId: string, status: "berhasil" | "gagal", error?: string): Promise<void>;
  }
  export async function runCopy(plan: CopyPlan, deps: CopyDeps): Promise<{ batchId: string; warnings: string[] }>;
  ```
  Urutan `runCopy`:
  1. `createBatch`.
  2. `backupOld` untuk setiap `overwrite` secara berurutan. Kalau ada yang gagal: `discardBatchBackups`, `finishBatch("gagal", msg)`, lalu lempar error. `writeTarget` tidak dipanggil.
  3. `writeTarget`. Kalau gagal: `discardBatchBackups`, `finishBatch("gagal", msg)`, lalu lempar error.
  4. `recordCreated` per baris baru. Kalau gagal, catat ke `warnings` dengan teks `` `Versi 1 ${type} tidak tercatat di History: ${msg}` ``.
  5. `finishBatch("berhasil")`.

  Kegagalan `discardBatchBackups` atau `finishBatch` di jalur gagal hanya di-`console.error`; error asli tetap yang dilempar.

- [ ] **Step 1: Tulis tes yang gagal** (fake mencatat ke `calls`):
  - `planCopy membagi per status`.
  - `staleConfigTypes`: plan create `B`, overwrite `A`; expected `{A:"t1", B:null}`; tujuan sekarang `A` token `t2`, `B` ada → `["A","B"]`. Tipe di `same`/`targetOnly` diabaikan.
  - `runCopy sukses`: `calls` = `["createBatch","backup:A","write","recorded:B","finish:berhasil"]`.
  - `backup gagal → tujuan tidak ditulis`: `calls` = `["createBatch","backup:A","discard","finish:gagal"]`, rejects.
  - `write gagal → cadangan dibuang`: `calls` diakhiri `["write","discard","finish:gagal"]`, rejects.
  - `recordCreated gagal → warning, tetap berhasil`: `warnings.length` 1, `calls` diakhiri `"finish:berhasil"`.
- [ ] **Step 2:** `pnpm test`. Harus FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** `pnpm test`. Harus PASS.
- [ ] **Step 5:** `git add apps/bff/src/compare/copyConfigs* && git commit -m "feat(bff): rencana & orkestrasi salin config (cadangkan dulu)"`

---

### Task 11: Endpoint Salin + Riwayat + label History (§6, §7)

**Files:** Modify `apps/bff/src/routes/compare.ts`, `apps/bff/src/routes/configs.ts` (histories, sekitar baris 252)

**Interfaces:**
- Consumes: Task 4, 7 (`resolveGroupId`, `defaultPath`), 8, 10; `assertWritable` (`envs.ts`); `snapshotBeforeChange`, `discardBatchSnapshots` (`presetSync.ts`).
- API `POST /api/compare/copy`:
  - **Header:** `X-Target-Env` = env kanan; `X-Confirm-Env` bila env dilindungi. `assertWritable` dicek paling awal.
  - **Body:** `{ sourceEnv, sourceTenantId, targetTenantId, expectedTargetVersions: Record<string, string | null> }`
  - **200:** `{ data: { batchId, created: string[], overwritten: string[], skipped: { same: string[], targetOnly: string[], duplicates: string[] }, warnings: string[] } }`
  - **400:** sumber = tujuan (env dan tenant sama), tenant tujuan tidak terdaftar, atau tidak ada yang perlu disalin.
  - **409:** `{ code: "TARGET_CHANGED", error: "Config di tujuan berubah sejak dibandingkan. Muat ulang perbandingan.", configTypes }`. Tidak ada batch yang dibuat.
  - **500:** `{ error, batchId }`.
  - **Wiring `CopyDeps`:**
    - `backupOld` = `snapshotBeforeChange(target, "Sebelum disalin dari {sourceEnv} · {kodeSumber}", author, targetEnv, batchId)`.
    - `discardBatchBackups` = `discardBatchSnapshots`.
    - `writeTarget`: `const client = await req.targetDb!.connect()`, lalu `BEGIN`.
      - Untuk overwrite: `UPDATE ... SET value, [path,] updated_at = NOW() WHERE id = target.id AND updated_at::text = target.version_token`. Bila 0 baris → `throw` (rollback).
      - Untuk create: INSERT dengan `randomUUID()`, `tenant_id` tujuan (NULL untuk GLOBAL_DEFAULT), `group_id` = `resolveGroupId`, `path` sumber atau `defaultPath`, `is_default` sumber.
      - `COMMIT`, atau `ROLLBACK` saat error. `client.release()` di `finally`.
    - `recordCreated` = `snapshotBeforeChange(newRow, "Disalin dari {sourceEnv} · {kodeSumber}", author, targetEnv, batchId)`.
    - Batch: `kind "salin"`, `mode "timpa"`, `status "menunggu"`, `counts { dibuat, ditimpa, sama, hanyaTujuan, ganda }`.
- API Riwayat:
  - `GET /api/compare/batches?sourceEnv&sourceTenantId&targetEnv&targetTenantId&limit` → `{ data }`
  - `GET /api/compare/batches/:id` → `{ data }` atau 404
- Histories: `GET /api/configs/:configId/histories` menambah kolom `batch_id`, `batch_kind`, `batch_source_env`, `batch_source_tenant_code` lewat `LEFT JOIN tenant_studio.config_change_batches b ON b.id = h.batch_id`.

- [ ] **Step 1:** Implementasi route Salin, route batches, dan perubahan histories.
- [ ] **Step 2:** `npx tsc --noEmit && pnpm test`. Harus lolos.
- [ ] **Step 3:** `git commit -am "feat(bff): endpoint salin ke kanan, riwayat batch, label batch di history"`

---

### Task 12: Dialog Export SQL dan Salin di web (§5, §6)

**Files:**
- Create: `apps/web/src/components/studio/ExportSqlDialog.tsx`, `apps/web/src/components/studio/CopyConfigsDialog.tsx`
- Modify: `EnvCompareScreen.tsx` (tombol `Export SQL (n)` utama, nonaktif bila n = 0; `Salin ke Kanan…` ghost); `types.ts` (tipe respons export/copy)

**Interfaces:**
- Consumes: `useEnvCompare` (Task 5); API Task 9 dan Task 11; `TypeToConfirmDialog`; `api(url, init, confirmEnv)`.
- Produces:
  ```ts
  export function ExportSqlDialog(props: { left: CompareSide; right: CompareSide; checkedTypes: string[]; tenantsFor(env: string): Tenant[]; loadTenants(env: string): Promise<Tenant[]>; onClose(): void }): JSX.Element;
  export function CopyConfigsDialog(props: { left: CompareSide; right: CompareSide; entries: CompareEntry[]; onClose(): void; onDone(): void }): JSX.Element;
  ```
- **ExportSqlDialog** (mockup bagian 2):
  - **Isian:**
    - Env tujuan: semua profil + `"Production (isi manual)"`.
    - Tenant tujuan untuk profil (+ ghost "+ Tambah tenant baru di {label}" yang membuka form singkat 4 isian: tenant_id, group_id, nama klien, kode → `POST /api/tenants` dengan header `X-Target-Env`, lalu muat ulang tenant dan pilih tenant baru).
    - Isian `tenant_id` + `group_id` (placeholder "kosong = sama dengan tenant_id") untuk manual.
    - Segmen Timpa/Lewati (default Timpa).
    - Segmen Sumber Kiri/Kanan (default Kiri). `sourceEnv`/`sourceTenantId` di body = sisi yang dipilih.
    - Teks "SQL aman dijalankan ulang: tidak membuat baris ganda."
  - **Buat SQL:** tombol ghost "Buat SQL" → `POST /api/compare/export-sql`.
  - **Hasil:** pratinjau `Editor` Monaco (`language "sql"`, `readOnly`), judul = `fileName`. Tombol utama "Unduh .sql" (Blob + `a[download]`), ghost "Salin" (`navigator.clipboard.writeText`).
  - **Peringatan:** `warning` ditampilkan sebagai peringatan kuning. Bila `beforeSnapshot === "tersimpan"`, tampilkan catatan "Isi tujuan saat ini sudah dicatat di Riwayat (kondisi saat export, bukan saat SQL dijalankan)."
- **CopyConfigsDialog** (mockup bagian 3 + popup):
  - **Ringkasan:**
    - Hitung dari `entries` dengan aturan `planCopy`.
    - Tampilkan arah `{envKiri} · {tenantKiri} → {envKanan} · {tenantKanan}`.
    - Empat angka: dibuat baru, ditimpa, sama · dilewati, hanya di {envKanan} · dibiarkan, plus jumlah ganda bila > 0. Daftar nama per kelompok bisa dibuka.
    - Kalimat "Isi lama setiap config yang ditimpa disimpan ke History {envKanan} sebelum ditulis. Config yang hanya ada di {envKanan} tidak dihapus."
  - **Env kanan read-only:** tanpa tombol Salin, teks "Production hanya bisa diubah lewat Export SQL."
  - **Tombol utama** "Salin {N} config" (N = dibuat + ditimpa), nonaktif bila N = 0.
  - **Popup konfirmasi:**
    - Klik tombol utama → `TypeToConfirmDialog` dengan:
      - `title`: "Tulis {N} config ke {envKanan} · {tenantKanan}"
      - `description`: "{ditimpa} config yang sudah ada akan ditimpa. Isi lamanya dicadangkan ke History lebih dulu."
      - `expected`: kode tenant kanan
      - `confirmLabel`: "Salin sekarang"
    - Konfirmasi → `api("/api/compare/copy", { method: "POST", headers: { "Content-Type": "application/json", "X-Target-Env": right.env }, body }, envKanan.protected ? right.env : undefined)`. `expectedTargetVersions` = `{ [configType]: entry.right?.version_token ?? null }` untuk semua entri.
  - **Selama request:** semua tombol nonaktif dan berlabel "Menyalin…".
  - **Hasil:**
    - 409 `TARGET_CHANGED` → pesan + daftar tipe + tombol ghost "Muat ulang perbandingan" (`onDone`).
    - Sukses → `setStatusMessage("✅ Salin selesai: {created} dibuat, {overwritten} ditimpa")`, warnings ditampilkan bila ada, lalu `onDone()` yang memanggil `reload()`.

- [ ] **Step 1:** Buat kedua dialog dan sambungkan ke `EnvCompareScreen`.
- [ ] **Step 2:** `pnpm --filter web build`. Harus lolos.
- [ ] **Step 3:** `git add -A apps/web && git commit -m "feat(web): dialog Export SQL dan Salin ke Kanan"`

---

### Task 13: Panel Riwayat, label History, verifikasi akhir, catatan vault (§7)

**Files:**
- Create: `apps/web/src/components/studio/ChangeBatchesPanel.tsx`
- Modify: `EnvCompareScreen.tsx` (tombol ghost "Riwayat"), `HistoryPanel.tsx` (label), `types.ts` (`HistoryItem` + `batch_id?`, `batch_kind?`, `batch_source_env?`, `batch_source_tenant_code?`; tipe `ChangeBatch`)
- Modify (di luar repo, vault Obsidian `/Users/ketutkusuma/Vaults/Jobseeker/app_tenant_config_beta/`): `BFF-API.md`, `Database.md`, `Frontend-Studio.md`, `Keputusan-dan-Riwayat.md`

**Interfaces:** Consumes API Riwayat (Task 11), `exportFileName` aturan nama dari Task 7 (ditiru di web untuk unduh ulang).

- [ ] **Step 1:** `ChangeBatchesPanel` sebagai drawer kanan di dalam `EnvCompareScreen`.
  - Isi daftar: waktu, jenis (Salin/Export SQL), `sumber → tujuan`, angka, status (chip), pembuat.
  - Filter "Pasangan ini" (default, memakai env + tenant kiri/kanan) atau "Semua".
  - Batch export punya aksi ghost "Unduh SQL lagi" dan "Unduh isi lama (.json)". Aksi kedua nonaktif dengan `title` "Isi lama tidak tersedia" bila `before_snapshot` null. Keduanya memakai `GET /api/compare/batches/:id`.
- [ ] **Step 2:** `HistoryPanel`: bila `h.batch_id`, tampilkan chip kecil `Salin · {batch_source_env} · {batch_source_tenant_code}`.
- [ ] **Step 3:** `pnpm --filter web build && cd apps/bff && pnpm test && npx tsc --noEmit`. Semua harus lolos.
- [ ] **Step 4:** Verifikasi baca oleh executor (tanpa tulis ke DB target). Jalankan `pnpm dev` milik user (atau minta user), lalu cek lewat UI:
  - Bandingkan Development ↔ Staging untuk tenant yang ada di keduanya.
  - Bandingkan neondb ↔ development dengan env yang sama di dua sisi.
  - Daftar, status, diff, dan judul panel tampil benar.
  - Export SQL ke Production manual menghasilkan file dan batch muncul di Riwayat.

  Kalau login tidak tersedia, pakai pola headless Chrome dengan `/api/*` di-mock (skrip di scratchpad, tidak di-commit) untuk memeriksa tata letak.
- [ ] **Step 5:** Serahkan checklist uji tulis ke **user** (executor tidak menjalankannya):
  - Simpan biasa di development → History memuat isi lama.
  - Salin Development → Staging pada tenant uji: popup meminta kode tenant, hasil sesuai ringkasan, History Staging berlabel "Salin · development · …", dan baris Riwayat berstatus berhasil.
  - Ulangi Salin tanpa perubahan → tombol nonaktif (N = 0).
  - Ubah config Staging di tab lain lalu Salin → 409, tidak ada yang tertulis.
  - Jalankan SQL export dua kali di DB uji → tidak ada baris ganda.
- [ ] **Step 6:** Perbarui catatan vault:
  - `BFF-API.md`: endpoint baru.
  - `Database.md`: tabel `config_change_batches`, kolom `batch_id`, fakta tidak ada unique key, `pipeline_workflow_configurations.id` tanpa default.
  - `Frontend-Studio.md`: layar Bandingkan, dialog, judul per panel.
  - `Keputusan-dan-Riwayat.md`: baris 2026-10-29 + keputusan di §9 spec.
- [ ] **Step 7:** `git add -A apps/web && git commit -m "feat(web): panel riwayat batch & label salin di History"`
