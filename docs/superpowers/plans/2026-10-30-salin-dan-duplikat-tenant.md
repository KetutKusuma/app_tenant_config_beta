# Salin Config, Duplikat Tenant, dan Catatan Perubahan Wajib: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah popup "Salin config" (dari klik kanan config dan "Duplikat tenant…") yang menyalin config pilihan, dua domain sekaligus, ke tenant mana pun di env mana pun dengan pengaman path bentrok. Semua alur yang menimpa config juga wajib menyertakan catatan alasan, ditambah ringkasan otomatis dari diff.

**Architecture:** Logika murni diletakkan di modul BFF tanpa koneksi DB dan diuji dengan `node:test`:
- ringkasan diff dan validasi alasan (`changeSummary.ts`)
- path akhir, saran, dan SQL penjaga (`compare/pathConflicts.ts`)
- pratinjau salin (`compare/copyPreview.ts`)
- rencana dan transaksi multi-tabel (`compare/copyConfigs.ts`)
- SQL multi-tabel (`compare/sqlExport.ts`)

Route Express tetap tipis. Mesin Salin ke Kanan yang ada diperluas, bukan diduplikasi. Di web ada satu popup baru (`CopyConfigDialog`) yang juga menggantikan dialog Salin ke Kanan lama.

**Tech Stack:** Express 4 + `pg` (SQL string + `esc()`), React 18 + Vite + Tailwind, `tsx --test` / Node 22, tanpa dependensi baru.

**Spec:** `docs/superpowers/specs/2026-10-30-salin-dan-duplikat-tenant-design.md`. Baca bersama rencana ini; "§" merujuk ke bagian spec. Spec dasar: `docs/superpowers/specs/2026-10-29-bandingkan-antar-env-export-sql-salin-design.md`.

## Global Constraints

- **Executor tidak boleh menulis ke DB mana pun** (development, neondb, staging, production): tidak lewat UI, API (tidak ada POST/PUT/DELETE ke `localhost:4000`), MCP, maupun SQL. Executor juga tidak boleh menjalankan SQL hasil export. Aturan user: AI hanya mengusulkan. Uji yang menulis ke DB dilakukan user dengan checklist di Task 12.
- Skema `ats_db` **tidak diubah**. Perubahan skema hanya di Neon schema `tenant_studio`, lewat migrasi aditif dan idempoten di `apps/bff/src/studioSchema.ts`. **Controller wajib mendapat izin user sebelum file itu disimpan**, karena `tsx watch` langsung menjalankan migrasi ke Neon bersama.
- Production read-only: tidak ada jalur kode yang menulis ke profil `readonly`; `assertWritable` tetap jadi penjaga di setiap route tulis.
- Dev server user sedang berjalan (BFF `tsx watch` :4000, web vite :3000). Jangan start/stop. Jangan menjalankan `vite build`, karena menulis `apps/web/dist` yang dilayani BFF.
- Jangan menyentuh `resolvePaths` atau aturan validatornya.
- Tanpa dependensi baru. Semua nilai SQL lewat `esc()` (`apps/bff/src/db.ts`).
- Teks UI berbahasa Indonesia. Satu tombol utama per dialog; aksi lain ghost. Aksi tulis memakai `TypeToConfirmDialog`. Dialog memakai `useDialogEsc`.
- Teks tetap dari spec:
  - Menu: `Salin ke…`, `Duplikat tenant…`.
  - Status baris: `Baru`, `Akan ditimpa`, `Sama`, `Ganda`, `Hanya di tujuan, dibiarkan`, `Tujuan tidak dibaca`, `Path bentrok`.
  - Entri env: `Production (isi manual)`.
