# Note for Future

Catatan temuan yang sengaja ditunda. Belum ada perubahan kode atau dokumen lain untuk topik di bawah.

---

## 1. `isFile` + `resolvePaths` — aturan validator Studio keliru (ditunda, 2026-10-14)

### Ringkasan

- Validator Studio (`apps/bff/src/routes/validator.ts`) menandai `isFile` + `resolvePaths` sebagai **error**.
  Ini keliru: di ATS, `resolvePaths` justru hanya dibaca untuk view `isFile: true`.
- Yang benar-benar berisiko adalah `resolvePaths` yang menunjuk ke **nilai satuan**
  (`.meta.fileKey`, `.meta.url`, `.meta.mime`, `.meta.isFullUrl`), bukan ke objek media.
  Sejak perubahan ATS tanggal 2026-10-02, pola ini bisa memicu
  `HTTP 500: invalid input syntax for type uuid`.
- Dokumen Studio saling bertentangan soal ini (lihat bagian "Dokumen yang perlu disamakan").

### Cara kerja di ATS

Sumber: `~/J/jobseeker-platform-backend` (branch `TECHS-6018`, commit terakhir 2026-10-13).

- `isFile: true` hanya berpengaruh jika tenant config punya langkah
  `{ service: "ResolveFileUrls" }` di `afterExecute` untuk event yang dipanggil. Tanpa langkah itu,
  S3 key dikembalikan apa adanya (tidak di-presign).
  Catatan: "workflow" yang dimaksud di sini adalah `afterExecute` di dalam tenant config, bukan tabel
  `pipeline_workflow_configurations`.
- `apps/ats/src/common/lifecycle/services/resolve-file-urls.lifecycle-service.ts`:
  ```ts
  (view.resolvePaths ?? [view.path])
  ```
  `resolvePaths` = lokasi file pengganti `path` untuk view `isFile`.
- `resolvePaths` juga dipakai `ResolveEncryptedFields` untuk view `isEncrypted: true` (field mana yang
  didekripsi).
- Default ATS sendiri memakai `isFile` + `resolvePaths` (KTP, KK, NPWP, SIM, pas foto) di
  `apps/ats/src/candidate/data/default/candidate-stable-tenant-config.config.ts`.

### Sumber error 500 UUID

Commit ATS `9e1759cdb` (2026-10-02, "adjsut array id multiple id") menambahkan `findMediaIdArrays`:
setiap array berisi string non-kosong di akar sumber dianggap daftar ID media, lalu dicari dengan
`mediaRepo.findByIds` → `candidate.media.id` bertipe `uuid` (`IBaseEntity`, `@PrimaryColumn('uuid')`).

Simulasi dengan library JMESPath yang sama dengan ATS (`@aws-lambda-powertools/jmespath`), kandidat
yang sudah upload KTP:

| Konfigurasi view KTP | Dikirim ke `findByIds` | Akibat |
|---|---|---|
| `resolvePaths: ["...meta.fileKey", "...meta.url", "...meta.mime", "...meta.isFullUrl"]` | `["candidate/ktp/abc.jpg", "image/jpeg"]` | Bukan UUID → Postgres `invalid input syntax for type uuid` → 500 |
| Tanpa `resolvePaths` (pakai `path`) | (kosong) | Objek media ditemukan, URL di-presign normal |

Sebelum 2026-10-02 pola ini tidak error, tetapi juga tidak pernah mem-presign file (yang ditemukan
hanya string, bukan objek media).

### Data yang terdampak (`neondb`, dicek 2026-10-14)

View `isFile` dengan `resolvePaths` berakhiran `.fileKey|.url|.mime|.isFullUrl`:

| Tenant | Config | Jumlah view | View |
|---|---|---|---|
| GLOBAL_DEFAULT | CANDIDATE_STABLE | 10 | bankAccountNumber, certificateOfEmployee, ijazahOrSkl, kk, ktp, npwp, pasPhoto, sim, skck, transcript |
| 019e95a5-f5f3-7dd8-952b-0ce16845d9bd (LSI) | CANDIDATE_STABLE | 11 | + medicalCertificate |
| 01a0ec41-0ee7-71a1-bede-97bdad90918a | CANDIDATE_STABLE | 12 | + applicationLetter, signature (bankAccountNumberDoc) |
| 01a0ec41-0ee7-71a1-bede-97bdad90918a | APPLICANT_CANDIDATE_META_STABLE | 12 | sama dengan di atas |

Query pengecekan (read-only):

```sql
SELECT coalesce(tc.tenant_id::text, 'GLOBAL_DEFAULT') AS tenant, tc.config_type,
  count(DISTINCT v->>'view') AS risky_views, string_agg(DISTINCT v->>'view', ', ') AS views
FROM public.tenant_configurations tc
CROSS JOIN LATERAL jsonb_array_elements(tc.value->'views') v
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(v->'resolvePaths') = 'array' THEN v->'resolvePaths' ELSE '[]'::jsonb END) rp
WHERE tc.deleted_at IS NULL AND jsonb_typeof(tc.value->'views') = 'array' AND v->>'isFile' = 'true'
  AND rp ~ '\.(fileKey|url|mime|isFullUrl)$'
GROUP BY 1, 2 ORDER BY 1, 2;
```

### Belum diverifikasi

- DB dev (`jsc_dev`, 172.16.167.0:30543) tidak terjangkau saat pengecekan (timeout; kemungkinan perlu
  VPN). Data di atas dari `neondb`, bukan dev.
- Versi ATS yang ter-deploy di dev/production belum dicek: apakah sudah berisi commit `9e1759cdb`.
- Error 500 belum direproduksi di server yang berjalan; baru dibuktikan lewat simulasi kode.

### Rencana perbaikan (saat dilanjutkan)

1. **Validator Studio** (`apps/bff/src/routes/validator.ts`):
   - Hapus aturan "isFile + resolvePaths = error".
   - Warning jika ada view `isFile` tetapi config tidak punya `ResolveFileUrls` di `afterExecute`.
   - Warning jika `resolvePaths` pada view `isFile` berakhir di `.fileKey/.url/.mime/.isFullUrl`;
     sarankan hapus `resolvePaths` dan cukup pakai `path`, atau arahkan ke objek media / `jsonbValue`.
2. **Dokumen yang perlu disamakan**:
   - `PROJECT_CONTEXT.md` (menyebut view file WAJIB punya `resolvePaths`).
   - `docs/context/tenant-configuration/AI_PROJECT_CONTEXT_HANDBOOK.md` (sama; juga memakai nama field
     yang tidak dipakai config asli: `source`, `display`, `type: "file"`).
   - `docs/skills/tenant-configuration/SKILL.md` (menyebut `isFile` + `resolvePaths` dilarang total).
   - `docs/TENANT_CONFIGURATION_GUIDE.md` (paling mendekati benar, tetapi contoh KTP-nya justru pola
     berisiko).
3. **MCP** (`apps/mcp/src/index.ts`): perbarui catatan `resolvePaths` di instruksi server.
4. **Tim backend ATS**: laporkan bahwa `findMediaIdArrays` memperlakukan array string apa pun sebagai
   ID media; usulkan hanya mengirim string berbentuk UUID ke `findByIds`. Default config di kode ATS
   juga memakai pola berisiko.
