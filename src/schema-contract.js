// This manifest describes structure only; no application rows are read.
const contract = require('./schema-contract.json');
const catalogSQL = require('node:fs').readFileSync(require('node:path').join(__dirname, 'schema-catalog.sql'), 'utf8');

async function assertSchemaCompatible(queryable, { requireVersion = true } = {}) {
  try {
    if (requireVersion) {
      const result = await queryable.query(
        'SELECT version FROM public.app_schema_versions WHERE app = $1 AND version = $2',
        [contract.app, contract.version]);
      if (result.rows.length !== 1) throw new Error('missing compatibility version');
    }
    const actual = new Map((await queryable.query(catalogSQL)).rows.map(row => [row.kind + ':' + row.name, row.definition]));
    if (missingObjects(contract.objects, actual).length) throw new Error('schema structure mismatch');
    return { features: optionalFeatureState(actual) };
  } catch {
    throw new Error('Database schema is incompatible. Run the reviewed migration/adoption command before starting this release.');
  }
}

function missingObjects(objects, actual) {
  return objects.filter(row => ![row, ...(row.alternatives || [])]
    .some(candidate => actual.get(row.kind + ':' + candidate.name) === candidate.definition));
}

// Optional features ship code before their owner-run migration. Each one is
// either entirely absent (feature off, startup still passes) or exactly
// matches its reviewed objects; partial or drifted structure is refused. An
// object may list `alternatives` from an earlier structure version
// (`version` on the alternative): the feature is then on at that older
// version, so code can keep serving it until the next migration runs.
function optionalFeatureVersions(actual) {
  const versions = {};
  for (const feature of contract.optionalFeatures || []) {
    const table = feature.objects.find(row => row.kind === 'table');
    if (!actual.has('table:' + table.name)) {
      versions[feature.name] = null;
      continue;
    }
    if (missingObjects(feature.objects, actual).length) throw new Error('optional feature structure mismatch');
    let version = feature.version;
    for (const row of feature.objects) {
      if (actual.get(row.kind + ':' + row.name) === row.definition) continue;
      const matched = (row.alternatives || [])
        .filter(candidate => actual.get(row.kind + ':' + candidate.name) === candidate.definition)
        .map(candidate => candidate.version ?? feature.version);
      version = Math.min(version, Math.max(...matched));
    }
    versions[feature.name] = version;
  }
  return versions;
}

function optionalFeatureState(actual) {
  return Object.fromEntries(Object.entries(optionalFeatureVersions(actual)).map(([name, version]) => [name, version != null]));
}

async function readCatalog(queryable) {
  return new Map((await queryable.query(catalogSQL)).rows.map(row => [row.kind + ':' + row.name, row.definition]));
}

// Read-only probe for one optional feature; false when absent or drifted.
async function detectOptionalFeature(queryable, name) {
  return (await detectOptionalFeatureVersion(queryable, name)) != null;
}

// Read-only probe: the feature's structure version, or null when absent or drifted.
async function detectOptionalFeatureVersion(queryable, name) {
  try {
    return optionalFeatureVersions(await readCatalog(queryable))[name] ?? null;
  } catch {
    return null;
  }
}

async function migrateSchema(pool, initialize, { adoptExisting = false, validate = async () => {} } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [contract.app + ':schema']);
    const { rows } = await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'");
    if (rows[0].count) {
      if (!adoptExisting) {
        // An already adopted, compatible database is a read-only no-op.
        await assertSchemaCompatible(client);
        await validate(client);
        await client.query('COMMIT');
        return;
      }
      await assertSchemaCompatible(client, { requireVersion: false });
    } else {
      if (adoptExisting) throw new Error('Cannot adopt an empty database');
      await initialize(client);
      await assertSchemaCompatible(client, { requireVersion: false });
    }
    await validate(client);
    await client.query(`CREATE TABLE IF NOT EXISTS public.app_schema_versions (
      app TEXT NOT NULL, version INTEGER NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (app, version))`);
    await client.query('INSERT INTO public.app_schema_versions (app, version) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [contract.app, contract.version]);
    // Fresh initialization creates optional features too; record their versions.
    // Fresh structure includes every earlier step of a feature, so record the
    // structure version found plus the earlier versions it supersedes.
    await assertSchemaCompatible(client, { requireVersion: false });
    const versions = optionalFeatureVersions(await readCatalog(client));
    for (const feature of contract.optionalFeatures || []) {
      const version = versions[feature.name];
      if (version == null) continue;
      for (const recorded of featureLedgerVersions(feature, version)) {
        await client.query('INSERT INTO public.app_schema_versions (app, version) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [contract.app, recorded]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
// Ledger versions implied by a feature at `version`: that version and every
// earlier alternative version it supersedes, ascending.
function featureLedgerVersions(feature, version) {
  const earlier = feature.objects.flatMap(row => (row.alternatives || []).map(candidate => candidate.version))
    .filter(candidate => Number.isInteger(candidate) && candidate < version);
  return [...new Set([...earlier, version])].sort((a, b) => a - b);
}

module.exports = {
  assertSchemaCompatible, detectOptionalFeature, detectOptionalFeatureVersion, featureLedgerVersions,
  migrateSchema, catalogSQL
};
