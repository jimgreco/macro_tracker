// Explicit upgrade for more Apple Health daily metrics (optional feature
// health_daily_metrics, ledger version 4). Replaces the version-3 CHECK on
// health_daily_metrics.metric with the reviewed wider list (distance, flights,
// walking speed/step length, heart rate avg/min, respiratory rate, blood
// oxygen). Same table: no rows are read or rewritten, owner and grants are
// unchanged. One transaction; a replay on an upgraded database is a validated
// no-op. If the table does not exist yet, the version-3 step runs first in the
// same transaction. No runtime credential fallback.
//
// Run it after the release that understands both structures is live: images
// older than that release refuse to start once the CHECK is widened.
const { widenHealthMetricsCheck } = require('../src/health-metrics');

const MIGRATION_NAME = '2026-11-15_health_daily_metrics_more_metrics';
const VERSION = 4;

async function tableOwner(client) {
  const { rows } = await client.query(
    "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = to_regclass('public.health_daily_metrics')"
  );
  return rows[0]?.owner ?? null;
}

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
    // The required contract (with its recorded version) must already hold, and
    // the optional table must be absent, version 3 or version 4 (never drifted).
    const { features } = await contractModule.assertSchemaCompatible(client);
    if (!features.health_daily_metrics) {
      await require('./migrate-health-metrics').migrate(client, { transaction: false });
    }
    const owner = await tableOwner(client);
    const changed = await widenHealthMetricsCheck(client);
    if ((await tableOwner(client)) !== owner) throw new Error('health_daily_metrics owner changed');
    const version = await contractModule.detectOptionalFeatureVersion(client, 'health_daily_metrics');
    if (version !== VERSION) throw new Error('health_daily_metrics is not at version 4 after migration');
    await contractModule.assertSchemaCompatible(client);
    await client.query('INSERT INTO app_schema_versions (app, version) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [contract.app, VERSION]);
    await client.query(`INSERT INTO schema_migrations (name, applied_at) VALUES ($1, NOW())
      ON CONFLICT (name) DO NOTHING`, [MIGRATION_NAME]);
    if (transaction) await client.query('COMMIT');
    return { changed };
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
    const { changed } = await migrate(client);
    console.log(changed
      ? 'Apple Health daily metrics schema v4 upgrade complete; the wider metric list is accepted.'
      : 'Apple Health daily metrics schema is already v4; nothing changed.');
  } finally { client.release(); await pool.end(); }
}
if (require.main === module) main().catch(() => { console.error('Health metrics v2 migration failed; transaction rolled back.'); process.exitCode = 1; });
module.exports = { main, migrate, MIGRATION_NAME };