- Catatan alasan: di-trim, wajib tidak kosong, maksimal **500** karakter. Bentuk tersimpan: `<alasan> — <bagian-bagian otomatis digabung " · ">`.
- Teks Simpan cepat: `Update via Tenant Studio`.
- `GLOBAL_DEFAULT` tidak boleh menjadi tujuan salin. Baris yang dibuat oleh salin selalu `is_default = false`.
- Verifikasi tiap task: `cd apps/bff && pnpm test` dan `npx tsc --noEmit` di `apps/bff` dan `apps/web`.
- Antara Task 2/5/7 (BFF) dan Task 8/10/11 (web), UI lama untuk Sync preset, Sync Center push, Salin ke Kanan, dan Export SQL sementara ditolak BFF (400) karena body baru. Ini diterima di branch fitur; Simpan tetap jalan karena web lama sudah mengirim `changeSummary` tidak kosong.
- Branch `feat/salin-duplikat-tenant` (dibuat di Task 0 dari `feat/bandingkan-antar-env`). Commit per task. Pesan commit gaya repo (`feat(bff): …`, `feat(web): …`) dan diakhiri `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jangan push.

## Review Focus

1. **Alasan berisi baris baru atau lebih dari 500 karakter.** Baris baru harus dilipat jadi spasi supaya History dan komentar SQL tetap satu baris, dan teks yang terlalu panjang ditolak dengan pesan jelas. Diuji di Task 1 (`parseReason melipat baris baru dan membatasi panjang`).
2. **Tenant tujuan sudah memakai path yang sama di barisnya sendiri** (menimpa config yang sama). Ini bukan bentrok. Diuji di Task 3 (`findPathConflicts tidak menghitung baris tenant tujuan`) dan Task 4 (`cek path di transaksi mengecualikan tenant tujuan`).
3. **Path sumber kosong (`NULL`).** Path akhir diturunkan dari `config_type`, dan path turunan itu yang dicek bentrok. Diuji di Task 3 (`finalPath menurunkan path dari config_type`) dan Task 6 (`pratinjau memakai path turunan`).
4. **Tabel kedua gagal di tengah transaksi.** Tidak ada yang tertulis di kedua tabel (ROLLBACK, tanpa COMMIT). Diuji di Task 4 (`gagal di tabel kedua membatalkan semuanya`).
5. **Server menemukan config berubah yang tidak dicentang user.** Config itu tidak ikut ditulis, dan config yang dicentang tetap tersalin. Diuji di Task 4 (`selectPlan hanya menyimpan pilihan user`).

---

## File Structure

**BFF (`apps/bff/src`)**
- Create `changeSummary.ts` (+ `changeSummary.test.ts`): `parseReason`, `diffPaths`, `autoSummary`, `composeNote`, `QUICK_SAVE_REASON`, `REASON_MAX`.
- Create `compare/pathConflicts.ts` (+ test): `tenantCodeSlug`, `finalPath`, `suggestPath`, `duplicateFinalPaths`, `findPathConflicts`, `takenPathsWithPrefix`, `pathGuardSql`.
- Create `compare/copyPreview.ts` (+ test): `previewItems`, `previewSourceOnly`, `attachConflicts`.
- Modify `compare/copyConfigs.ts` (+ test): `CopyPart`, `selectPlan`, `selectionMismatch`, `applyPathOverrides`, `PathConflictError`, `writeCopyTxMulti`, `runCopy(parts, deps)`. `planMismatch` dan `writeCopyTx` dihapus.
- Modify `compare/sqlExport.ts` (+ test): multi-section, baris alasan, penjaga path.
- Modify `compare/batches.ts`, `studioSchema.ts`: kolom `note`, domain `semua`.
- Modify `routes/configs.ts`, `routes/references.ts`, `routes/sync.ts`: alasan wajib; route `POST /api/change-summary`.
- Modify `routes/compare.ts` (+ `routes/compare.test.ts`): body baru copy/export, `GET /api/compare/copy-preview`, `GET /api/compare/path-check`.

**Web (`apps/web/src`)**
- Modify `types.ts`.
- Modify `components/ui.tsx` (`PromptDialog` → dialog alasan), `studio/useStudioState.ts` (`askReason`, `copyDialog`), `components/studio/GlobalOverlays.tsx`.
- Modify `studio/useCoreActions.ts`, `studio/useCompareActions.ts`, `studio/useEditorActions.ts`, `studio/useSyncCenter.ts`, `components/studio/SyncCenterModal.tsx`.
- Create `studio/useCopyDialog.ts`, `components/studio/CopyConfigDialog.tsx`, `components/studio/PathOverrideField.tsx`.
- Modify `components/studio/Sidebar.tsx`, `TenantModal.tsx`, `EnvCompareScreen.tsx`, `ExportSqlDialog.tsx`, `ChangeBatchesPanel.tsx`. Delete `CopyConfigsDialog.tsx`.

---

### Task 0: Branch dan dokumen

- [ ] **Step 1:** `git switch -c feat/salin-duplikat-tenant` (dari HEAD `feat/bandingkan-antar-env`, working tree bersih kecuali spec + rencana ini).
- [ ] **Step 2:** Commit spec dan rencana:

```bash
git add docs/superpowers/specs/2026-10-30-salin-dan-duplikat-tenant-design.md docs/superpowers/plans/2026-10-30-salin-dan-duplikat-tenant.md
git commit -m "docs: spec dan rencana Salin config, Duplikat tenant, catatan wajib"
```

---

### Task 1: Ringkasan otomatis dan validasi alasan (murni)

**Files:** Create `apps/bff/src/changeSummary.ts`, `apps/bff/src/changeSummary.test.ts`

**Interfaces:**
- Consumes: `canonicalize` dari `presetSync.ts`.
- Produces:
  - `REASON_MAX = 500`
  - `QUICK_SAVE_REASON = "Update via Tenant Studio"`
  - `parseReason(raw: unknown): { ok: true; value: string } | { ok: false; error: string }`
  - `diffPaths(before: any, after: any): { changed: string[]; added: string[]; removed: string[] }`
  - `autoSummary(before: any | null, after: any, pathChange?: { from: string | null; to: string | null }): string`
  - `composeNote(reason: string, ...parts: Array<string | null | undefined>): string`

**Aturan `diffPaths`:**
- Kedua sisi di-`canonicalize`. Telusuri secara DFS dengan key objek terurut dan larik per indeks.
- Path ditulis bertitik dengan indeks `[i]`. Akar ditulis `(akar)`.
- Key atau indeks yang hanya ada di satu sisi dihitung sebagai `added`/`removed` pada node itu (subtree tidak dijabarkan).
- Beda tipe atau beda nilai primitif dihitung `changed` pada node itu.

**Aturan `autoSummary`:**
- `before === null` → `Config baru`.
- Bagian-bagian (digabung `" · "`):
  - `Ubah N field: <≤5 path changed>` + ` (+K lainnya)` bila N > 5.
  - `tambah X`. Bila tidak ada changed, ditambah `: <≤5 path>` dan `(+K lainnya)`.
  - `hapus Y`, dengan aturan yang sama.
  - `path: <from> → <to>` bila `pathChange` ada dan `from !== to`; `null` ditulis `(kosong)`.
- Huruf pertama hasil dijadikan kapital.
- Tanpa bagian apa pun → `Tidak ada perubahan isi`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test("parseReason melipat baris baru dan membatasi panjang", () => {
  assert.deepEqual(parseReason("  Rilis 30 Okt  "), { ok: true, value: "Rilis 30 Okt" });
  assert.deepEqual(parseReason("a\nb\r\n  c"), { ok: true, value: "a b c" });
  assert.deepEqual(parseReason("   "), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.deepEqual(parseReason(undefined), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.deepEqual(parseReason(42), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.equal(parseReason("x".repeat(500)).ok, true);
  assert.deepEqual(parseReason("x".repeat(501)), { ok: false, error: "Catatan (alasan) maksimal 500 karakter" });
});
test("diffPaths", () => {
  assert.deepEqual(diffPaths({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 }), { changed: ["b.c"], added: ["d"], removed: [] });
  assert.deepEqual(diffPaths({ l: [1, 2] }, { l: [1] }), { changed: [], added: [], removed: ["l[1]"] });
  assert.deepEqual(diffPaths({ l: [1] }, { l: [1, 5] }), { changed: [], added: ["l[1]"], removed: [] });
  assert.deepEqual(diffPaths({ x: { y: 1 } }, { x: "s" }), { changed: ["x"], added: [], removed: [] });
  assert.deepEqual(diffPaths({ b: 1, a: 1 }, { a: 1, b: 1 }), { changed: [], added: [], removed: [] });
  assert.deepEqual(diffPaths(1, 2), { changed: ["(akar)"], added: [], removed: [] });
});
test("autoSummary", () => {
  assert.equal(autoSummary(null, { a: 1 }), "Config baru");
  assert.equal(autoSummary({ a: 1 }, { a: 1 }), "Tidak ada perubahan isi");
  assert.equal(autoSummary({ a: 1, b: 1, c: { d: 1 } }, { a: 2, b: 2, c: { d: 2 }, e: 1 }), "Ubah 3 field: a, b, c.d · tambah 1");
  assert.equal(autoSummary({ a: 1 }, { a: 1, e: 1 }), "Tambah 1: e");
  assert.equal(autoSummary({ a: 1, b: 2 }, { a: 1 }), "Hapus 1: b");
  const many = (v: number) => Object.fromEntries(["k1", "k2", "k3", "k4", "k5", "k6", "k7"].map((k) => [k, v]));
  assert.equal(autoSummary(many(1), many(2)), "Ubah 7 field: k1, k2, k3, k4, k5 (+2 lainnya)");
  assert.equal(autoSummary({ a: 1 }, { a: 1 }, { from: "/ats/x", to: "/ats/idm/x" }), "Path: /ats/x → /ats/idm/x");
  assert.equal(autoSummary({ a: 1 }, { a: 2 }, { from: null, to: "a-b" }), "Ubah 1 field: a · path: (kosong) → a-b");
});
test("composeNote", () => {
  assert.equal(composeNote("Rilis", "Disalin dari development · IDM", "Config baru"), "Rilis — Disalin dari development · IDM · Config baru");
  assert.equal(composeNote("Rilis", null, "Ubah 1 field: a"), "Rilis — Ubah 1 field: a");
});
```

- [ ] **Step 2:** `cd apps/bff && pnpm test` → FAIL (modul belum ada).
- [ ] **Step 3:** Implementasikan `apps/bff/src/changeSummary.ts` sesuai aturan di atas.
- [ ] **Step 4:** `pnpm test` → PASS; `npx tsc --noEmit` → exit 0.
- [ ] **Step 5:** Commit `feat(bff): ringkasan otomatis diff dan validasi alasan`.

---

### Task 2: Alasan wajib di Simpan, Sync preset, Sync Center push (BFF)

**Files:** Modify `apps/bff/src/routes/configs.ts:99-168`, `apps/bff/src/routes/references.ts:325-394`, `apps/bff/src/routes/sync.ts:153-336`

