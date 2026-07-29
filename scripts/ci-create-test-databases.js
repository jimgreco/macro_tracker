const { Client } = require('pg');

const databaseNames = process.argv.slice(2);
const adminUrl = process.env.CI_POSTGRES_ADMIN_URL;

if (!adminUrl) {
  throw new Error('CI_POSTGRES_ADMIN_URL is required.');
}
if (!databaseNames.length) {
  throw new Error('Pass at least one disposable database name.');
}
for (const name of databaseNames) {
  if (!/^[a-z][a-z0-9_]*(?:_ci|_test)$/.test(name)) {
    throw new Error(`Unsafe CI database name: ${name}`);
  }
}

async function main() {
  const client = new Client({
    connectionString: adminUrl,
    ssl: undefined
  });
  await client.connect();
  try {
    for (const name of databaseNames) {
      const existing = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [name]
      );
      if (existing.rowCount) {
        throw new Error(`Disposable database already exists: ${name}`);
      }
      await client.query(`CREATE DATABASE "${name}"`);
      process.stdout.write(`created ${name}\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
