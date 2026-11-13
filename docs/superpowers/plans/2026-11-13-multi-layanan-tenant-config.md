# Studio Multi-Layanan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant Studio bisa mengelola `tenant_configurations` (dan tabel workflow bila ada) milik ATS, HRIS, Organization, Auth, dan Communication lewat pemilih Layanan di samping pemilih env, dengan perilaku persis seperti ATS.

**Architecture:** Registri layanan di BFF (`services.ts`) menggantikan `DOMAINS` yang di-hardcode. Pool database di-cache per `<env>:<layanan>`, dan layanan aktif dibawa header `X-Target-Service`, sama seperti `X-Target-Env`. Data Studio di Neon (riwayat, preset link, batch) diberi kolom `target_service` (data lama = `ats`). Web menambah satu `MenuButton` Layanan dan mengirim header lewat `lib/api.ts`.

**Tech Stack:** Express + `pg` (BFF, tes `node:test` via `tsx --test`), React + Vite (web, verifikasi `tsc`), MCP SDK (`apps/mcp`).

**Spec:** `docs/superpowers/specs/2026-11-13-multi-layanan-tenant-config-design.md`

## Global Constraints

- Layanan: `ats` (`ats_db`), `hris` (`hris_db`), `organization` (`organization_db`), `auth` (`auth_db`), `communication` (`communication_db`). Label UI: `ATS`, `HRIS`, `Organization`, `Auth`, `Communication`.
- Tabel per layanan persis seperti tabel di spec bagian 1. Organization memakai schema `core`. Workflow HRIS ada di `workflow_pipelines.workflow_pipeline_configurations`.
- Baris dengan `config_type`/`workflow_config_type` NULL tidak pernah dibaca, dibandingkan, disalin, diekspor, atau di-sync.
- Tidak ada cast `::uuid` pada kolom `id`. Id baru: `randomUUID()` (BFF); Export SQL memakai `gen_random_uuid()::text` bila `idType = "varchar"`.
- Request tulis (POST/PUT/PATCH/DELETE di `/api`, kecuali `/api/auth/*` dan `/api/me/*`) tanpa header `X-Target-Service` → `400 TARGET_SERVICE_REQUIRED`.
- Semua operasi Bandingkan/Salin/Duplikat/Export SQL berada di dalam satu layanan, tidak lintas layanan.
- Semua teks UI dan pesan error berbahasa Indonesia. Hanya satu tombol utama per area; menu Layanan memakai `MenuButton` yang sama dengan pemilih env.
- Perilaku ATS tidak boleh berubah: semua tes BFF yang sudah ada harus tetap lulus tanpa diubah maknanya.
- MCP tetap hanya-baca.

## Review Focus

1. **Tab lama atau client tanpa header layanan mengirim Simpan** → ditolak dengan `TARGET_SERVICE_REQUIRED`, tidak jatuh diam-diam ke `lastTargetService`. Dites di Task 2.
2. **Layanan yang tidak ada di env** (misalnya `neondb` + HRIS) → `409 SERVICE_UNAVAILABLE` dengan pesan jelas, bukan 500 "database does not exist". Dites di Task 2.
3. **Menulis override Organization untuk tenant yang tidak ada di tabel tenant Organization** (FK) → pesan "Tenant belum terdaftar di Organization pada env ini" dan seluruh transaksi dibatalkan. Dites di Task 4.
4. **Folder preset ATS ikut terpakai saat layanan HRIS aktif** → tidak boleh. `presetDirFor` untuk non-ATS tanpa folder mengembalikan `null`, dan route preset/sync menolak dengan pesan pilih folder. Dites di Task 3.
5. **Mengganti layanan saat ada perubahan belum disimpan** → muncul dialog konfirmasi yang sama dengan mengganti env. Diverifikasi manual di Task 6 dan Task 7.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `apps/bff/src/services.ts` (baru) | Registri `ServiceSpec`, `serviceOf(req)`, `tableFor(service, domain)` |
| `apps/bff/src/domain.ts` | `DomainSpec` diturunkan dari registri; `domainOf(req)` memakai layanan aktif; `presetDirFor` per layanan |
| `apps/bff/src/envs.ts` | Konfigurasi pool per env + layanan, ketersediaan layanan, middleware header layanan |
| `apps/bff/src/configRows.ts` (baru) | Helper SQL bersama: `liveWhere`, kolom ekstra, terjemahan error pg |
| `apps/bff/src/studioSchema.ts`, `auth.ts` | Migrasi Neon `target_service`, preferensi `last_target_service` + `preset_dirs` |
| `apps/bff/src/routes/*.ts`, `compare/*.ts` | Memakai `req.targetService`, `liveWhere`, kolom ekstra, filter `target_service` |
| `apps/web/src/lib/api.ts`, `studio/useStudioState.ts`, `studio/useCoreActions.ts`, `components/studio/StudioHeader.tsx`, `components/AuthGate.tsx`, `types.ts` | Layanan aktif, header, menu, breadcrumb |
| `apps/web/src/studio/useEnvCompare.ts`, `studio/useCopyDialog.ts`, `components/studio/ExportSqlDialog.tsx` | Env tujuan tanpa layanan aktif → disabled |
| `apps/mcp/src/studioClient.ts`, `apps/mcp/src/tools.ts` | Parameter `service` |

