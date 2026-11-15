const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const {
  HEALTH_METRICS,
  HEALTH_METRIC_IDS,
  HEALTH_METRICS_SCHEMA_VERSION,
  createHealthMetricsStore,
  healthMetricIdsForSchemaVersion,
  healthMetricsWindow,
  normalizeHealthMetricsPayload,
  pivotHealthRows,
  summarizeHealthRows,
  summarizeWeeklyHealthRows,
  widenHealthMetricsCheck
} = require('../src/health-metrics');
const {
  assertSchemaCompatible, detectOptionalFeature, detectOptionalFeatureVersion, featureLedgerVersions
} = require('../src/schema-contract');
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
const checkRow = feature.objects.find((row) => row.kind === 'constraint' && row.name.includes('CHECK'));
const V3_IDS = ['steps', 'active_energy_kcal', 'exercise_minutes', 'resting_heart_rate_bpm', 'hrv_sdnn_ms', 'vo2max_ml_kg_min'];
const NEW_IDS = ['walking_running_distance_m', 'flights_climbed', 'walking_speed_mps', 'walking_step_length_m',
  'heart_rate_avg_bpm', 'heart_rate_min_bpm', 'respiratory_rate_brpm', 'oxygen_saturation_pct'];

function catalogQueryable(objects) {
  return { query: async (sql) => ({ rows: sql.startsWith('SELECT version') ? [{ version: contract.version }] : objects }) };
}

// The feature exactly as production has it today (ledger v3): every current
// object, with the version-3 CHECK in place of the current one.
const v3FeatureObjects = feature.objects.map((row) => (row === checkRow
  ? { kind: row.kind, name: row.alternatives[0].name, definition: row.alternatives[0].definition }
  : row));

test('metric catalog covers both groups and the table CHECK constraint lists every id', () => {
  assert.deepEqual(HEALTH_METRIC_IDS, [...V3_IDS, ...NEW_IDS]);
  assert.deepEqual([...new Set(Object.values(HEALTH_METRICS).map((metric) => metric.group))], ['activity', 'heart']);
  assert.deepEqual(NEW_IDS.map((id) => HEALTH_METRICS[id].group),
    ['activity', 'activity', 'activity', 'activity', 'heart', 'heart', 'heart', 'heart']);
  const listed = (name) => [...name.matchAll(/'([a-z0-9_]+)'::text/g)].map((match) => match[1]);
  assert.deepEqual(listed(checkRow.name), HEALTH_METRIC_IDS);
  // The previous (production v3) CHECK is the one accepted alternative.
  assert.equal(checkRow.alternatives.length, 1);
  assert.equal(checkRow.alternatives[0].version, 3);
  assert.deepEqual(listed(checkRow.alternatives[0].name), V3_IDS);
  assert.deepEqual(healthMetricIdsForSchemaVersion(3), V3_IDS);
  assert.deepEqual(healthMetricIdsForSchemaVersion(4), HEALTH_METRIC_IDS);
  assert.deepEqual(healthMetricIdsForSchemaVersion(0), []);
  assert.equal(HEALTH_METRICS_SCHEMA_VERSION, feature.version);
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
  assert.equal(await detectOptionalFeatureVersion(catalogQueryable(partial), 'health_daily_metrics'), null);
  assert.equal(await detectOptionalFeature(catalogQueryable([...contract.objects, ...feature.objects]), 'health_daily_metrics'), true);
  // The required contract version is unchanged so the old ledger still passes.
  assert.equal(contract.version, 2);
  assert.equal(feature.version, 4);
  assert.equal(feature.migration, 'npm run db:migrate:health-metrics-v2');
});

test('production v3 structure still starts this release and reports version 3; v4 reports 4', async () => {
  const v3 = catalogQueryable([...contract.objects, ...v3FeatureObjects]);
  assert.deepEqual(await assertSchemaCompatible(v3), { features: { health_daily_metrics: true } });
  assert.equal(await detectOptionalFeatureVersion(v3, 'health_daily_metrics'), 3);
  const v4 = catalogQueryable([...contract.objects, ...feature.objects]);
  assert.equal(await detectOptionalFeatureVersion(v4, 'health_daily_metrics'), 4);
  assert.equal(await detectOptionalFeatureVersion(catalogQueryable(contract.objects), 'health_daily_metrics'), null);
  // Both CHECKs at once (an interrupted manual edit) still reads as v4 structure
  // for the contract, and widenHealthMetricsCheck later drops the stale one.
  const both = catalogQueryable([...contract.objects, ...feature.objects, v3FeatureObjects.find((row) => row.kind === 'constraint' && row.name.includes('CHECK'))]);
  assert.equal(await detectOptionalFeatureVersion(both, 'health_daily_metrics'), 4);
  // An unreviewed CHECK (neither list) is drift and fails startup.
  const drifted = [...contract.objects, ...feature.objects.filter((row) => row !== checkRow),
    { kind: 'constraint', name: "health_daily_metrics:CHECK ((metric = ANY (ARRAY['steps'::text])))", definition: 'true' }];
  await assert.rejects(assertSchemaCompatible(catalogQueryable(drifted)), /incompatible/);
  assert.equal(await detectOptionalFeatureVersion(catalogQueryable(drifted), 'health_daily_metrics'), null);
  assert.deepEqual(featureLedgerVersions(feature, 4), [3, 4]);
  assert.deepEqual(featureLedgerVersions(feature, 3), [3]);
});

