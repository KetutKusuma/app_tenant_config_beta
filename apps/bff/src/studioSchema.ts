import { initAuthSchema } from "./auth";
import { auditDb, esc } from "./db";
import { defaultEnvName } from "./envs";

// Persiapan tabel studio (preset_links, auth) dan migrasi kolom target_env.

// ============================================================================
// Sync Center: public.tenant_configurations <-> file JSON preset lokal
// ============================================================================

// Tabel pemetaan config_type -> file lokal (disimpan di schema studio, bukan di DB target)
export function initStudioSchema() {
  return auditDb
  .query(`
    CREATE TABLE IF NOT EXISTS tenant_studio.preset_links (
      tenant_id text NOT NULL,
      config_type text NOT NULL,
      file_path text NOT NULL,
      updated_at timestamp DEFAULT now(),
      PRIMARY KEY (tenant_id, config_type)
    );
  `)
  // base_db_version = updated_at DB saat file terakhir di-pull/di-push; dipakai untuk menolak push
  // dari file yang belum pernah di-pull atau yang DB-nya sudah berubah sejak pull terakhir.
  .then(() => auditDb.query(`ALTER TABLE tenant_studio.preset_links ADD COLUMN IF NOT EXISTS base_db_version text;`))
  // Tabel auth + user default + migrasi preset_links menjadi per-user (PK: user_id, tenant_id, config_type)
  .then(() => initAuthSchema(auditDb, esc))
  .then(() => migrateTargetEnvColumns())
  .catch((err) => console.error("Gagal menyiapkan tabel studio (preset_links/auth):", err.message));
}

// History & preset_links dipisah per target env. Baris lama = env default (DB yang dipakai sebelum fitur ini).
export async function migrateTargetEnvColumns() {
  const legacyEnv = esc(defaultEnvName());
  await auditDb.query(`
    ALTER TABLE tenant_studio.tenant_config_histories ADD COLUMN IF NOT EXISTS target_env text;
    UPDATE tenant_studio.tenant_config_histories SET target_env = ${legacyEnv} WHERE target_env IS NULL;
    CREATE INDEX IF NOT EXISTS idx_config_histories_env ON tenant_studio.tenant_config_histories (target_env, core_config_id, version DESC);
    ALTER TABLE tenant_studio.preset_links ADD COLUMN IF NOT EXISTS target_env text;
    UPDATE tenant_studio.preset_links SET target_env = ${legacyEnv} WHERE target_env IS NULL;
    ALTER TABLE tenant_studio.preset_links ALTER COLUMN target_env SET NOT NULL;
  `);
  const pk = await auditDb.query(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'tenant_studio.preset_links'::regclass AND contype = 'p';
  `);
  if (pk.rows[0] && !String(pk.rows[0].def).includes("target_env")) {
    await auditDb.query(`
      ALTER TABLE tenant_studio.preset_links DROP CONSTRAINT IF EXISTS preset_links_pkey;
      ALTER TABLE tenant_studio.preset_links ADD PRIMARY KEY (user_id, target_env, tenant_id, config_type);
    `);
    console.log("🌐 preset_links & history dipisah per target env.");
  }
  await migrateTenantMetadataEnv();
}

// tenant_metadata dipisah per target env: tenant_id (dan group_id, client_code) berbeda di dev/staging/prod.
// Baris lama milik env di kolom `environment` (selama ini selalu 'development') DAN env default,
// karena sebelum fitur ini daftar tenant yang sama dipakai di semua env.
async function migrateTenantMetadataEnv() {
  const pk = await auditDb.query(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'tenant_studio.tenant_metadata'::regclass AND contype = 'p';
  `);
  if (pk.rows[0] && String(pk.rows[0].def).includes("target_env")) return;
  const legacyEnv = esc(defaultEnvName());
  // Satu query multi-statement = satu transaksi implisit: gagal di tengah = tidak ada yang berubah
  await auditDb.query(`
    ALTER TABLE tenant_studio.tenant_metadata ADD COLUMN IF NOT EXISTS target_env text;
    UPDATE tenant_studio.tenant_metadata
      SET target_env = COALESCE(NULLIF(environment, ''), ${legacyEnv}) WHERE target_env IS NULL;
    ALTER TABLE tenant_studio.tenant_metadata ALTER COLUMN target_env SET NOT NULL;
    ALTER TABLE tenant_studio.tenant_metadata DROP CONSTRAINT IF EXISTS tenant_metadata_pkey;
    ALTER TABLE tenant_studio.tenant_metadata ADD PRIMARY KEY (target_env, tenant_id);
    INSERT INTO tenant_studio.tenant_metadata
      (target_env, tenant_id, group_id, client_name, client_code, environment, tags, notes, created_at, updated_at)
    SELECT ${legacyEnv}, tenant_id, group_id, client_name, client_code, ${legacyEnv}, tags, notes, created_at, updated_at
    FROM tenant_studio.tenant_metadata
    WHERE target_env <> ${legacyEnv}
    ON CONFLICT (target_env, tenant_id) DO NOTHING;
    UPDATE tenant_studio.tenant_metadata SET environment = target_env;
  `);
  console.log("🌐 tenant_metadata dipisah per target env.");
}