---

### Task 1: Registri layanan dan `DomainSpec` per layanan

**Files:**
- Create: `apps/bff/src/services.ts`
- Modify: `apps/bff/src/domain.ts` (ganti `DOMAINS` dan `domainOf`)
- Test: `apps/bff/src/services.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ServiceKey = "ats" | "hris" | "organization" | "auth" | "communication";
  export interface TableSpec {
    table: string; typeCol: string; hasPath: boolean; idType: "uuid" | "varchar";
    extraCopyCols: string[];        // disalin apa adanya dari sumber saat Salin/Duplikat/Export
    extraInsertDefaults: Record<string, string>; // kolom -> literal SQL untuk baris baru
    groupIdFromSource: boolean;     // true: group_id baris baru = group_id sumber (bukan group tenant tujuan)
  }
  export interface ServiceSpec { key: ServiceKey; label: string; defaultDbName: string;
    domains: { tenant_config: TableSpec; workflow_pipeline?: TableSpec } }
  export const SERVICES: Record<ServiceKey, ServiceSpec>;
  export const SERVICE_KEYS: ServiceKey[];            // urutan menu: ats, hris, organization, auth, communication
  export function isServiceKey(x: unknown): x is ServiceKey;
  export function tableFor(service: ServiceKey, domain: ConfigDomain): TableSpec | null;
  // domain.ts
  export interface DomainSpec extends TableSpec { key: ConfigDomain; pathSel: string; linkKey: (t: string) => string }
  export function domainSpecFor(service: ServiceKey, domain: ConfigDomain): DomainSpec | null;
  export function domainOf(req: express.Request): DomainSpec; // memakai req.targetService?.key ?? "ats"; domain tak tersedia -> tenant_config
  ```
- `DOMAINS` tetap diekspor sebagai alias `{ tenant_config: domainSpecFor("ats","tenant_config")!, workflow_pipeline: domainSpecFor("ats","workflow_pipeline")! }` sampai Task 5 mengganti pemakaiannya di `routes/compare.ts`.

Nilai registri:

| service | tenant_config | workflow_pipeline |
|---|---|---|
| ats | `public.tenant_configurations`, `config_type`, path, uuid, extra `[]` | `public.pipeline_workflow_configurations`, `workflow_config_type`, no path, uuid |
| hris | `public.tenant_configurations`, varchar, extraCopyCols `["type"]`, groupIdFromSource | `workflow_pipelines.workflow_pipeline_configurations`, varchar, extraCopyCols `["is_active"]`, extraInsertDefaults `{ is_active: "true" }`, groupIdFromSource |
| organization | `core.tenant_configurations`, uuid, extraCopyCols `["type"]` | — |
| auth | `public.tenant_configurations`, uuid | — |
| communication | `public.tenant_configurations`, uuid | — |

`hasPath = true` untuk semua `tenant_config`, `false` untuk semua workflow.