**Interfaces:**
- Consumes: Task 1 (`parseReason`, `autoSummary`, `composeNote`).
- Produces:
  - `PUT /api/configs/:configId`: body `changeSummary` diperlakukan sebagai alasan. Kalau tidak valid → 400 `{ error }` dari `parseReason`, sebelum `assertWritable`.
  - `POST /api/references/sync-single`: field body baru `reason` (wajib, 400 bila tidak valid).
  - `POST /api/sync/apply`: field body baru `reason`, wajib bila `direction === "push"`, dicek sebelum loop. Pull tidak berubah.
  - `POST /api/change-summary`: body `{ before: any | null, after: any }` → `{ data: { summary: autoSummary(before ?? null, after) } }`. 400 bila `after` tidak ada. Hanya membaca; letakkan di `routes/configs.ts`.

**Teks History (persis):**

| Alur | change_summary |
| :-- | :-- |
| Simpan | `composeNote(reason, autoSummary(current.value, value))` |
| Sync preset | `composeNote(reason, \`Sync dari preset ${sourceFilename \|\| "file lokal"}\`, autoSummary(current.value, parsed))` |
| Push timpa | `composeNote(reason, \`Push dari file ${basename}\`, autoSummary(row.value, parsed))` |
| Push buat | `composeNote(reason, \`Dibuat dari file ${basename}\`, "Config baru")` |

Fallback `Snapshot sebelum perubahan v${v}` di `configs.ts` dihapus, karena alasan kini selalu ada.

- [ ] **Step 1:** Ubah tiga route sesuai tabel. Urutan cadangkan-dulu (`backupThenWrite`) dan semua kode status lama tidak berubah.
- [ ] **Step 2:** `pnpm test` → PASS (tes lama tetap hijau); `npx tsc --noEmit` → exit 0. Wiring route tidak punya tes unit (pola R2 rencana sebelumnya). Jangan memanggil route tulis untuk mencoba.
- [ ] **Step 3:** Commit `feat(bff): catatan alasan wajib + ringkasan otomatis di Simpan dan Sync`.

---

### Task 3: Path akhir, saran path, dan cek bentrok

**Files:** Create `apps/bff/src/compare/pathConflicts.ts`, `apps/bff/src/compare/pathConflicts.test.ts`

**Interfaces:**
- Consumes: `defaultPath` dari `compare/sqlExport.ts`, `esc` dari `db.ts`.
- Produces:
  - `tenantCodeSlug(code: string): string`: huruf kecil; `_` dan spasi → `-`; karakter selain `[a-z0-9-]` dibuang.
  - `finalPath(row: { config_type: string; path: string | null }, override?: string): string`: override yang di-trim dan tidak kosong menang; selain itu `row.path`, atau `defaultPath(config_type)` bila kosong.
  - `suggestPath(path: string, tenantCode: string, taken: Set<string>): string`: aturan §8.
  - `duplicateFinalPaths(items: Array<{ configType: string; path: string }>): string[]`: path yang dipakai lebih dari satu item, terurut.
  - `interface QueryDb { query(sql: string): Promise<{ rows: any[] }> }`
  - `findPathConflicts(db: QueryDb, table: string, paths: string[], targetTenantId: string): Promise<Map<string, { tenantId: string | null; configType: string }>>`: baris aktif dengan `path IN (…)` milik tenant selain tujuan. Kosong → tanpa query.
  - `takenPathsWithPrefix(db: QueryDb, table: string, targetTenantId: string, slug: string): Promise<Set<string>>`: path aktif tenant lain yang diawali `/ats/<slug>/`, `/<slug>/`, atau `<slug>/` (pakai `LIKE`; slug hanya `[a-z0-9-]`).
  - `pathGuardSql(table: string, targetTenantId: string, paths: string[]): string`: blok `DO $$ … $$;` yang `RAISE EXCEPTION 'Path sudah dipakai tenant lain: %', <daftar>` bila ada baris aktif tenant lain dengan path itu. Kosong → `""`.

- [ ] **Step 1: Tulis tes yang gagal**

```ts
test("tenantCodeSlug", () => {
  assert.equal(tenantCodeSlug("IDM_STAGING"), "idm-staging");
  assert.equal(tenantCodeSlug("Jss Dev!"), "jss-dev");
});
test("finalPath menurunkan path dari config_type", () => {
  assert.equal(finalPath({ config_type: "VACANCY_STABLE", path: null }), "vacancy-stable");
  assert.equal(finalPath({ config_type: "X", path: "/ats/a" }, "  /ats/b "), "/ats/b");
  assert.equal(finalPath({ config_type: "X", path: "/ats/a" }, "  "), "/ats/a");
});
test("suggestPath", () => {
  assert.equal(suggestPath("/ats/vacancy-massive", "IDM_STAGING", new Set()), "/ats/idm-staging/vacancy-massive");
  assert.equal(suggestPath("vacancy-stable", "IDM_STAGING", new Set()), "idm-staging/vacancy-stable");
  assert.equal(suggestPath("/foo/bar", "IDM", new Set()), "/idm/foo/bar");
  assert.equal(suggestPath("/ats/x", "IDM", new Set(["/ats/idm/x"])), "/ats/idm/x-2");
  assert.equal(suggestPath("/ats/x", "IDM", new Set(["/ats/idm/x", "/ats/idm/x-2"])), "/ats/idm/x-3");
});
test("duplicateFinalPaths", () => {
  assert.deepEqual(duplicateFinalPaths([{ configType: "A", path: "/p" }, { configType: "B", path: "/p" }, { configType: "C", path: "/q" }]), ["/p"]);
});
test("findPathConflicts tidak menghitung baris tenant tujuan", async () => {
  const sqls: string[] = [];
  const db = { query: async (s: string) => { sqls.push(s); return { rows: [{ path: "/ats/x", tenant_id: "t-9", config_type: "A" }] }; } };
  const m = await findPathConflicts(db, "public.tenant_configurations", ["/ats/x", "/ats/o'k"], "t-1");
  assert.match(sqls[0], /tenant_id IS DISTINCT FROM 't-1'/);
  assert.match(sqls[0], /deleted_at IS NULL/);
  assert.match(sqls[0], /'\/ats\/o''k'/);
  assert.deepEqual([...m.entries()], [["/ats/x", { tenantId: "t-9", configType: "A" }]]);
  assert.equal((await findPathConflicts(db, "public.tenant_configurations", [], "t-1")).size, 0);
  assert.equal(sqls.length, 1);
});
test("pathGuardSql", () => {
  const s = pathGuardSql("public.tenant_configurations", "t-1", ["/ats/o'k"]);
  assert.match(s, /^DO \$\$/);
  assert.match(s, /RAISE EXCEPTION/);
  assert.match(s, /tenant_id IS DISTINCT FROM 't-1'/);
  assert.match(s, /'\/ats\/o''k'/);
  assert.equal(pathGuardSql("public.tenant_configurations", "t-1", []), "");
});
```

`takenPathsWithPrefix` diuji dengan db palsu yang sama: SQL berisi ketiga pola `LIKE` dan `IS DISTINCT FROM`, dan hasilnya berupa `Set` path.

- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implementasikan.
- [ ] **Step 4:** `pnpm test` → PASS; `npx tsc --noEmit` → exit 0.
- [ ] **Step 5:** Commit `feat(bff): path akhir, saran path, dan cek bentrok path`.

