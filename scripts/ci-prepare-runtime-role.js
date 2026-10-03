// Synthetic CI only: grant a NOLOGIN role access to the already-tested fixture.
async function main() {
  const url = new URL(process.env.CI_POSTGRES_ADMIN_URL || '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('CI runtime setup requires a disposable local _test database.');
  }
  process.env.DATABASE_URL = url.href;
  const db = require('../src/db');
  try {
    await require('../src/schema-contract').migrateSchema(db.getPool(), db.initDb, { adoptExisting: true });
    await db.getPool().query('CREATE ROLE macro_tracker_ci_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    await db.getPool().query('GRANT USAGE ON SCHEMA public TO macro_tracker_ci_runtime');
    const { rows } = await db.getPool().query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of rows) {
      const name = '"' + tablename.replace(/"/g, '""') + '"';
      const privileges = ['schema_migrations', 'app_schema_versions'].includes(tablename) ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE';
      await db.getPool().query(`GRANT ${privileges} ON public.${name} TO macro_tracker_ci_runtime`);
    }
    await db.getPool().query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO macro_tracker_ci_runtime');
  } finally { await db.getPool().end(); }
}
main().catch(() => { console.error('Synthetic runtime role setup failed.'); process.exitCode = 1; });