- [ ] **Step 1: Tulis tes yang gagal** di `services.test.ts`:
  - `tableFor("hris","tenant_config")` → `{ table: "public.tenant_configurations", idType: "varchar", extraCopyCols: ["type"], groupIdFromSource: true }` (pakai `assert.partialDeepStrictEqual` atau cek per properti).
  - `tableFor("organization","tenant_config")!.table === "core.tenant_configurations"`.
  - `tableFor("hris","workflow_pipeline")!.table === "workflow_pipelines.workflow_pipeline_configurations"` dan `extraInsertDefaults` `{ is_active: "true" }`.
  - `tableFor("auth","workflow_pipeline") === null`.
  - `domainSpecFor("ats","workflow_pipeline")!.pathSel === "NULL::text AS path"` dan `linkKey("X") === "WORKFLOW_PIPELINE:X"`.
  - `domainOf` dengan req palsu `{ targetService: { key: "auth" }, header: () => "workflow_pipeline", query: {}, body: {} }` → `table === "public.tenant_configurations"` (fallback ke tenant_config).
  - `isServiceKey("hris") === true`, `isServiceKey("integrator") === false`.
- [ ] **Step 2: Jalankan** `pnpm --filter bff test` → FAIL (modul `./services` tidak ada).
- [ ] **Step 3: Implementasi** `services.ts` dan ubah `domain.ts` sesuai Interfaces. Tambahkan `targetService?: ServiceSpec` ke deklarasi global `Express.Request` di `services.ts`.
- [ ] **Step 4: Jalankan** `pnpm --filter bff test` → semua PASS, termasuk tes lama.
- [ ] **Step 5: Commit** `feat(bff): registri layanan dan DomainSpec per layanan`

---

### Task 2: Koneksi per env + layanan dan middleware `X-Target-Service`

**Files:**
- Modify: `apps/bff/src/envs.ts`, `apps/bff/src/main.ts`, `apps/bff/src/routes/tenants.ts` (`GET /api/envs`)
- Test: `apps/bff/src/envs.test.ts` (baru)

**Interfaces:**
- Consumes: `SERVICES`, `isServiceKey`, `ServiceKey` (Task 1).
- Produces:
  ```ts
  export function servicePoolConfig(vars: Record<string,string|undefined>, service: ServiceKey): PoolConfig | null;
  // ats: perilaku lama poolConfigFrom. Lainnya: DB_HOST -> database = vars[`DB_NAME_${KEY_UPPER}`] || defaultDbName;
  // TARGET_DB_URL -> hanya bila vars[`TARGET_DB_URL_${KEY_UPPER}`] ada; selain itu null.
  export function poolFor(env: string, service: ServiceKey = "ats"): Pool; // cache key `${env}:${service}`; error "Layanan '<label>' tidak dikonfigurasi di env '<env>'" bila config null
  export async function serviceAvailability(env: string): Promise<Array<{ key: ServiceKey; label: string; dbName: string | null; available: boolean; hasWorkflow: boolean; reason?: string }>>;
  // available = config ada && SELECT to_regclass('<tenant_config table>') IS NOT NULL; hasil di-cache 60 detik per env
  export function targetServiceMiddleware(): express.RequestHandler; // dipasang setelah targetEnvMiddleware
  ```
- `TargetEnvProfile` mendapat `services` hanya di response `GET /api/envs`: tiap profil berisi `services: Awaited<ReturnType<typeof serviceAvailability>>`.
- Aturan middleware (lewati `/auth/`, `/envs`, `/me/`):
  - header `x-target-service` ada tapi bukan `ServiceKey` → `400 { code: "UNKNOWN_TARGET_SERVICE" }`;
  - method selain GET/HEAD tanpa header → `400 { code: "TARGET_SERVICE_REQUIRED", error: "Layanan tujuan tidak disebutkan. Muat ulang halaman Studio." }`;
  - GET tanpa header → `req.user?.preferences.lastTargetService` bila valid, selain itu `ats`;
  - layanan tidak tersedia di env → `409 { code: "SERVICE_UNAVAILABLE", error: "Layanan <label> tidak tersedia di env <label env>: <reason>" }`;
  - sukses → `req.targetService = SERVICES[key]`, `req.targetDb = poolFor(env, key)`.