---

### Task 4: Mesin salin multi-tabel dengan pilihan dan path

**Files:** Modify `apps/bff/src/compare/copyConfigs.ts`, `apps/bff/src/compare/copyConfigs.test.ts`

**Interfaces:**
- Consumes: Task 3 (`finalPath`), `ConfigDomain` dari `domain.ts`.
- Produces:
  - `CopyPlan` mendapat field `unselected: string[]` (`planCopy` mengisi `[]`).
  - `interface CopyPart { domain: ConfigDomain; table: CopyTable; plan: CopyPlan }`
  - `type CreatedRow = ConfigRow & { domain: ConfigDomain }`
  - `selectPlan(plan: CopyPlan, confirmedCreate: string[], confirmedOverwrite: string[]): CopyPlan`: create/overwrite yang tidak dikonfirmasi pindah ke `unselected` (terurut).
  - `selectionMismatch(plan: CopyPlan, confirmedCreate: string[], confirmedOverwrite: string[]): string[]`: tipe yang dikonfirmasi tetapi tidak ada di kelompok yang sama pada rencana segar (terurut).
  - `applyPathOverrides(plan: CopyPlan, overrides: Record<string, string>): CopyPlan`: `path` baris sumber (create dan overwrite.source) diganti `finalPath(row, overrides[type])`, tanpa mengubah objek aslinya.
  - `class PathConflictError extends Error { readonly code = "PATH_CONFLICT"; constructor(message: string, readonly paths: string[]) }`
  - `writeCopyTxMulti(connect: () => Promise<TxClient>, parts: CopyPart[], target: CopyTarget, newId?: () => string): Promise<CreatedRow[]>`, dengan urutan:
    1. `BEGIN`.
    2. Advisory lock per part. Urutannya `public.tenant_configurations` dulu, lalu `public.pipeline_workflow_configurations`, berapa pun urutan `parts`.
    3. `SET LOCAL standard_conforming_strings = on;` dan `SET LOCAL lock_timeout = '5s';`.
    4. Untuk tabel ber-`hasPath`: satu `SELECT` bentrok (path akhir create + overwrite, `tenant_id IS DISTINCT FROM` tujuan, `deleted_at IS NULL`). Ada baris → `PathConflictError` + ROLLBACK.
    5. UPDATE/INSERT per part seperti `writeCopyTx` lama, dengan path = path baris sumber (sudah final) dan `is_default` selalu `false`.
    6. `COMMIT`. Error di sini → `CommitUncertainError`.
  - `writeCopyTx` dan `planMismatch` dihapus.
  - `CopyDeps` menjadi:
    ```ts
    createBatch(): Promise<string>;
    backupOld(o: { source: ConfigRow; target: ConfigRow }, part: CopyPart, batchId: string): Promise<void>;
    discardBatchBackups(batchId: string): Promise<void>;
    writeTarget(parts: CopyPart[]): Promise<CreatedRow[]>;
    recordCreated(row: CreatedRow, batchId: string): Promise<void>;
    finishBatch(batchId: string, status: "berhasil" | "gagal", error?: string): Promise<void>;
    ```
  - `runCopy(parts: CopyPart[], deps: CopyDeps): Promise<{ batchId: string; warnings: string[] }>`: semantik lama tidak berubah, termasuk COMMIT tidak pasti yang menyimpan cadangan dan guard `finishBatch("berhasil")`.

- [ ] **Step 1: Ubah dan tambah tes**

Port semua tes `runCopy`/`writeCopyTx` lama ke bentuk baru (satu part). Hapus tes `planMismatch`. Tambahkan:

```ts
test("selectPlan hanya menyimpan pilihan user", () => {
  const plan = { create: [row("A"), row("B")], overwrite: [ow("C"), ow("D")], same: [], targetOnly: [], duplicates: [], unselected: [] };
  const s = selectPlan(plan, ["A"], ["C"]);
  assert.deepEqual(s.create.map((r) => r.config_type), ["A"]);
  assert.deepEqual(s.overwrite.map((o) => o.source.config_type), ["C"]);
  assert.deepEqual(s.unselected, ["B", "D"]);
});
test("selectionMismatch", () => {
  const plan = { create: [row("A")], overwrite: [ow("X")], same: [], targetOnly: [], duplicates: [], unselected: [] };
  assert.deepEqual(selectionMismatch(plan, ["A", "X"], []), ["X"]);
  assert.deepEqual(selectionMismatch(plan, ["A"], ["X"]), []);
});
test("applyPathOverrides", () => {
  const plan = { create: [{ ...row("VACANCY_STABLE"), path: null }], overwrite: [], same: [], targetOnly: [], duplicates: [], unselected: [] };
  assert.equal(applyPathOverrides(plan, {}).create[0].path, "vacancy-stable");
  assert.equal(applyPathOverrides(plan, { VACANCY_STABLE: "/ats/idm/v" }).create[0].path, "/ats/idm/v");
  assert.equal(plan.create[0].path, null);
});
test("gagal di tabel kedua membatalkan semuanya", async () => {
  // fake TxClient: UPDATE ke pipeline_workflow_configurations → rowCount 0
  // expect rejects TargetChangedError; queries berisi "ROLLBACK", tidak ada "COMMIT"
});
test("lock diambil tenant_configurations dulu walau parts terbalik", async () => { /* urutan query pg_advisory_xact_lock */ });
test("cek path di transaksi mengecualikan tenant tujuan dan menolak bentrok", async () => {
  // SELECT bentrok berisi "tenant_id IS DISTINCT FROM 't-2'"; fake mengembalikan 1 baris
  // → PathConflictError (paths berisi path itu), ROLLBACK, tanpa UPDATE/INSERT
});
test("baris baru selalu is_default false", async () => { /* sumber is_default true → INSERT memuat false, CreatedRow.is_default false */ });
```

Isi tiga tes terakhir mengikuti pola fake `TxClient` yang sudah ada di file tes. Pernyataan di komentar adalah asersi wajibnya.

- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implementasikan.
- [ ] **Step 4:** `pnpm test` → semua PASS. `npx tsc --noEmit` boleh masih gagal di `routes/compare.ts` (caller lama). Catat itu di laporan; perbaikannya ada di Task 5.
- [ ] **Step 5:** Commit `feat(bff): mesin salin multi-tabel dengan pilihan dan cek path`.

---

### Task 5: Kolom `note`, batch `semua`, dan route Salin baru

**Files:** Modify `apps/bff/src/studioSchema.ts` (`migrateChangeBatches`), `apps/bff/src/compare/batches.ts`, `apps/bff/src/routes/compare.ts` (copy route), `apps/bff/src/routes/compare.test.ts`

