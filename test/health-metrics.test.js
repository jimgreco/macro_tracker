const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const {
  HEALTH_METRICS,
  HEALTH_METRIC_IDS,
  createHealthMetricsStore,
  healthMetricsWindow,
  normalizeHealthMetricsPayload,
  pivotHealthRows,
  summarizeHealthRows
} = require('../src/health-metrics');
const { assertSchemaCompatible, detectOptionalFeature } = require('../src/schema-contract');
const contract = require('../src/schema-contract.json');
const { buildMacrosSummary, parseWeekParam } = require('../src/weekly-summary');
const {
  SOURCE_IDS,
  buildSourceAccess,
  isIntegrationAccessEnabled,
  normalizeAccessSelection,
  sourceCatalog
} = require('../src/integration-access');

const feature = contract.optionalFeatures.find((item) => item.name === 'health_daily_metrics');

function catalogQueryable(objects) {
  return { query: async (sql) => ({ rows: sql.startsWith('SELECT version') ? [{ version: contract.version }] : objects }) };
}

test('metric catalog covers both groups and the table CHECK constraint lists every id', () => {
  assert.deepEqual(HEALTH_METRIC_IDS, ['steps', 'active_energy_kcal', 'exercise_minutes',
    'resting_heart_rate_bpm', 'hrv_sdnn_ms', 'vo2max_ml_kg_min']);
  assert.deepEqual([...new Set(Object.values(HEALTH_METRICS).map((metric) => metric.group))], ['activity', 'heart']);
  const check = feature.objects.find((row) => row.kind === 'constraint' && row.name.includes('CHECK'));
  for (const id of HEALTH_METRIC_IDS) assert.ok(check.name.includes(`'${id}'::text`), id);
});

test('startup schema check passes with the optional table absent and refuses partial structure', async () => {
  // Old production schema: required objects only.
  assert.deepEqual(await assertSchemaCompatible(catalogQueryable(contract.objects)), {
    features: { health_daily_metrics: false }
  });
  assert.deepEqual(await assertSchemaCompatible(catalogQueryable([...contract.objects, ...feature.objects])), {
    features: { health_daily_metrics: true }
  });
  const partial = [...contract.objects, ...feature.objects.filter((row) => row.kind !== 'index')];
  await assert.rejects(assertSchemaCompatible(catalogQueryable(partial)), /incompatible/);
  assert.equal(await detectOptionalFeature(catalogQueryable(partial), 'health_daily_metrics'), false);
  assert.equal(await detectOptionalFeature(catalogQueryable([...contract.objects, ...feature.objects]), 'health_daily_metrics'), true);
  // The required contract version is unchanged so the old ledger still passes.
  assert.equal(contract.version, 2);
  assert.equal(feature.version, 3);
});

test('feature probe caches success and re-probes absence at most once a minute', async () => {
  let clock = 0;
  let present = false;
  let probes = 0;
  const store = createHealthMetricsStore({}, { detect: async () => { probes += 1; return present; }, now: () => clock });
  assert.equal(await store.isHealthMetricsAvailable(), false);
  present = true;
  clock = 59_000;
  assert.equal(await store.isHealthMetricsAvailable(), false);
  assert.equal(probes, 1);
  clock = 61_000;
  assert.equal(await store.isHealthMetricsAvailable(), true);
  clock = 10_000_000;
  present = false;
  assert.equal(await store.isHealthMetricsAvailable(), true);
  assert.equal(probes, 2);
  const failing = createHealthMetricsStore({}, { detect: async () => { throw new Error('boom'); } });
  assert.equal(await failing.isHealthMetricsAvailable(), false);
});