- [ ] **Step 1: Tulis tes yang gagal** di `envs.test.ts`:
  - `servicePoolConfig({ DB_HOST: "h", DB_NAME: "ats_db" }, "hris")!.database === "hris_db"`.
  - `servicePoolConfig({ DB_HOST: "h", DB_NAME_HRIS: "hris_custom" }, "hris")!.database === "hris_custom"`.
  - `servicePoolConfig({ TARGET_DB_URL: "postgres://x/ats" }, "hris") === null`; dengan `TARGET_DB_URL_HRIS` → bukan null.
  - `servicePoolConfig({ DB_HOST: "h", DB_NAME: "ats_db" }, "ats")!.database === "ats_db"` (perilaku lama).
  - Middleware (req/res palsu, `serviceAvailability` disuntik lewat parameter opsional `deps` pada `targetServiceMiddleware(deps?)`):
    - POST tanpa header → status 400, `code === "TARGET_SERVICE_REQUIRED"`;
    - GET tanpa header, preferensi `lastTargetService: "hris"` → `req.targetService.key === "hris"`;
    - header `"integrator"` → 400 `UNKNOWN_TARGET_SERVICE`;
    - layanan `available: false` → 409 `SERVICE_UNAVAILABLE`.
  - `serviceAvailability` (dengan ping disuntik) → entri `auth` punya `hasWorkflow: false`, entri `hris` punya `hasWorkflow: true`.
- [ ] **Step 2: Jalankan** `pnpm --filter bff test` → FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces. `poolConfigFrom` lama dipertahankan untuk `ats`. Penutupan pool saat file profil berubah/dihapus berlaku untuk semua kunci `${env}:*`. Pasang `app.use("/api", targetServiceMiddleware())` di `main.ts` setelah middleware env. `assertWritable` tidak diubah.
- [ ] **Step 4: Jalankan** `pnpm --filter bff test` → PASS.
- [ ] **Step 5: Commit** `feat(bff): pool per env dan layanan, header X-Target-Service`

---

### Task 3: Neon `target_service`, preferensi layanan, dan folder preset per layanan

**Files:**
- Modify: `apps/bff/src/studioSchema.ts`, `apps/bff/src/auth.ts`, `apps/bff/src/domain.ts` (`presetDirFor`), `apps/bff/src/routes/configs.ts`, `routes/sync.ts`, `routes/references.ts`, `compare/batches.ts`, `routes/compare.ts` (query riwayat/preset/batch)
- Test: `apps/bff/src/presetDir.test.ts` (baru)