**Interfaces:**
- Consumes: Task 1, 3, 4.
- Produces:
  - Migrasi: `ALTER TABLE tenant_studio.config_change_batches ADD COLUMN IF NOT EXISTS note text;` di dalam `migrateChangeBatches`. **STOP sebelum menyimpan file ini: controller memastikan izin user sudah ada.**
  - `NewBatch.domain: string` (`"tenant_config" | "workflow_pipeline" | "semua"`), `NewBatch.note?: string | null`. `listBatches` dan `getBatch` mengembalikan `note`.
  - `parseCopyBody(body)` bentuk baru:
    ```ts
    interface CopyDomainBody { domain: ConfigDomain; expectedTargetVersions: Record<string, string | null>; confirmedCreate: string[]; confirmedOverwrite: string[]; pathOverrides: Record<string, string> }
    interface CopyBody { sourceEnv: string; sourceTenantId: string; targetTenantId: string; reason: string; domains: CopyDomainBody[] }
    ```
  - Respons sukses `POST /api/compare/copy`:
    ```ts
    { data: { batchId: string; domains: Array<{ domain: ConfigDomain; created: string[]; overwritten: string[]; skipped: { same: string[]; targetOnly: string[]; duplicates: string[]; unselected: string[] } }>; warnings: string[] } }
    ```

**Validasi `parseCopyBody` (pesan persis):**

| Kondisi | Pesan |
| :-- | :-- |
| `targetTenantId === "GLOBAL_DEFAULT"` | `GLOBAL_DEFAULT tidak bisa menjadi tujuan salin` |
| `domains` bukan larik tidak kosong | `domains wajib berisi minimal satu domain` |
| domain tidak dikenal | `Domain '<x>' tidak dikenal` |
| domain dobel | `Domain '<x>' disebut dua kali` |
| `pathOverrides` di `workflow_pipeline` | `pathOverrides hanya untuk tenant_config` |
| nilai `pathOverrides` bukan teks | `pathOverrides.<type> harus teks` |
| alasan tidak valid | pesan dari `parseReason` |
| expected/confirmed tidak valid | pesan lama |

**Alur route `POST /api/compare/copy`:**
1. `assertWritable`.
2. Parse.
3. Cek env tidak dikenal dan sumber = tujuan (pesan lama).
4. Baca meta sumber dan tujuan.
5. Per domain:
   - Baca baris sumber dan tujuan (`DOMAINS[domain]`, bukan header).
   - `fresh = planCopy(...)`.
   - `selectionMismatch` → 409 `{ code: "TARGET_CHANGED", error: PLAN_CHANGED_ERROR, configTypes }`.
   - `plan = applyPathOverrides(selectPlan(...), pathOverrides)`.
   - `staleConfigTypes` → 409 seperti sekarang.
6. Total create + overwrite = 0 → 400 `Tidak ada config yang dipilih untuk disalin.`
7. Untuk part `tenant_config`:
   - `duplicateFinalPaths` → 400 `Path ganda dalam pilihan: <daftar>`.
   - `findPathConflicts(targetDb, …)` → 409 `{ code: "PATH_CONFLICT", error: "Path sudah dipakai tenant lain di tujuan: <daftar>", paths }`.
8. Batch:
   - `kind: "salin"`, `domain`: satu domain → key-nya; dua domain → `"semua"`.
   - `configTypes`: dua domain → berawalan `domain:` (contoh `tenant_config:X`), terurut.
   - `counts`: total datar (`dibuat`, `ditimpa`, `sama`, `hanyaTujuan`, `ganda`, `tidakDipilih`), plus `perDomain` bila dua domain.
   - `note: reason`.
9. `backupOld` → `composeNote(reason, \`Sebelum disalin dari ${from}\`, autoSummary(target.value, source.value, { from: target.path, to: source.path }))`. `pathChange` hanya untuk tabel ber-path.
10. `recordCreated` → `composeNote(reason, \`Disalin dari ${from}\`, "Config baru")`. Bila path baris itu berasal dari override, tambahkan bagian `path: <path sumber atau (kosong)> → <path akhir>` sebagai bagian terakhir.
11. `writeTarget` = `writeCopyTxMulti`.
12. Penanganan error:
    - `PathConflictError` → 409 `{ code: "PATH_CONFLICT", error, paths, batchId }`.
    - `TargetChangedError` dan `commitUncertain` → tetap seperti sekarang (500 + `code` / `commitUncertain: true`).

- [ ] **Step 1: Tes `parseCopyBody` (ubah tes lama ke bentuk baru, tambah)**

```ts
const copyBody = (over: any = {}) => ({
  sourceEnv: "development", sourceTenantId: "t-1", targetTenantId: "t-2", reason: "Rilis",
  domains: [{ domain: "tenant_config", expectedTargetVersions: {}, confirmedCreate: ["A"], confirmedOverwrite: [] }], ...over,
});
test("parseCopyBody bentuk baru", () => {
  const ok = parseCopyBody(copyBody());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value.domains[0].pathOverrides, {});
  assert.deepEqual(parseCopyBody(copyBody({ targetTenantId: "GLOBAL_DEFAULT" })), { ok: false, error: "GLOBAL_DEFAULT tidak bisa menjadi tujuan salin" });
  assert.deepEqual(parseCopyBody(copyBody({ reason: " " })), { ok: false, error: "Catatan (alasan) wajib diisi" });
  assert.deepEqual(parseCopyBody(copyBody({ domains: [] })), { ok: false, error: "domains wajib berisi minimal satu domain" });
  const d = copyBody().domains[0];
  assert.deepEqual(parseCopyBody(copyBody({ domains: [d, d] })), { ok: false, error: "Domain 'tenant_config' disebut dua kali" });
  assert.deepEqual(parseCopyBody(copyBody({ domains: [{ ...d, domain: "workflow_pipeline", pathOverrides: { A: "/x" } }] })), { ok: false, error: "pathOverrides hanya untuk tenant_config" });
});
```

- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Ubah `batches.ts` dan route. Lalu, **setelah izin user**, tambahkan baris migrasi di `studioSchema.ts`.
- [ ] **Step 4:** `pnpm test` → PASS; `npx tsc --noEmit` (bff) → exit 0. Controller memverifikasi kolom lewat `information_schema` (hanya baca).
- [ ] **Step 5:** Commit `feat(bff): salin multi-domain dengan alasan, pilihan, dan cek path`.

---

### Task 6: Pratinjau salin dan cek path langsung

**Files:** Create `apps/bff/src/compare/copyPreview.ts`, `apps/bff/src/compare/copyPreview.test.ts`; Modify `apps/bff/src/routes/compare.ts`