test('payload validation dedupes to the last value per metric and day', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const result = normalizeHealthMetricsPayload({
    source: 'healthkit',
    days: [
      { date: '2026-11-14', metric: 'steps', value: 100 },
      { date: '2026-11-14', metric: 'hrv_sdnn_ms', value: 0, sampleCount: 0 },
      { date: '2026-11-14', metric: 'steps', value: 200, sampleCount: 3 },
      { date: '2026-11-16', metric: 'vo2max_ml_kg_min', value: 42.1 },
      { date: '2025-10-11', metric: 'exercise_minutes', value: 1440 }
    ]
  }, { now });
  assert.deepEqual(result.items.map((item) => [item.metric, item.date, item.value, item.sampleCount, item.group]), [
    ['hrv_sdnn_ms', '2026-11-14', 0, 0, 'heart'],
    ['steps', '2026-11-14', 200, 3, 'activity'],
    ['vo2max_ml_kg_min', '2026-11-16', 42.1, null, 'heart'],
    ['exercise_minutes', '2025-10-11', 1440, null, 'activity']
  ]);
  for (const days of [
    [{ date: '2026-11-17', metric: 'steps', value: 1 }],
    [{ date: '2025-10-10', metric: 'steps', value: 1 }],
    [{ date: '2026-11-14', metric: 'steps', value: Infinity }],
    [{ date: '2026-11-14', metric: 'resting_heart_rate_bpm', value: 251 }],
    [{ date: '2026-11-14', metric: 'steps', value: 1, sampleCount: -1 }],
    [{ date: '2026-11-14', metric: '__proto__', value: 1 }],
    [null]
  ]) {
    assert.throws(() => normalizeHealthMetricsPayload({ source: 'healthkit', days }, { now }), /days\[0\]/);
  }
});

