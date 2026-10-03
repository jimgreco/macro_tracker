// Reuse product persistence journeys with a pre-migrated least-privilege role.
// The ordinary integration run still exercises fresh schema initialization.
async function initializeTestSchema(db) {
  if (process.env.TEST_RUNTIME_ONLY === 'true') {
    const { rows } = await db.getPool().query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    if (Object.values(rows[0]).some(Boolean)) throw new Error('Runtime tests require a role without elevated attributes');
    await require('../../src/schema-contract').assertSchemaCompatible(db.getPool());
  } else {
    await db.initDb();
  }
}
function createObserverPool(runtimeUrl) {
  const observerUrl = process.env.TEST_OBSERVER_DATABASE_URL || runtimeUrl;
  const runtime = new URL(runtimeUrl);
  const observer = new URL(observerUrl);
  if (observerUrl !== runtimeUrl &&
      (observer.pathname !== runtime.pathname || !['localhost', '127.0.0.1'].includes(observer.hostname) || !/_test$/.test(observer.pathname))) {
    throw new Error('The fault-injection observer must use the same disposable local _test database.');
  }
  return new (require('pg').Pool)({ connectionString: observerUrl, ssl: false });
}
module.exports = { initializeTestSchema, createObserverPool };