**Interfaces:**
- Produces:
  - Migrasi idempoten:
    - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS target_service text NOT NULL DEFAULT 'ats'` pada `tenant_config_histories`, `preset_links`, `config_change_batches`;
    - PK `preset_links` menjadi `(user_id, target_env, target_service, tenant_id, config_type)` (pola cek `pg_get_constraintdef` yang sudah ada);
    - index `idx_config_histories_env` dibuat ulang sebagai `(target_env, target_service, core_config_id, version DESC)`;
    - `studio_user_preferences`: `last_target_service text`, `preset_dirs jsonb NOT NULL DEFAULT '{}'`.
  - `req.user.preferences` mendapat `lastTargetService: string | null` dan `presetDirs: Record<string, string>` (kunci `${service}:${domain}`).
  - `PUT /api/me/preferences` menerima `lastTargetService` (string/null) dan `presetDirs` (objek string→string|null; digabung dengan `preset_dirs || $json`, nilai null menghapus kunci).
  - `presetDirFor(req): string | null` — `ats` tetap memakai logika lama. Layanan lain mengembalikan `prefs.presetDirs["<svc>:<domain>"]`, atau `null` bila tidak ada (tanpa fallback ke folder ATS / `DEFAULT_PRESET_DIR`).
  - Route yang memakai `presetDirFor` dan mendapat `null` → `400 { code: "PRESET_DIR_REQUIRED", error: "Folder preset untuk layanan <label> belum diatur." }`.
  - Setiap SELECT/INSERT/UPDATE/DELETE pada tiga tabel Neon di atas menyertakan `target_service = esc(req.targetService!.key)`. `createBatch`/`listBatches` menerima field `targetService`.

- [ ] **Step 1: Tulis tes yang gagal** di `presetDir.test.ts`:
  - req `{ targetService: { key: "hris" }, user: { preferences: { presetDirTenant: "/ats", presetDirs: {} } }, header: () => undefined, query: {}, body: {} }` → `presetDirFor(req) === null`.
  - Dengan `presetDirs: { "hris:tenant_config": "/hris" }` → `"/hris"`.
  - Layanan `ats` dengan `presetDirTenant: "/ats"` → `"/ats"` (perilaku lama).
- [ ] **Step 2: Jalankan** `pnpm --filter bff test` → FAIL.
- [ ] **Step 3: Implementasi** migrasi, preferensi, `presetDirFor`, dan filter `target_service` di semua query riwayat/preset/batch.
- [ ] **Step 4: Jalankan** `pnpm --filter bff test` → PASS. Lalu `pnpm dev:bff` dan pastikan log start tanpa error migrasi. Cek di Neon: `SELECT target_service, count(*) FROM tenant_studio.tenant_config_histories GROUP BY 1` → hanya `ats`.
- [ ] **Step 5: Commit** `feat(bff): target_service di data Studio dan folder preset per layanan`

---

### Task 4: Helper baris config (NULL type, kolom ekstra, group_id, error pg)

**Files:**
- Create: `apps/bff/src/configRows.ts`
- Modify: `apps/bff/src/compare/types.ts`, `compare/tenantRows.ts`, `compare/copyConfigs.ts`, `compare/sqlExport.ts`, `routes/configs.ts`, `routes/tenants.ts`, `routes/sync.ts`, `routes/references.ts`
- Test: `apps/bff/src/configRows.test.ts`, plus tambahan di `compare/copyConfigs.test.ts` dan `compare/sqlExport.test.ts`

**Interfaces:**
- Consumes: `TableSpec`, `DomainSpec` (Task 1).
- Produces:
  ```ts
  export function liveWhere(t: Pick<TableSpec,"typeCol">): string; // `deleted_at IS NULL AND ${typeCol} IS NOT NULL`
  export function extraSelect(t: TableSpec): string;               // "" atau `, jsonb_build_object('type', type) AS extra`
  export function pgErrorMessage(err: unknown, ctx: { serviceLabel: string }): string | null;
  // 23503 (FK) -> "Tenant belum terdaftar di <serviceLabel> pada env ini."
  // 23505 (unique) -> "Config ini sudah ada di tujuan."
  // lainnya -> null
  ```
  - `ConfigRow` mendapat `extra?: Record<string, unknown>`.
  - `fetchTenantRows` dan semua SELECT dari `D.table` di route memakai `liveWhere(D)` sebagai ganti `deleted_at IS NULL`, lalu memilih `extraSelect(D)`.
  - INSERT baru di `writeCopyTxMulti`, `routes/configs.ts` (tambah config), `routes/sync.ts`, dan `buildExportSql` menambahkan kolom `extraCopyCols` dari `source.extra` (bila ada) lalu `extraInsertDefaults` untuk kolom yang belum terisi. `group_id` = `source.group_id` bila `groupIdFromSource`, selain itu perilaku lama.
  - `ExportTable` mendapat `idType`, `extraCopyCols`, `extraInsertDefaults`, `groupIdFromSource`. Ekspresi id = `gen_random_uuid()::text` bila `idType === "varchar"`.
  - Route yang menangkap error tulis memakai `pgErrorMessage` sebelum fallback ke `err.message` (status 409 untuk 23503/23505).

- [ ] **Step 1: Tulis tes yang gagal**
  - `configRows.test.ts`:
    - `liveWhere({ typeCol: "config_type" }) === "deleted_at IS NULL AND config_type IS NOT NULL"`;
    - `pgErrorMessage({ code: "23503" }, { serviceLabel: "Organization" }) === "Tenant belum terdaftar di Organization pada env ini."`;
    - `pgErrorMessage({ code: "23505" }, …) === "Config ini sudah ada di tujuan."`;
    - `pgErrorMessage(new Error("x"), …) === null`.
  - `copyConfigs.test.ts` (client palsu yang merekam SQL, pola tes yang sudah ada): tabel HRIS workflow, sumber `{ group_id: null, extra: { is_active: false } }`, tujuan `groupId: "g-1"` → SQL INSERT berisi kolom `is_active` dengan nilai `false` dan `group_id` `NULL`.
  - `copyConfigs.test.ts`: tabel Organization (`groupIdFromSource: false`) → `group_id` = `'g-1'` (perilaku lama).
  - `sqlExport.test.ts`: tabel HRIS tenant_config (`idType: "varchar"`, `extraCopyCols: ["type"]`), item dengan `extra: { type: "SYSTEM_MENU" }` → output memuat `gen_random_uuid()::text`, kolom `type`, dan `'SYSTEM_MENU'`. Tabel ATS → tetap `gen_random_uuid()` tanpa `::text` (tes lama tetap lulus).
- [ ] **Step 2: Jalankan** `pnpm --filter bff test` → FAIL.
- [ ] **Step 3: Implementasi** `configRows.ts` dan terapkan di semua file yang tercantum. Cari sisa `deleted_at IS NULL` pada query ke `D.table`/`t.table` dengan `grep -n "deleted_at IS NULL" apps/bff/src/routes apps/bff/src/compare`; query ke tabel Neon tidak diubah.
- [ ] **Step 4: Jalankan** `pnpm --filter bff test` → PASS.
- [ ] **Step 5: Commit** `feat(bff): baris config per layanan (type, is_active, id varchar, error FK)`

---

### Task 5: Bandingkan, Salin, Duplikat, Export SQL di dalam satu layanan

**Files:**
- Modify: `apps/bff/src/routes/compare.ts`, `compare/sqlExport.ts`, `compare/copyConfigs.ts` (bila `CopyPart` butuh `TableSpec`)
- Test: `compare/sqlExport.test.ts`, `routes` tidak punya tes; logika validasi yang dipisah ke fungsi murni dites di `compare/compareService.test.ts` (baru)

**Interfaces:**
- Consumes: `poolFor(env, service)` (Task 2), `domainSpecFor` (Task 1), helper Task 4.
- Produces:
  - Semua `poolFor(x)` di `routes/compare.ts` menjadi `poolFor(x, req.targetService!.key)`. Semua `DOMAINS[d]` menjadi `domainSpecFor(req.targetService!.key, d)`. Domain yang `null` → `400 "Layanan <label> tidak punya domain <domain>."`.
  - `export async function assertServiceInEnvs(service: ServiceKey, envs: string[], availability = serviceAvailability): Promise<string | null>` di `compare/compareService.ts` (baru). Mengembalikan pesan error Indonesia untuk env pertama yang tidak punya layanan itu, atau `null`. Dipanggil di awal compare, copy-preview, path-check, export-sql, dan copy.
  - `buildExportSql` menulis baris komentar `-- layanan: <label> (<dbName>)` di header. `ExportSqlInput` mendapat `service: { label: string; dbName: string }`.
  - Duplikat tenant menyalin `workflow_pipeline` hanya bila `domainSpecFor(service, "workflow_pipeline")` tidak null.

- [ ] **Step 1: Tulis tes yang gagal**
  - `compareService.test.ts`: `assertServiceInEnvs("hris", ["development","neondb"], async (env) => env === "neondb" ? [{ key: "hris", available: false, reason: "tidak dikonfigurasi", … }] : [{ key: "hris", available: true, … }])` → string yang memuat `"neondb"` dan `"HRIS"`. Bila semua tersedia → `null`.
  - `sqlExport.test.ts`: `buildExportSql({ …, service: { label: "HRIS", dbName: "hris_db" } })` memuat `-- layanan: HRIS (hris_db)`.
- [ ] **Step 2: Jalankan** `pnpm --filter bff test` → FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces. Hapus alias `DOMAINS` dari `domain.ts` bila tidak ada pemakai lagi (`grep -rn "DOMAINS" apps/bff/src`).
- [ ] **Step 4: Jalankan** `pnpm --filter bff test` → PASS.
- [ ] **Step 5: Commit** `feat(bff): bandingkan, salin, export SQL per layanan`

---

### Task 6: Web — pemilih Layanan

**Files:**
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/types.ts`, `apps/web/src/components/AuthGate.tsx` (tipe preferensi), `apps/web/src/studio/useStudioState.ts`, `apps/web/src/studio/useCoreActions.ts`, `apps/web/src/components/studio/StudioHeader.tsx`, `apps/web/src/studio/useEnvCompare.ts`, `apps/web/src/studio/useCopyDialog.ts`, `apps/web/src/components/studio/ExportSqlDialog.tsx`, komponen pengalih domain (temukan dengan `grep -rn "setActiveDomain\|handleSwitchDomain" apps/web/src`)

