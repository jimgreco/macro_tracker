// Run as a one-shot process with separately supplied migration access.
async function main() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required; runtime credentials are never used as a fallback.');
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--adopt-existing')) throw new Error('Usage: npm run db:migrate -- [--adopt-existing]');
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  const db = require('../src/db');
  try {
    await require('../src/schema-contract').migrateSchema(db.getPool(), db.initDb,
      { adoptExisting: args.includes('--adopt-existing') });
    console.log('Database schema ready.');
  } finally { await db.getPool().end(); }
}
if (require.main === module) main().catch(() => {
  console.error('Schema migration failed. Verify migration access and schema compatibility; existing databases require reviewed --adopt-existing. No server started.');
  process.exitCode = 1;
});
module.exports = { main };
