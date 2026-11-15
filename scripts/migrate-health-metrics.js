// Explicit additive upgrade for Apple Health daily metrics (optional feature,
// contract optionalFeatures health_daily_metrics, ledger version 3). Creates one
// new empty table; no existing rows are read or rewritten. Idempotent: a replay
// on an upgraded database is a validated no-op. No runtime credential fallback.
const { HEALTH_METRICS_V3_DDL } = require('../src/health-metrics');

// `transaction: false` lets a test run the same steps inside its own
// rollback-only transaction.
async function migrate(client, { transaction = true } = {}) {
  if (transaction) await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('macros:schema'))");
    const contractModule = require('../src/schema-contract');
    const contract = require('../src/schema-contract.json');
    // The required contract (with its recorded version) must already hold.
    await contractModule.assertSchemaCompatible(client);
    await client.query(HEALTH_METRICS_V3_DDL);
    await client.query('ALTER TABLE health_daily_metrics ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    // Reviewed runtime grant, only where the proposed least-privilege role exists.
    await client.query(`DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'macrovana_runtime') THEN
          REVOKE ALL ON public.health_daily_metrics FROM PUBLIC;
          GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_daily_metrics TO macrovana_runtime;
          REVOKE ALL ON SEQUENCE public.health_daily_metrics_id_seq FROM PUBLIC;
          GRANT USAGE ON SEQUENCE public.health_daily_metrics_id_seq TO macrovana_runtime;
        END IF;
      END $$`);
    const { features } = await contractModule.assertSchemaCompatible(client);
    if (!features.health_daily_metrics) throw new Error('health_daily_metrics structure missing after migration');
    // This step is always ledger version 3; db:migrate:health-metrics-v2
    // records version 4 when it widens the metric CHECK.
    await client.query('INSERT INTO app_schema_versions (app, version) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [contract.app, 3]);
    await client.query(`INSERT INTO schema_migrations (name, applied_at) VALUES ('2026-11-15_health_daily_metrics', NOW())
      ON CONFLICT (name) DO NOTHING`);
    if (transaction) await client.query('COMMIT');
  } catch (error) {
    if (transaction) await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL required');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const client = await pool.connect();
  try {
    await migrate(client);
    console.log('Apple Health daily metrics schema upgrade complete; the new table is empty.');
  } finally { client.release(); await pool.end(); }
}
if (require.main === module) main().catch(() => { console.error('Health metrics migration failed; transaction rolled back.'); process.exitCode = 1; });
module.exports = { main, migrate };