**Interfaces:**
- Consumes: response `GET /api/envs` (`profiles[].services[]`), preferensi `lastTargetService`, `presetDirs` (Task 2–3).
- Produces:
  - `api.ts`: `getActiveService()`, `setActiveService(key: ServiceKey)`. `api()` selalu mengirim `X-Target-Service: activeService` (default `"ats"`) kecuali pemanggil sudah mengisi header itu.
  - `types.ts`: `type ServiceKey = "ats" | "hris" | "organization" | "auth" | "communication"`; `interface ServiceInfo { key: ServiceKey; label: string; dbName: string | null; available: boolean; hasWorkflow: boolean; reason?: string }`; `TargetEnv` mendapat `services: ServiceInfo[]`.
  - `useStudioState`: state `targetServiceKey` diinisialisasi dari `user.preferences.lastTargetService || "ats"`, lalu `setActiveService`.
  - `useCoreActions.handleSwitchTargetService(next: ServiceKey)`: pakai guard perubahan belum disimpan yang sama dengan `handleSwitchTargetEnv`, lalu `setActiveService` + `savePreferences({ lastTargetService: next })`. Setelah itu muat ulang tenant; pertahankan `selectedTenant` bila `tenantId`-nya ada di daftar baru. Bila layanan tidak punya workflow dan domain aktif `workflow_pipeline`, pindah ke `tenant_config`. Folder preset dibaca dari `presetDirs["<svc>:<domain>"]` untuk non-ATS, dan disimpan lewat `savePreferences({ presetDirs: { [key]: dir } })`.
  - Saat env diganti dan layanan aktif tidak tersedia di env baru → pindah ke `ats` dengan toast "Layanan <label> tidak tersedia di <env>, beralih ke ATS."
  - `StudioHeader`: `MenuButton` tepat setelah pemilih env. Label = label layanan aktif. Item: `` `${s.label} · ${s.dbName ?? "-"}${aktif ? "  ✓" : ""}` ``, `disabled: !s.available`, `hint: s.reason`. Breadcrumb diawali label layanan sebelum tenant.
  - Pengalih domain disembunyikan bila `ServiceInfo.hasWorkflow` layanan aktif `false`.
  - `useEnvCompare`, `useCopyDialog`, `ExportSqlDialog`: env di daftar pilihan yang `services` tidak memuat layanan aktif dengan `available: true` → disabled dengan hint "Layanan <label> tidak tersedia".

