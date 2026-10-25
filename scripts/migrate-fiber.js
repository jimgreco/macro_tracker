// Explicit additive upgrade. No runtime credential fallback or historical nutrition rewrites.
async function main() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL required');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('macros:schema'))");
    for (const table of ['entries', 'saved_items', 'food_corrections']) {
      await client.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS fiber DOUBLE PRECISION`);
    }
    await require('../src/schema-contract').assertSchemaCompatible(client, { requireVersion: false });
    await client.query("INSERT INTO app_schema_versions (app, version) VALUES ('macros', 2) ON CONFLICT DO NOTHING");
    await client.query('COMMIT');
    console.log('Fiber schema upgrade complete; existing fiber values remain unknown.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
if (require.main === module) main().catch(() => { console.error('Fiber migration failed; transaction rolled back.'); process.exitCode = 1; });
module.exports = { main };