**Interfaces:**
- Consumes: `buildCompareEntries`, Task 1 (`autoSummary`), Task 3.
- Produces:
  ```ts
  type PreviewStatus = "baru" | "timpa" | "sama" | "ganda" | "hanya_tujuan" | "tidak_dibaca";
  interface PreviewItem { configType: string; status: PreviewStatus; targetVersion: string | null; autoSummary: string | null; path: string | null; pathConflict: { ownerTenantId: string | null; ownerConfigType: string; suggestion: string } | null }
  interface CopyPreview { targetReadable: boolean; targetTenantCode: string | null; domains: Array<{ domain: ConfigDomain; items: PreviewItem[] }> }
  ```
  - `previewItems(entries: CompareEntry[], hasPath: boolean): PreviewItem[]`:
    - Pemetaan status: `hanya_kiri→baru`, `beda→timpa`, `sama→sama`, `ganda→ganda`, `hanya_kanan→hanya_tujuan`.
    - `autoSummary`: `baru` → `Config baru`; `timpa` → `autoSummary(right.value, left.value, hasPath ? { from: right.path, to: finalPath(left) } : undefined)`; status lain `null`.
    - `path`: `hasPath ? finalPath(left ?? right) : null`.
    - `targetVersion` = `right?.version_token ?? null`.
  - `previewSourceOnly(rows: ConfigRow[], hasPath: boolean): PreviewItem[]`: semua `tidak_dibaca`; tipe dengan lebih dari satu baris → `ganda`.
  - `attachConflicts(items: PreviewItem[], conflicts: Map<string, { tenantId: string | null; configType: string }>, tenantCode: string, taken: Set<string>): PreviewItem[]`:
    - Hanya untuk item `baru`/`timpa`.
    - Saran dihitung dengan `suggestPath`.
    - `taken` = path bentrok + path yang sudah diambil prefix + saran item sebelumnya, supaya saran tidak saling bentrok.
  - `GET /api/compare/copy-preview?sourceEnv&sourceTenantId&targetEnv&targetTenantId&domains=tenant_config,workflow_pipeline` → `{ data: CopyPreview }`:
    - `targetEnv=production-manual` → `targetReadable: false` dengan `previewSourceOnly`.
    - Env tidak terjangkau → 502 `{ error, side }`, seperti `GET /api/compare`.
    - `targetTenantId === "GLOBAL_DEFAULT"` → 400.
    - Untuk `tenant_config` dengan tujuan terbaca: `findPathConflicts` + `takenPathsWithPrefix` lalu `attachConflicts`.
  - `GET /api/compare/path-check?targetEnv&targetTenantId&path` → `{ data: { available: boolean; ownerTenantId?: string | null; ownerConfigType?: string } }`. `production-manual` atau parameter kosong → 400.

- [ ] **Step 1: Tes**

```ts
test("pratinjau memakai path turunan", () => {
  const left = cfg({ config_type: "VACANCY_STABLE", path: null, value: { a: 1 } });
  const items = previewItems([{ configType: "VACANCY_STABLE", status: "hanya_kiri", changeCount: 0, left, right: null }], true);
  assert.deepEqual(items[0], { configType: "VACANCY_STABLE", status: "baru", targetVersion: null, autoSummary: "Config baru", path: "vacancy-stable", pathConflict: null });
});
test("timpa membawa ringkasan dan versi tujuan", () => { /* beda → status timpa, autoSummary "Ubah 1 field: a", targetVersion dari right */ });
test("previewSourceOnly menandai ganda", () => { /* dua baris tipe A → ganda; satu baris B → tidak_dibaca */ });
test("attachConflicts memberi saran yang tidak saling bentrok", () => {
  // dua item baru dengan path "/ats/x" dan "/ats/y" yang sama-sama bentrok; taken berisi "/ats/idm/x"
  // → saran "/ats/idm/x-2" dan "/ats/idm/y"; item sama/hanya_tujuan tidak diberi pathConflict
});
```

- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implementasikan modul dan dua route (hanya baca).
- [ ] **Step 4:** `pnpm test` → PASS; `npx tsc --noEmit` → exit 0. Executor boleh memanggil kedua GET ini di dev BFF untuk mengecek bentuk respons, karena hanya baca.
- [ ] **Step 5:** Commit `feat(bff): pratinjau salin dan cek path`.

---

### Task 7: Export SQL multi-tabel dengan alasan dan penjaga path

**Files:** Modify `apps/bff/src/compare/sqlExport.ts`, `apps/bff/src/compare/sqlExport.test.ts`, `apps/bff/src/routes/compare.ts` (export route), `apps/bff/src/routes/compare.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseReason`), Task 3 (`finalPath`, `pathGuardSql`, `findPathConflicts`, `duplicateFinalPaths`).
- Produces:
  - `ExportSqlInput` menjadi:
    ```ts
    { sections: Array<{ domain: ExportTable; items: ExportItem[] }>; mode; source; target; author; createdAt; reason: string }
    ```
    `ExportItem.path` sudah final.
  - Header:
    - `-- Tabel   : <tabel-tabel digabung ", ">`.
    - Baris baru `-- Alasan  : <oneLine(reason)>` setelah baris `-- Dibuat`.
    - N = total item.
  - Isi: satu `BEGIN; SET LOCAL standard_conforming_strings = on;`. Per section:
    - komentar `-- == <tabel> ==`
    - bila `hasPath` dan tenant tujuan tidak `NULL`: `pathGuardSql(...)` untuk semua path item section itu
    - blok item bernomor lanjut `[i/N]`
    
    Ditutup satu `COMMIT;`.
  - `exportFileName(code, sections.length > 1 ? "semua" : table, date)`.
  - `parseExportBody` bentuk baru:
    ```ts
    { sourceEnv; sourceTenantId; mode; reason; target; domains: Array<{ domain: ConfigDomain; configTypes: string[]; pathOverrides: Record<string, string> }> }
    ```
    `configTypes` tidak kosong per domain. Aturan domain dan `pathOverrides` sama dengan `parseCopyBody`.
  - Route:
    - Per domain, baca baris sumber; pesan lama untuk config tidak ada atau ganda.
    - `isDefault` = tujuan global ? `source.is_default` : `false`.
    - Path final pakai override.
    - `duplicateFinalPaths` → 400.
    - Tujuan profil terbaca + `tenant_config` → `findPathConflicts`; ada → 409 `PATH_CONFLICT` (sama seperti Salin).
    - Batch: `domain`/`configTypes` seperti Task 5, `note: reason`.
    - `before_snapshot`: key `type` untuk satu domain, `domain:type` untuk dua domain.

- [ ] **Step 1:** Perbarui golden test yang ada. Output satu section bertambah baris `-- Alasan` dan komentar section; tanpa penjaga bila tujuan global. Tambahkan:

```ts
test("dua section dalam satu transaksi", () => {
  const sql = buildExportSql({ ...base, sections: [tcSection, wfSection] });
  assert.equal(sql.match(/BEGIN;/g)!.length, 1);
  assert.equal(sql.match(/COMMIT;/g)!.length, 1);
  assert.ok(sql.indexOf("-- == public.tenant_configurations ==") < sql.indexOf("-- == public.pipeline_workflow_configurations =="));
});
test("penjaga path hanya untuk tabel ber-path dengan tenant tujuan", () => {
  const sql = buildExportSql({ ...base, sections: [tcSection, wfSection] });
  assert.equal(sql.match(/RAISE EXCEPTION/g)!.length, 1);
  assert.ok(sql.indexOf("DO $$") < sql.indexOf("UPDATE public.tenant_configurations"));
});
test("alasan satu baris di header", () => {
  assert.match(buildExportSql({ ...base, reason: "a\nb" }), /^-- Alasan  : a b$/m);
});
test("nama file semua", () => assert.equal(exportFileName("IDM_PROD", "semua", new Date(2026, 9, 30)), "IDM_PROD_semua_2026-10-30.sql"));
```

Tes `parseExportBody` baru: alasan kosong → pesan `parseReason`; `domains: []` → `domains wajib berisi minimal satu domain`; `configTypes: []` → `Pilih minimal satu config`.

- [ ] **Step 2:** `pnpm test` → FAIL.
- [ ] **Step 3:** Implementasikan.
- [ ] **Step 4:** `pnpm test` → PASS; `npx tsc --noEmit` (bff) → exit 0.
- [ ] **Step 5:** Commit `feat(bff): export SQL multi-tabel dengan alasan dan penjaga path`.

---

### Task 8: Web: dialog alasan untuk Simpan, Sync preset, Sync Center