- [ ] **Step 1: Implementasi** sesuai Interfaces.
- [ ] **Step 2: Verifikasi tipe** `pnpm --filter web build` → sukses tanpa error TypeScript; `pnpm --filter bff test` → PASS.
- [ ] **Step 3: Verifikasi manual** (`pnpm dev`, env Development):
  - menu Layanan tampil di samping env, ✓ di ATS;
  - pilih HRIS → daftar tenant/config HRIS muncul, breadcrumb `HRIS › …`;
  - ubah config tanpa simpan, lalu ganti layanan → dialog konfirmasi muncul;
  - pilih env `neondb` → HRIS disabled dengan hint;
  - pilih Auth → pengalih Workflow hilang.
- [ ] **Step 4: Commit** `feat(web): pemilih Layanan di header`

---

### Task 7: HRIS end-to-end dan regresi ATS (dev + staging)

**Files:**
- Modify: `envs/development.env`, `envs/staging.env` hanya bila nama DB HRIS berbeda dari `hris_db` (tidak di-commit bila berisi kredensial; file `envs/*.env` mengikuti `.gitignore` yang ada).
- Modify (bila ditemukan bug): file terkait + tes yang mereproduksinya.

- [ ] **Step 1: Uji manual HRIS di Development:**
  - buka `EMPLOYEE_STABLE` default → Simpan dengan catatan → Riwayat menampilkan versi baru;
  - Riwayat ATS untuk config dengan nama sama tidak menampilkan entri itu;
  - Salin `SYSTEM_MENU` dari tenant `019c6a92-…` ke tenant lain → baris baru `id` 36 karakter, `type` ikut tersalin;
  - Bandingkan antar env Development ↔ Staging untuk HRIS → hanya baris HRIS;
  - Export SQL HRIS → header `-- layanan: HRIS (hris_db)`, id `gen_random_uuid()::text`;
  - Workflow HRIS: buka `workflow_pipeline` → 8 baris dev tampil, Salin ke tenant lain → `is_active = true` dan `group_id` NULL;
  - Sync Center HRIS tanpa folder → pesan "Folder preset untuk layanan HRIS belum diatur."