test('summaries average over days that have each metric and use the latest VO2 max', () => {
  const rows = [
    { day: '2026-11-10', metric: 'steps', value: 1000.4 },
    { day: '2026-11-11', metric: 'steps', value: 2000 },
    { day: '2026-11-11', metric: 'resting_heart_rate_bpm', value: 60.04 },
    { day: '2026-11-12', metric: 'vo2max_ml_kg_min', value: 40.06 },
    { day: '2026-11-09', metric: 'vo2max_ml_kg_min', value: 39 }
  ];
  assert.deepEqual(summarizeHealthRows(rows), {
    daysWithData: 4, avgSteps: 1500, avgActiveEnergyKcal: null, avgExerciseMinutes: null,
    avgRestingHeartRate: 60, avgHrvMs: null, latestVo2Max: 40.1
  });
  assert.deepEqual(pivotHealthRows(rows).map((day) => day.day), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  assert.equal(pivotHealthRows(rows)[1].steps, 1000);
  assert.deepEqual(summarizeHealthRows([]).daysWithData, 0);
});

test('windows end today in the requested timezone and the previous window has equal length', () => {
  const now = new Date('2026-11-15T03:00:00Z'); // Nov 14 evening in New York
  assert.deepEqual(healthMetricsWindow('week', 'America/New_York', now), {
    current: { start: '2026-11-08', end: '2026-11-14' },
    previous: { start: '2026-11-01', end: '2026-11-07' }
  });
  const year = healthMetricsWindow('year', 'UTC', now);
  assert.deepEqual(year.current, { start: '2025-11-16', end: '2026-11-15' });
  assert.equal(year.previous.end, '2025-11-15');
  assert.equal(healthMetricsWindow('month', 'UTC', now).current.start, '2026-10-17');
});

test('weekly summary health is null before migration and present after', () => {
  const range = parseWeekParam('2026-11-02');
  const base = { user: { id: 'u' }, totals: [], states: {}, weights: [], waists: [], sleep: [], targets: {} };
  const absent = buildMacrosSummary({ ...base, health: null }, range);
  assert.equal(absent.current.health, null);
  assert.equal(absent.previous.health, null);
  assert.equal(absent.change.health, null);
  assert.equal(absent.current.avgSteps, null);
  const present = buildMacrosSummary({ ...base, health: [{ day: '2026-11-08', metric: 'steps', value: 5000 }] }, range);
  assert.equal(present.current.health.avgSteps, 5000);
  assert.equal(present.previous.health.daysWithData, 0);
  assert.deepEqual(present.change.health, { avgSteps: null, avgRestingHeartRate: null, avgHrvMs: null });
});

test('HealthKit Activity and Heart are optional read-only catalog types', () => {
  const catalog = sourceCatalog(SOURCE_IDS.HEALTHKIT);
  assert.deepEqual(catalog.map((dataType) => dataType.id), ['workouts', 'weight', 'sleep', 'activity', 'heart']);
  assert.equal(sourceCatalog(SOURCE_IDS.HEALTHKIT, { sexualActivityEnabled: true }).length, 6);
  for (const id of ['activity', 'heart']) {
    const dataType = catalog.find((item) => item.id === id);
    assert.equal(dataType.optional, true);
    assert.equal(dataType.read.supported, true);
    assert.equal(dataType.write.supported, false);
    assert.equal(dataType.write.disabledReason, "Macrovana reads these from Apple Health and doesn't write them back.");
  }
  assert.equal(catalog.find((item) => item.id === 'activity').displayName, 'Activity');
  assert.equal(catalog.find((item) => item.id === 'heart').detail,
    'Import daily resting heart rate, heart rate variability and VO₂ max from Apple Health.');

  const legacyPermissions = ['workouts', 'weight', 'sleep'].map((dataType) => ({ dataType, readEnabled: true, writeEnabled: true }));
  const source = buildSourceAccess({ id: SOURCE_IDS.HEALTHKIT, displayName: 'Apple Health', connected: true, available: true,
    permissions: legacyPermissions });
  assert.equal(source.configurationRequired, false);
  assert.equal(isIntegrationAccessEnabled(legacyPermissions, 'activity', 'read'), false);
  assert.equal(isIntegrationAccessEnabled(legacyPermissions, 'heart', 'read'), false);
  // Missing required rows still require configuration even when optional rows exist.
  assert.equal(buildSourceAccess({ id: SOURCE_IDS.HEALTHKIT, displayName: 'Apple Health', connected: true, available: true,
    permissions: [{ dataType: 'activity', readEnabled: true, writeEnabled: false }] }).configurationRequired, true);

  const legacySelection = ['workouts', 'weight', 'sleep'].map((id) => ({ id, readEnabled: false, writeEnabled: false }));
  assert.equal(normalizeAccessSelection(SOURCE_IDS.HEALTHKIT, { dataTypes: legacySelection }).length, 3);
  assert.deepEqual(normalizeAccessSelection(SOURCE_IDS.HEALTHKIT, {
    dataTypes: [...legacySelection, { id: 'heart', readEnabled: true, writeEnabled: false }]
  }).at(-1), { dataType: 'heart', readEnabled: true, writeEnabled: false });
  assert.throws(() => normalizeAccessSelection(SOURCE_IDS.HEALTHKIT, { dataTypes: legacySelection.slice(1) }),
    /Missing healthkit data type selections: workouts\./);
  assert.throws(() => normalizeAccessSelection(SOURCE_IDS.HEALTHKIT, {
    dataTypes: [...legacySelection, { id: 'activity', readEnabled: true, writeEnabled: true }]
  }), /activity write access is not supported/);
  // Other sources are unchanged.
  assert.equal(sourceCatalog(SOURCE_IDS.OURA).some((dataType) => dataType.optional), false);
});

// ── PostgreSQL ──

test('Postgres health metrics upsert, scoping, export/deletion and weekly rows', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  delete require.cache[dbPath];
  const db = require(dbPath);
  const userId = `health-metrics-${crypto.randomUUID()}`;
  const otherId = `${userId}-other`;
  t.after(async () => {
    try {
      await db.deleteUserAccount(userId).catch(() => {});
      await db.deleteUserAccount(otherId).catch(() => {});
    } finally {
      await db.getPool().end();
      delete require.cache[dbPath];
      if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
  await require('./helpers/database').initializeTestSchema(db);
  for (const id of [userId, otherId]) {
    await db.upsertUser({ id, provider: 'local-dev', providerUserId: id, email: `${id}@example.test`, name: 'Health', timezone: 'UTC' });
  }
  assert.equal(await db.isHealthMetricsAvailable(), true);

  const item = (date, metric, value, sampleCount = null) => ({ date, metric, value, sampleCount, externalId: `${metric}:${date}` });
  assert.equal(await db.upsertHealthDailyMetrics(userId, [
    item('2026-11-03', 'steps', 1000, 10), item('2026-11-03', 'hrv_sdnn_ms', 44.5), item('2026-11-04', 'steps', 2000)
  ]), 3);
  // Latest value wins on the live (user, metric, day) row.
  assert.equal(await db.upsertHealthDailyMetrics(userId, [item('2026-11-03', 'steps', 1500, 12)]), 1);
  await db.upsertHealthDailyMetrics(otherId, [item('2026-11-03', 'steps', 99999)]);
  const { rows: live } = await db.getPool().query(
    `SELECT value, sample_count, external_id, source FROM health_daily_metrics
      WHERE user_id = $1 AND metric = 'steps' AND local_date = '2026-11-03' AND deleted_at IS NULL`, [userId]);
  assert.deepEqual(live, [{ value: 1500, sample_count: 12, external_id: 'steps:2026-11-03', source: 'healthkit' }]);

  // A tombstoned row never counts and does not block a new live row.
  await db.getPool().query(`UPDATE health_daily_metrics SET deleted_at = NOW() WHERE user_id = $1 AND metric = 'steps' AND local_date = '2026-11-04'`, [userId]);
  assert.deepEqual(await db.listHealthDailyMetrics(userId, { startDay: '2026-11-01', endDay: '2026-11-08' }), [
    { day: '2026-11-03', metric: 'hrv_sdnn_ms', value: 44.5 },
    { day: '2026-11-03', metric: 'steps', value: 1500 }
  ]);
  await db.upsertHealthDailyMetrics(userId, [item('2026-11-04', 'steps', 2500)]);
  assert.equal((await db.listHealthDailyMetrics(userId, { startDay: '2026-11-04', endDay: '2026-11-04' }))[0].value, 2500);
  await assert.rejects(db.getPool().query(
    `INSERT INTO health_daily_metrics (user_id, local_date, metric, value) VALUES ($1, '2026-11-05', 'daily_activity', 1)`, [userId]));

  const exported = await db.exportUserData(userId);
  assert.equal(exported.healthDailyMetrics.length, 4);
  assert.ok(exported.healthDailyMetrics.every((row) => row.metric && row.local_date));
  await db.deleteUserAccount(otherId);
  const { rows: remaining } = await db.getPool().query('SELECT count(*)::int AS n FROM health_daily_metrics WHERE user_id = $1', [otherId]);
  assert.equal(remaining[0].n, 0);
});

test('explicit health metrics migration upgrades a v2 schema and replays as a no-op', {
  skip: !process.env.TEST_DATABASE_URL
}, async (t) => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  t.after(async () => { client.release(); await pool.end(); });
  if (process.env.TEST_RUNTIME_ONLY === 'true') {
    // The least-privilege runtime only validates; it can never run this DDL.
    assert.deepEqual(await assertSchemaCompatible(client), { features: { health_daily_metrics: true } });
    await assert.rejects(require('../scripts/migrate-health-metrics').migrate(client));
    return;
  }
  const { migrate } = require('../scripts/migrate-health-metrics');
  // Everything happens inside one transaction that is rolled back.
  await client.query('BEGIN');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.app_schema_versions (
      app TEXT NOT NULL, version INTEGER NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (app, version))`);
    await client.query("INSERT INTO app_schema_versions (app, version) VALUES ('macros', 2) ON CONFLICT DO NOTHING");
    await client.query('DROP TABLE health_daily_metrics');
    await client.query("DELETE FROM app_schema_versions WHERE app = 'macros' AND version = 3");
    await client.query("DELETE FROM schema_migrations WHERE name = '2026-11-15_health_daily_metrics'");
    // The previous production schema still passes the startup check, feature off.
    assert.deepEqual(await assertSchemaCompatible(client), { features: { health_daily_metrics: false } });

    await migrate(client, { transaction: false });
    assert.deepEqual(await assertSchemaCompatible(client), { features: { health_daily_metrics: true } });
    await migrate(client, { transaction: false });
    const versions = await client.query("SELECT version FROM app_schema_versions WHERE app = 'macros' ORDER BY version");
    assert.deepEqual(versions.rows.map((row) => row.version).filter((version) => version >= 2), [2, 3]);
    const marker = await client.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '2026-11-15_health_daily_metrics'");
    assert.equal(marker.rows[0].n, 1);
    const empty = await client.query('SELECT count(*)::int AS n FROM health_daily_metrics');
    assert.equal(empty.rows[0].n, 0);
  } finally {
    await client.query('ROLLBACK');
  }
});