**Files:** Modify `apps/web/src/components/ui.tsx` (`PromptDialog`), `studio/useStudioState.ts`, `components/studio/GlobalOverlays.tsx`, `studio/useCoreActions.ts:398-440`, `studio/useCompareActions.ts:210-235`, `studio/useEditorActions.ts:40-75`, `studio/useSyncCenter.ts:160-200`, `components/studio/SyncCenterModal.tsx`

**Interfaces:**
- Consumes: Task 2 (`POST /api/change-summary`, field `reason`).
- Produces:
  - `askReason(opts: { title: string; description?: string; before?: any; after?: any }): Promise<string | null>`. Fungsi ini menggantikan `askSummary`; semua pemanggil dipindah.
  - `PromptDialog` (nama komponen tetap):
    - Kolom mulai kosong, `maxLength={500}`, tombol utama mati selama kolom kosong.
    - Label `Catatan (alasan)`.
    - Bila `before`/`after` diberikan, dialog memanggil `POST /api/change-summary` dan menampilkan `Yang berubah (otomatis): <summary>`. Saat menunggu tampil `Menghitung…`; bila gagal tampil `Ringkasan otomatis tidak tersedia`.

**Perubahan per alur:**
- `handleSave(quick)`: quick → `changeSummary: "Update via Tenant Studio"`; selain itu `askReason({ title: \`Simpan ${activeConfigType}\`, description: <deskripsi lama>, before: JSON.parse(originalContent), after: parsed })`.
- `handleSaveCompareTenant`: `askReason` (tanpa before/after bila isi asli kanan tidak tersedia).
- Sync preset (`useEditorActions`): `confirm()` diganti `askReason({ title: \`Sync preset ke ${activeConfigType}\`, description: "Versi sebelumnya otomatis diarsipkan ke History.", before: JSON.parse(originalContent), after: parsed })`, lalu kirim `reason`.
- Sync Center:
  - Langkah Pratinjau untuk push mendapat kolom `Catatan (alasan)` (wajib, maks 500, state `syncReason` di `useSyncCenter`).
  - Tombol push mati selama kolom kosong.
  - `reason` dikirim di body push; pull tidak berubah.

- [ ] **Step 1:** Implementasikan.
- [ ] **Step 2:** `cd apps/web && npx tsc --noEmit` → exit 0. Web tidak punya test runner. Jangan menekan Simpan atau Sync di browser.
- [ ] **Step 3:** Commit `feat(web): catatan alasan wajib di Simpan dan Sync`.

---

### Task 9: Web: popup "Salin config"

**Files:** Create `apps/web/src/studio/useCopyDialog.ts`, `components/studio/CopyConfigDialog.tsx`, `components/studio/PathOverrideField.tsx`; Modify `apps/web/src/types.ts`

**Interfaces:**
- Consumes: Task 5 (body/respons copy), Task 6 (preview, path-check), Task 7 (export body), `TypeToConfirmDialog`, `useDialogEsc`, `ChangeBatchesPanel`, `POST /api/tenants`.
- Produces:
  - Tipe web: `PreviewStatus`, `PreviewItem`, `CopyPreview` (cermin Task 6), dan:
    ```ts
    interface CopyDialogRequest { source: { env: string; tenantId: string }; domains: ConfigDomain[]; preselect: Array<{ domain: ConfigDomain; configType: string }> | "all"; target?: { env: string; tenantId: string }; lockTarget?: boolean }
    ```
  - `<CopyConfigDialog request={CopyDialogRequest} onClose={() => void} onDone={(r: { target: { env: string; tenantId: string }; wrote: boolean }) => void} />`
  - `<PathOverrideField value targetEnv targetTenantId onChange(value: string) onStatus(s: "memeriksa" | "tersedia" | "dipakai") />`: debounce 400 ms ke `path-check`. Teks status: `Memeriksa…`, `Tersedia`, `Sudah dipakai <ownerConfigType>`.

**Perilaku (§4, urutan dari atas):**
1. **Sumber** (teks): env label · kode tenant · domain (`Semua` bila dua).
2. **Env tujuan**: semua `targetEnvs` + `Production (isi manual)` (`production-manual`). Profil `readonly` dan `production-manual` → mode Unduh SQL. Aturan §4.2 ini menggantikan kalimat "env read-only selain Production" di §9.
3. **Tenant tujuan**:
   - Daftar dari `GET /api/tenants` (header `X-Target-Env`). `GLOBAL_DEFAULT` dan env + tenant sumber disembunyikan.
   - `+ Daftarkan tenant` membuka form `tenant_id` (UUID wajib), `group_id`, kode, nama. Form memanggil `POST /api/tenants` dan menolak `tenant_id` yang sudah terdaftar (pola quick-add `ExportSqlDialog`).
   - Untuk `production-manual`: kolom `tenant_id` (UUID wajib) dan `group_id`.
   - `lockTarget` → env dan tenant tidak bisa diubah.
4. **Daftar config**: `GET copy-preview` dimuat ulang setiap tujuan berubah. Gagal (502/lainnya) → pesan galat yang menyebut sisi/env, daftar kosong, tombol utama mati.
   - Dikelompokkan per domain (`Tenant Configurations`, `Pipeline Workflow`), dengan centang "pilih semua" per kelompok.
   - Label status sesuai Global Constraints.
   - Baris `timpa` menampilkan `autoSummary`.
   - Baris `sama`/`ganda` tidak bisa dicentang. Baris `hanya_tujuan` redup di bawah.
   - Baris dengan `pathConflict` berlabel `Path bentrok`, menampilkan `PathOverrideField` berisi `suggestion`, dan tidak bisa dicentang sampai statusnya `tersedia`.
   - Centang awal: `preselect === "all"` → semua `baru`/`timpa`/`tidak_dibaca` yang tidak bentrok. Daftar → hanya item itu. Item bentrok yang termasuk preselect otomatis tercentang begitu path-nya `tersedia`.
   - Ringkasan di bawah daftar: `N baru, M ditimpa, K dilewati`.
5. **Catatan (alasan)**: textarea wajib, maks 500.
6. **Tombol utama**:
   - Mode tulis: `Salin N config…` → `TypeToConfirmDialog` (ketik kode tenant tujuan) → `POST /api/compare/copy`. Header `X-Target-Env` = env tujuan; `confirmEnv` bila profil `protected`.
   - Body: `expectedTargetVersions` = semua item domain itu (`targetVersion`); `confirmedCreate`/`confirmedOverwrite` = item tercentang; `pathOverrides` = override yang diisi.
   - Mode Unduh SQL: `Unduh SQL` → `POST /api/compare/export-sql` dengan `mode: "timpa"`, lalu unduh file seperti `ExportSqlDialog`.
   - Tombol mati bila N = 0, tujuan belum dipilih, alasan kosong, atau masih ada override `memeriksa`/`dipakai`. Alasannya ditulis di dekat tombol.
7. **Hasil**:
   - Daftar dibuat / ditimpa / dilewati per domain, plus tombol ghost `Lihat Riwayat` yang membuka `ChangeBatchesPanel` (`left` = sumber, `right` = tujuan).
   - `409 TARGET_CHANGED` atau 500 `code TARGET_CHANGED` → pesan + daftar tipe + `Muat ulang`.
   - `409 PATH_CONFLICT` → muat ulang pratinjau dan tandai baris.
   - `commitUncertain` / jaringan / 5xx non-JSON → teks "hasil tidak pasti" yang sama dengan `CopyConfigsDialog` sekarang.
   - Esc: tidak menutup saat sibuk; menutup konfirmasi bila terbuka; selain itu menutup dialog.