test('feature probe caches success and re-probes absence at most once a minute', async () => {
  let clock = 0;
  let present = false;
  let probes = 0;
  const store = createHealthMetricsStore({}, { detect: async () => { probes += 1; return present; }, now: () => clock });
  assert.equal(await store.isHealthMetricsAvailable(), false);
  assert.deepEqual(await store.healthMetricIdsAccepted(), []);
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

test('feature probe on the v3 structure accepts only v3 ids and widens within a minute of the migration', async () => {
  let clock = 0;
  let version = 3;
  let probes = 0;
  const store = createHealthMetricsStore({}, { detect: async () => { probes += 1; return version; }, now: () => clock });
  assert.equal(await store.isHealthMetricsAvailable(), true);
  assert.deepEqual(await store.healthMetricIdsAccepted(), V3_IDS);
  version = 4; // owner ran db:migrate:health-metrics-v2
  clock = 30_000;
  assert.deepEqual(await store.healthMetricIdsAccepted(), V3_IDS);
  assert.equal(probes, 1);
  clock = 61_000;
  assert.deepEqual(await store.healthMetricIdsAccepted(), HEALTH_METRIC_IDS);
  // The current version is cached for good.
  version = null;
  clock = 10_000_000;
  assert.deepEqual(await store.healthMetricIdsAccepted(), HEALTH_METRIC_IDS);
  assert.equal(probes, 2);
  store.setHealthMetricsAvailable(false);
  assert.equal(await store.isHealthMetricsAvailable(), false);
  store.setHealthMetricsAvailable(3);
  assert.deepEqual(await store.healthMetricIdsAccepted(), V3_IDS);
  store.setHealthMetricsAvailable(true);
  assert.deepEqual(await store.healthMetricIdsAccepted(), HEALTH_METRIC_IDS);
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

test('new metrics validate their reviewed bounds and groups', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const accepts = (metric, value) => normalizeHealthMetricsPayload(
    { source: 'healthkit', days: [{ date: '2026-11-14', metric, value }] }, { now }).items[0];
  const bounds = {
    walking_running_distance_m: [0, 200000],
    flights_climbed: [0, 2000],
    walking_speed_mps: [0, 5],
    walking_step_length_m: [0, 3],
    heart_rate_avg_bpm: [20, 250],
    heart_rate_min_bpm: [20, 250],
    respiratory_rate_brpm: [4, 60],
    oxygen_saturation_pct: [50, 100]
  };
  for (const [metric, [min, max]] of Object.entries(bounds)) {
    assert.equal(accepts(metric, min).value, min, metric);
    assert.equal(accepts(metric, max).value, max, metric);
    assert.equal(accepts(metric, max).group, HEALTH_METRICS[metric].group);
    assert.throws(() => accepts(metric, max + 0.01), new RegExp(`from ${min} to ${max}`), metric);
    if (min > 0) assert.throws(() => accepts(metric, min - 0.01), /days\[0\]\.value/, metric);
    assert.throws(() => accepts(metric, -1), /days\[0\]\.value/, metric);
  }
  // SpO2 arrives as a percentage; a HealthKit fraction (0.97) is out of range.
  assert.throws(() => accepts('oxygen_saturation_pct', 0.97), /from 50 to 100/);
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
    avgRestingHeartRate: 60, avgHrvMs: null, latestVo2Max: 40.1,
    avgWalkingRunningDistanceM: null, avgFlightsClimbed: null, avgWalkingSpeedMps: null,
    avgWalkingStepLengthM: null, avgHeartRateAvgBpm: null, avgHeartRateMinBpm: null,
    lowestHeartRateMinBpm: null, avgRespiratoryRateBrpm: null, avgOxygenSaturationPct: null
  });
  assert.deepEqual(pivotHealthRows(rows).map((day) => day.day), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  assert.equal(pivotHealthRows(rows)[1].steps, 1000);
  assert.deepEqual(summarizeHealthRows([]).daysWithData, 0);
});

test('new metrics pivot to camelCase day fields and summarize as daily means', () => {
  const rows = [
    { day: '2026-11-10', metric: 'walking_running_distance_m', value: 5000.4 },
    { day: '2026-11-11', metric: 'walking_running_distance_m', value: 7000 },
    { day: '2026-11-10', metric: 'flights_climbed', value: 9 },
    { day: '2026-11-11', metric: 'flights_climbed', value: 12 },
    { day: '2026-11-10', metric: 'walking_speed_mps', value: 1.344 },
    { day: '2026-11-10', metric: 'walking_step_length_m', value: 0.7249 },
    { day: '2026-11-10', metric: 'heart_rate_avg_bpm', value: 71.26 },
    { day: '2026-11-11', metric: 'heart_rate_avg_bpm', value: 69 },
    { day: '2026-11-10', metric: 'heart_rate_min_bpm', value: 48 },
    { day: '2026-11-11', metric: 'heart_rate_min_bpm', value: 51 },
    { day: '2026-11-10', metric: 'respiratory_rate_brpm', value: 14.26 },
    { day: '2026-11-11', metric: 'oxygen_saturation_pct', value: 96.54 }
  ];
  const [first, second] = pivotHealthRows(rows);
  assert.deepEqual(first, {
    day: '2026-11-10', steps: null, activeEnergyKcal: null, exerciseMinutes: null,
    restingHeartRate: null, hrvMs: null, vo2max: null,
    walkingRunningDistanceM: 5000, flightsClimbed: 9, walkingSpeedMps: 1.34, walkingStepLengthM: 0.72,
    heartRateAvgBpm: 71.3, heartRateMinBpm: 48, respiratoryRateBrpm: 14.3, oxygenSaturationPct: null
  });
  assert.equal(second.oxygenSaturationPct, 96.5);
  const summary = summarizeHealthRows(rows);
  assert.equal(summary.daysWithData, 2);
  assert.equal(summary.avgWalkingRunningDistanceM, 6000);
  assert.equal(summary.avgFlightsClimbed, 10.5);
  assert.equal(summary.avgWalkingSpeedMps, 1.34);
  assert.equal(summary.avgWalkingStepLengthM, 0.72);
  assert.equal(summary.avgHeartRateAvgBpm, 70.1);
  assert.equal(summary.avgHeartRateMinBpm, 49.5);
  assert.equal(summary.lowestHeartRateMinBpm, 48);
  assert.equal(summary.avgRespiratoryRateBrpm, 14.3);
  assert.equal(summary.avgOxygenSaturationPct, 96.5);
  // Weekly summary: original keys plus US units (miles, mph).
  assert.deepEqual(summarizeWeeklyHealthRows(rows), {
    daysWithData: 2, avgSteps: null, avgActiveEnergyKcal: null, avgExerciseMinutes: null,
    avgRestingHeartRate: null, avgHrvMs: null, latestVo2Max: null,
    avgDistanceMiles: 3.7, avgFlightsClimbed: 11, avgWalkingSpeedMph: 3,
    avgHeartRateBpm: 70, avgLowestHeartRateBpm: 50, avgRespiratoryRate: 14.3, avgOxygenSaturationPct: 97
  });
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
  const present = buildMacrosSummary({ ...base, health: [
    { day: '2026-11-08', metric: 'steps', value: 5000 },
    { day: '2026-11-08', metric: 'walking_running_distance_m', value: 4828 },
    { day: '2026-11-01', metric: 'walking_running_distance_m', value: 3219 },
    { day: '2026-11-08', metric: 'heart_rate_avg_bpm', value: 70 },
    { day: '2026-11-01', metric: 'heart_rate_avg_bpm', value: 73 }
  ] }, range);
  assert.equal(present.current.health.avgSteps, 5000);
  assert.equal(present.current.health.avgDistanceMiles, 3);
  assert.equal(present.previous.health.avgDistanceMiles, 2);
  assert.equal(present.previous.health.daysWithData, 1);
  assert.deepEqual(Object.keys(present.current.health), ['daysWithData', 'avgSteps', 'avgActiveEnergyKcal',
    'avgExerciseMinutes', 'avgRestingHeartRate', 'avgHrvMs', 'latestVo2Max', 'avgDistanceMiles', 'avgFlightsClimbed',
    'avgWalkingSpeedMph', 'avgHeartRateBpm', 'avgLowestHeartRateBpm', 'avgRespiratoryRate', 'avgOxygenSaturationPct']);
  assert.deepEqual(present.change.health, {
    avgSteps: null, avgRestingHeartRate: null, avgHrvMs: null, avgDistanceMiles: 1, avgHeartRateBpm: -3
  });
});

test('widening the metric CHECK replaces only the reviewed v3 constraint and is idempotent', async () => {
  const v3Def = "CHECK ((metric = ANY (ARRAY[" + V3_IDS.map((id) => `'${id}'::text`).join(', ') + '])))';
  const v4Def = "CHECK ((metric = ANY (ARRAY[" + HEALTH_METRIC_IDS.map((id) => `'${id}'::text`).join(', ') + '])))';
  const fake = (constraints) => {
    const statements = [];
    return {
      statements,
      query: async (sql) => {
        if (sql.includes('FROM pg_constraint')) return { rows: constraints };
        statements.push(sql);
        return { rows: [] };
      }
    };
  };
  const legacy = fake([{ conname: 'health_daily_metrics_metric_check', definition: v3Def }]);
  assert.equal(await widenHealthMetricsCheck(legacy), true);
  assert.equal(legacy.statements.length, 2);
  assert.match(legacy.statements[0], /DROP CONSTRAINT "health_daily_metrics_metric_check"$/);
  assert.match(legacy.statements[1], /ADD CONSTRAINT health_daily_metrics_metric_check CHECK \(metric IN \('steps'/);
  for (const id of NEW_IDS) assert.ok(legacy.statements[1].includes(`'${id}'`), id);
  const current = fake([{ conname: 'health_daily_metrics_metric_check', definition: v4Def }]);
  assert.equal(await widenHealthMetricsCheck(current), false);
  assert.deepEqual(current.statements, []);
  const both = fake([{ conname: 'a', definition: v3Def }, { conname: 'b', definition: v4Def }]);
  assert.equal(await widenHealthMetricsCheck(both), true);
  assert.deepEqual(both.statements, ['ALTER TABLE public.health_daily_metrics DROP CONSTRAINT "a"']);
  await assert.rejects(widenHealthMetricsCheck(fake([{ conname: 'x', definition: "CHECK ((metric = 'steps'::text))" }])),
    /unreviewed CHECK/);
  await assert.rejects(widenHealthMetricsCheck(fake([
    { conname: 'x', definition: v3Def }, { conname: 'y', definition: 'CHECK ((value >= (0)::double precision))' }
  ])), /unreviewed CHECK/);
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
  assert.equal(catalog.find((item) => item.id === 'activity').detail,
    'Import daily steps, walking and running distance, flights climbed, walking speed and step length, active energy and exercise minutes from Apple Health.');
  assert.equal(catalog.find((item) => item.id === 'heart').detail,
    'Import daily heart rate (average and lowest), resting heart rate, heart rate variability, respiratory rate, blood oxygen and VO₂ max from Apple Health.');

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
  // A fresh schema is version 4: every new metric id is accepted.
  assert.equal(await db.isHealthMetricsAvailable(), true);
  assert.deepEqual(await db.healthMetricIdsAccepted(), HEALTH_METRIC_IDS);
  assert.equal(await db.upsertHealthDailyMetrics(userId, NEW_IDS.map((metric) => item('2026-11-05', metric, 60))), NEW_IDS.length);

  const exported = await db.exportUserData(userId);
  assert.equal(exported.healthDailyMetrics.length, 4 + NEW_IDS.length);
  assert.ok(exported.healthDailyMetrics.every((row) => row.metric && row.local_date));
  await db.deleteUserAccount(otherId);
  const { rows: remaining } = await db.getPool().query('SELECT count(*)::int AS n FROM health_daily_metrics WHERE user_id = $1', [otherId]);
  assert.equal(remaining[0].n, 0);
});

test('explicit health metrics migrations upgrade v2 -> v3 -> v4 and replay as no-ops', {
  skip: !process.env.TEST_DATABASE_URL
}, async (t) => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  t.after(async () => { client.release(); await pool.end(); });
  if (process.env.TEST_RUNTIME_ONLY === 'true') {
    // The least-privilege runtime only validates; it can never run this DDL.
    assert.deepEqual(await assertSchemaCompatible(client), { features: { health_daily_metrics: true } });
    assert.equal(await detectOptionalFeatureVersion(client, 'health_daily_metrics'), 4);
    await assert.rejects(require('../scripts/migrate-health-metrics').migrate(client));
    await assert.rejects(require('../scripts/migrate-health-metrics-v2').migrate(client));
    return;
  }
  const { migrate } = require('../scripts/migrate-health-metrics');
  const v2 = require('../scripts/migrate-health-metrics-v2');
  const ledger = async () => (await client.query("SELECT version FROM app_schema_versions WHERE app = 'macros' ORDER BY version"))
    .rows.map((row) => row.version).filter((version) => version >= 2);
  const markers = async () => (await client.query(
    "SELECT name FROM schema_migrations WHERE name LIKE '2026-11-15_health_daily_metrics%' ORDER BY name")).rows.map((row) => row.name);
  const insertMetric = (metric) => client.query(
    "INSERT INTO health_daily_metrics (user_id, local_date, metric, value) VALUES ('migration-probe', '2026-11-05', $1, 60)", [metric]);
  // Everything happens inside one transaction that is rolled back.
  await client.query('BEGIN');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.app_schema_versions (
      app TEXT NOT NULL, version INTEGER NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (app, version))`);
    await client.query("INSERT INTO app_schema_versions (app, version) VALUES ('macros', 2) ON CONFLICT DO NOTHING");
    await client.query('DROP TABLE health_daily_metrics');
    await client.query("DELETE FROM app_schema_versions WHERE app = 'macros' AND version IN (3, 4)");
    await client.query("DELETE FROM schema_migrations WHERE name LIKE '2026-11-15_health_daily_metrics%'");
    // The previous production schema still passes the startup check, feature off.
    assert.deepEqual(await assertSchemaCompatible(client), { features: { health_daily_metrics: false } });

    // v3: the structure production has today. This release starts on it.
    await migrate(client, { transaction: false });
    assert.deepEqual(await assertSchemaCompatible(client), { features: { health_daily_metrics: true } });
    assert.equal(await detectOptionalFeatureVersion(client, 'health_daily_metrics'), 3);
    await migrate(client, { transaction: false });
    assert.deepEqual(await ledger(), [2, 3]);
    assert.deepEqual(await markers(), ['2026-11-15_health_daily_metrics']);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM health_daily_metrics')).rows[0].n, 0);
    await client.query('SAVEPOINT v3_insert');
    await assert.rejects(insertMetric('heart_rate_avg_bpm'), /check constraint/);
    await client.query('ROLLBACK TO SAVEPOINT v3_insert');
    await insertMetric('steps');
    const owner = (await client.query(
      "SELECT pg_get_userbyid(relowner) AS owner, relacl::text AS acl FROM pg_class WHERE oid = 'public.health_daily_metrics'::regclass")).rows[0];

    // v4: widens the CHECK on the same table; owner, grants and rows unchanged.
    assert.deepEqual(await v2.migrate(client, { transaction: false }), { changed: true });
    assert.deepEqual(await assertSchemaCompatible(client), { features: { health_daily_metrics: true } });
    assert.equal(await detectOptionalFeatureVersion(client, 'health_daily_metrics'), 4);
    for (const metric of NEW_IDS) await insertMetric(metric);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM health_daily_metrics')).rows[0].n, 1 + NEW_IDS.length);
    assert.deepEqual((await client.query(
      "SELECT pg_get_userbyid(relowner) AS owner, relacl::text AS acl FROM pg_class WHERE oid = 'public.health_daily_metrics'::regclass")).rows[0], owner);
    const checks = await client.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'public.health_daily_metrics'::regclass AND contype = 'c'");
    assert.deepEqual(checks.rows.map((row) => row.conname), ['health_daily_metrics_metric_check']);

    // Replays are validated no-ops.
    assert.deepEqual(await v2.migrate(client, { transaction: false }), { changed: false });
    await migrate(client, { transaction: false });
    assert.equal(await detectOptionalFeatureVersion(client, 'health_daily_metrics'), 4);
    assert.deepEqual(await ledger(), [2, 3, 4]);
    assert.deepEqual(await markers(), ['2026-11-15_health_daily_metrics', v2.MIGRATION_NAME]);

    // From no table at all, v2 alone runs the v3 step first.
    await client.query('DROP TABLE health_daily_metrics');
    await client.query("DELETE FROM app_schema_versions WHERE app = 'macros' AND version IN (3, 4)");
    assert.deepEqual(await v2.migrate(client, { transaction: false }), { changed: true });
    assert.equal(await detectOptionalFeatureVersion(client, 'health_daily_metrics'), 4);
    assert.deepEqual(await ledger(), [2, 3, 4]);
  } finally {
    await client.query('ROLLBACK');
  }
});