- [ ] **Step 2: Regresi ATS:** ulangi Simpan, Salin ke…, Bandingkan antar env, dan Export SQL di ATS → hasil sama seperti sebelum branch ini (riwayat lama tetap tampil).
- [ ] **Step 3: Ulangi Step 1 singkat di Staging** (baca + Bandingkan saja, tanpa tulis kecuali user mengizinkan).
- [ ] **Step 4: Commit** perbaikan yang ditemukan (bila ada): `fix(...): ...`

---

### Task 8: Organization, Auth, Communication

- [ ] **Step 1: Uji manual Organization di Development:**
  - daftar config tidak memuat baris `CMS` (15 baris tanpa `config_type`);
  - edit + Simpan satu override;
  - Salin ke tenant yang tidak ada di tabel tenant Organization → pesan "Tenant belum terdaftar di Organization pada env ini." dan tidak ada baris yang tertulis (cek `SELECT count(*)` sebelum/sesudah).
- [ ] **Step 2: Uji manual Auth dan Communication:** buka, edit, Simpan, Riwayat; pengalih Workflow tidak tampil.
- [ ] **Step 3: Commit** perbaikan yang ditemukan (bila ada).

---

### Task 9: MCP parameter `service`

**Files:**
- Modify: `apps/mcp/src/studioClient.ts`, `apps/mcp/src/tools.ts`, `apps/mcp/README.md` (bila ada daftar parameter)

**Interfaces:**
- Consumes: header `X-Target-Service`, respons `GET /api/envs` dengan `services` (Task 2).
- Produces: `studioRequest(..., scope: { env?: string; domain?: Domain; service?: ServiceKey })` mengirim `X-Target-Service` (default `"ats"`). Tool `list_tenants`, `list_configs`, `get_config`, `get_history`, `compare_configs`, `validate_config`, `preview_change` mendapat input opsional `service` (enum lima layanan, deskripsi "Layanan/database config, default ats"). `list_envs` menampilkan layanan yang tersedia per env.

- [ ] **Step 1: Implementasi** sesuai Interfaces. Tidak ada tool tulis baru.
- [ ] **Step 2: Verifikasi** `pnpm --filter mcp typecheck` → sukses. Panggil `list_configs` dengan `service: "hris"` lewat MCP → daftar config HRIS.
- [ ] **Step 3: Commit** `feat(mcp): parameter service`

---

### Task 10: Catatan vault

- [ ] **Step 1:** Perbarui `/Users/ketutkusuma/Vaults/Jobseeker/app_tenant_config_beta/Database.md` (tabel per layanan, catatan CMS, unique index workflow HRIS), `Arsitektur.md` (header `X-Target-Service`, pool `<env>:<layanan>`), dan tambah baris di `Keputusan-dan-Riwayat.md` (keputusan 2026-11-13: multi-layanan, CMS dikecualikan, tanpa lintas layanan, header wajib saat tulis).