- [ ] **Step 1:** Implementasikan.
- [ ] **Step 2:** `npx tsc --noEmit` (web) → exit 0.
- [ ] **Step 3:** Commit `feat(web): popup Salin config`.

---

### Task 10: Web: pintu masuk dan pengganti Salin ke Kanan

**Files:** Modify `apps/web/src/studio/useStudioState.ts`, `components/studio/GlobalOverlays.tsx`, `components/studio/Sidebar.tsx:150-180, 276-300`, `components/studio/TenantModal.tsx`, `components/studio/EnvCompareScreen.tsx`, `studio/useCoreActions.ts` (shortcut); Delete `components/studio/CopyConfigsDialog.tsx` dan tipe `CopyResult` di `types.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces: state `copyDialog: CopyDialogRequest | null` + `setCopyDialog` di konteks studio. `GlobalOverlays` me-render `CopyConfigDialog` bila tidak null.

**Perubahan:**
- **Sidebar config, klik kanan:** item `Salin ke…` (ikon `Copy`) setelah `Ekspor sebagai preset…`, dengan request `{ source: { env: targetEnvName, tenantId: selectedTenant.tenantId }, domains: [configDomain], preselect: [{ domain: configDomain, configType: c.config_type }] }`.
- **Sidebar tenant, klik kanan:** item `Duplikat tenant…` setelah `Edit nama / label…`, tidak muncul untuk `GLOBAL_DEFAULT`, dengan request `{ source: { env: targetEnvName, tenantId: t.tenantId }, domains: ["tenant_config", "workflow_pipeline"], preselect: "all" }`.
- **`TenantModal`:** saat mengedit tenant non-global, tambahkan tombol ghost `Duplikat tenant…` di footer (sebelah `Hapus dari daftar`); tombol menutup modal lalu membuka popup.
- **`onDone` dari GlobalOverlays:** bila `target.env === targetEnvName && target.tenantId === selectedTenant?.tenantId && wrote`:
  - muat ulang `/api/tenants/<id>/configs` → `setConfigs`;
  - bila editor tidak dirty: `loadConfig` config aktif + `fetchHistories`;
  - bila dirty: status `Isi tujuan berubah; simpan atau buang perubahan lalu muat ulang.`
- **`EnvCompareScreen`:** tombol `Salin ke Kanan…` membuka `CopyConfigDialog` lokal dengan `{ source: left, target: right, lockTarget: true, domains: [configDomain], preselect: "all" }`, dan `onDone` memuat ulang perbandingan. Hapus impor `CopyConfigsDialog`, lalu hapus file-nya.
- **Shortcut global** (`useCoreActions`): perlakukan `copyDialog !== null` sama seperti `showEnvCompare` (Ctrl+S ditelan, tidak menyimpan).

- [ ] **Step 1:** Implementasikan.
- [ ] **Step 2:** `npx tsc --noEmit` (web) → exit 0; `grep -rn CopyConfigsDialog apps/web/src` → kosong.
- [ ] **Step 3:** Commit `feat(web): menu Salin ke…, Duplikat tenant…, dan Salin ke Kanan memakai popup baru`.

---

### Task 11: Web: Export SQL dan Riwayat menyesuaikan

**Files:** Modify `apps/web/src/components/studio/ExportSqlDialog.tsx`, `components/studio/ChangeBatchesPanel.tsx`, `types.ts` (`ChangeBatch.note`)

**Interfaces:**
- Consumes: Task 6 (`copy-preview` untuk bentrok), Task 7 (body export baru), Task 9 (`PathOverrideField`).

**Perubahan:**
- **`ExportSqlDialog`:**
  - Tambah textarea `Catatan (alasan)` (wajib, maks 500); `canBuild` mensyaratkannya.
  - Body baru: `domains: [{ domain: configDomain, configTypes: checkedTypes, pathOverrides }]`, `reason`.
  - Untuk domain `tenant_config`:
    - Tujuan profil → panggil `copy-preview` (sumber terpilih → tujuan). Tipe tercentang dengan `pathConflict` ditampilkan sebagai baris `Path bentrok` + `PathOverrideField`. Tombol `Buat SQL` mati sampai semua `tersedia`.
    - Tujuan manual → tampilkan `PathOverrideField` tanpa cek (status selalu `tersedia`) untuk tiap tipe tercentang, berisi path akhir sumber, dengan catatan `SQL akan batal sendiri bila path sudah dipakai tenant lain.`
- **`ChangeBatchesPanel`:** tampilkan `note` di bawah judul batch (bila ada). Domain `semua` ditampilkan `Semua`. `config_types` berawalan `domain:` ditampilkan tanpa awalan, dikelompokkan per domain.

- [ ] **Step 1:** Implementasikan.
- [ ] **Step 2:** `npx tsc --noEmit` (web) → exit 0.
- [ ] **Step 3:** Commit `feat(web): Export SQL dengan alasan dan cek path; Riwayat menampilkan catatan`.

---

### Task 12: Dokumentasi vault dan checklist user

**Files:** Vault (di luar git) `/Users/ketutkusuma/Vaults/Jobseeker/app_tenant_config_beta/`: `BFF-API.md`, `Database.md`, `Frontend-Studio.md`, `Keputusan-dan-Riwayat.md`, hub `app_tenant_config_beta AI-Context.md`

- [ ] **Step 1:** Perbarui catatan topik:
  - **BFF-API:** endpoint baru dan body baru, alasan wajib, ringkasan otomatis, `PATH_CONFLICT`.
  - **Database:** kolom `note`, domain `semua`.
  - **Frontend-Studio:** popup, menu, dialog alasan.
  - **Keputusan-dan-Riwayat:**
    - keputusan user di spec §10;
    - fakta `findByPath` tanpa filter tenant;
    - permintaan user untuk fitur nanti: perbaikan otomatis `resolvePaths` saat `isFile`;
    - Open items dengan checklist Step 2.
- [ ] **Step 2:** Checklist uji tulis untuk user (masuk Open items dan pesan akhir):
  - Simpan biasa: kolom alasan kosong dan Simpan mati sampai diisi; History berisi `<alasan> — Ubah …`.
  - Simpan cepat: History `Update via Tenant Studio — …`.
  - Sync preset dan Sync Center push meminta alasan; History berisi alasan + ringkasan.
  - Klik kanan config → `Salin ke…` ke tenant lain di env yang sama: baris yang path-nya bentrok berlabel `Path bentrok` dengan saran; setelah diganti, salin berhasil dan History tujuan berisi alasan.
  - `Duplikat tenant…` ke tenant baru yang didaftarkan dari popup (env lain): kedua tabel tersalin; Riwayat satu batch `Semua` dengan catatan.
  - Ubah config tujuan di tab lain lalu Salin → 409, tidak ada yang ditulis.
  - Unduh SQL ke `Production (isi manual)` untuk dua tabel, lalu jalankan di DB uji dua kali → tidak ada baris dobel. Jalankan di DB yang path-nya dipakai tenant lain → SQL batal dengan pesan path.
  - Salin ke Kanan di layar Bandingkan memakai popup baru dengan tujuan terkunci.
- [ ] **Step 3:** Tidak ada commit (vault di luar git).
