// Apple Health daily metrics: steps, walking + running distance, flights
// climbed, walking speed and step length, active energy, exercise minutes
// (Activity) and heart rate (daily average and minimum), resting heart rate,
// HRV, respiratory rate, blood oxygen, VO2 max (Heart). Rows are HealthKit daily
// aggregates computed on the device; HealthKit copies written by other apps
// (including the Oura app) are allowed. Direct Oura Cloud API documents never
// land in this table.

const TABLE = 'health_daily_metrics';

// Ledger version of the table structure this code expects (contract
// optionalFeatures health_daily_metrics). Version 3 created the table with a
// CHECK over the first six ids; version 4 (npm run db:migrate:health-metrics-v2)
// widens that CHECK. `since` is the first structure version whose CHECK
// accepts a metric; on an older structure those ids are skipped, never sent.
const HEALTH_METRICS_SCHEMA_VERSION = 4;

// id -> { group (integration data type), min/max (inclusive bounds), since }
const HEALTH_METRICS = Object.freeze({
  steps: Object.freeze({ group: 'activity', min: 0, max: 200000, since: 3 }),
  active_energy_kcal: Object.freeze({ group: 'activity', min: 0, max: 20000, since: 3 }),
  exercise_minutes: Object.freeze({ group: 'activity', min: 0, max: 1440, since: 3 }),
  resting_heart_rate_bpm: Object.freeze({ group: 'heart', min: 0, max: 250, since: 3 }),
  hrv_sdnn_ms: Object.freeze({ group: 'heart', min: 0, max: 1000, since: 3 }),
  vo2max_ml_kg_min: Object.freeze({ group: 'heart', min: 0, max: 100, since: 3 }),
  walking_running_distance_m: Object.freeze({ group: 'activity', min: 0, max: 200000, since: 4 }),
  flights_climbed: Object.freeze({ group: 'activity', min: 0, max: 2000, since: 4 }),
  walking_speed_mps: Object.freeze({ group: 'activity', min: 0, max: 5, since: 4 }),
  walking_step_length_m: Object.freeze({ group: 'activity', min: 0, max: 3, since: 4 }),
  heart_rate_avg_bpm: Object.freeze({ group: 'heart', min: 20, max: 250, since: 4 }),
  heart_rate_min_bpm: Object.freeze({ group: 'heart', min: 20, max: 250, since: 4 }),
  respiratory_rate_brpm: Object.freeze({ group: 'heart', min: 4, max: 60, since: 4 }),
  oxygen_saturation_pct: Object.freeze({ group: 'heart', min: 50, max: 100, since: 4 })
});
const HEALTH_METRIC_IDS = Object.freeze(Object.keys(HEALTH_METRICS));
const HEALTH_METRIC_GROUPS = Object.freeze(['activity', 'heart']);
const MAX_ITEMS = 1000;
const MAX_AGE_DAYS = 400;
const MAX_SAMPLE_COUNT = 1000000;

// Metric ids the table's CHECK accepts at a given structure version.
function healthMetricIdsForSchemaVersion(version) {
  return HEALTH_METRIC_IDS.filter((id) => HEALTH_METRICS[id].since <= version);
}

// The reviewed CHECK on health_daily_metrics.metric at a structure version.
function healthMetricsCheckSql(version) {
  return `CHECK (metric IN (${healthMetricIdsForSchemaVersion(version).map((id) => `'${id}'`).join(', ')}))`;
}
const HEALTH_METRICS_CHECK_SQL = healthMetricsCheckSql(HEALTH_METRICS_SCHEMA_VERSION);

function healthMetricsDdl(checkSql) {
  return `
  CREATE TABLE IF NOT EXISTS health_daily_metrics (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    local_date DATE NOT NULL,
    metric TEXT NOT NULL ${checkSql},
    value DOUBLE PRECISION NOT NULL,
    sample_count INTEGER,
    source TEXT NOT NULL DEFAULT 'healthkit',
    external_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_health_daily_metrics_user_metric_day
    ON health_daily_metrics(user_id, metric, local_date) WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_health_daily_metrics_user_source_external
    ON health_daily_metrics(user_id, source, external_id)
    WHERE external_id IS NOT NULL AND deleted_at IS NULL;
`;
}

// Fresh schema (initDb) creates the current structure directly.
const HEALTH_METRICS_DDL = healthMetricsDdl(HEALTH_METRICS_CHECK_SQL);
// The version-3 structure, created by scripts/migrate-health-metrics.js
// exactly as production has it; scripts/migrate-health-metrics-v2.js then
// widens the CHECK.
const HEALTH_METRICS_V3_DDL = healthMetricsDdl(healthMetricsCheckSql(3));

const SCOPE_DAYS = Object.freeze({ week: 7, month: 30, year: 365 });

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localIsoDay(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// Validates the whole request before any write. Duplicate (metric, date) pairs
// keep the last occurrence, matching "latest value wins".
function normalizeHealthMetricsPayload(body, { now = new Date() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('Request body must be an object.');
  if (body.source !== 'healthkit') throw validationError('source must be "healthkit".');
  const { days } = body;
  if (!Array.isArray(days) || days.length < 1 || days.length > MAX_ITEMS) {
    throw validationError(`days must contain 1 to ${MAX_ITEMS} items.`);
  }
  const todayUtc = now.toISOString().slice(0, 10);
  const latest = addDays(todayUtc, 1);
  const earliest = addDays(todayUtc, -MAX_AGE_DAYS);
  const byKey = new Map();
  days.forEach((item, index) => {
    const where = `days[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw validationError(`${where} must be an object.`);
    const definition = Object.hasOwn(HEALTH_METRICS, item.metric) ? HEALTH_METRICS[item.metric] : null;
    if (!definition) throw validationError(`${where}.metric is not a supported metric.`);
    if (!isCalendarDate(item.date)) throw validationError(`${where}.date must be YYYY-MM-DD.`);
    if (item.date < earliest || item.date > latest) {
      throw validationError(`${where}.date must be within the last ${MAX_AGE_DAYS} days and not in the future.`);
    }
    if (typeof item.value !== 'number' || !Number.isFinite(item.value)
      || item.value < definition.min || item.value > definition.max) {
      throw validationError(`${where}.value must be a number from ${definition.min} to ${definition.max}.`);
    }
    let sampleCount = null;
    if (item.sampleCount != null) {
      if (!Number.isInteger(item.sampleCount) || item.sampleCount < 0 || item.sampleCount > MAX_SAMPLE_COUNT) {
        throw validationError(`${where}.sampleCount must be a non-negative integer.`);
      }
      sampleCount = item.sampleCount;
    }
    const key = `${item.metric}:${item.date}`;
    byKey.delete(key);
    byKey.set(key, {
      date: item.date,
      metric: item.metric,
      group: definition.group,
      value: item.value,
      sampleCount,
      externalId: key
    });
  });
  return { source: 'healthkit', items: [...byKey.values()], received: days.length };
}

function round(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  const xs = values.filter((value) => value != null && Number.isFinite(value));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// Per-day response field and display rounding for each metric id.
const HEALTH_DAY_FIELDS = Object.freeze({
  steps: Object.freeze({ key: 'steps', digits: 0 }),
  active_energy_kcal: Object.freeze({ key: 'activeEnergyKcal', digits: 0 }),
  exercise_minutes: Object.freeze({ key: 'exerciseMinutes', digits: 0 }),
  resting_heart_rate_bpm: Object.freeze({ key: 'restingHeartRate', digits: 1 }),
  hrv_sdnn_ms: Object.freeze({ key: 'hrvMs', digits: 1 }),
  vo2max_ml_kg_min: Object.freeze({ key: 'vo2max', digits: 1 }),
  walking_running_distance_m: Object.freeze({ key: 'walkingRunningDistanceM', digits: 0 }),
  flights_climbed: Object.freeze({ key: 'flightsClimbed', digits: 0 }),
  walking_speed_mps: Object.freeze({ key: 'walkingSpeedMps', digits: 2 }),
  walking_step_length_m: Object.freeze({ key: 'walkingStepLengthM', digits: 2 }),
  heart_rate_avg_bpm: Object.freeze({ key: 'heartRateAvgBpm', digits: 1 }),
  heart_rate_min_bpm: Object.freeze({ key: 'heartRateMinBpm', digits: 1 }),
  respiratory_rate_brpm: Object.freeze({ key: 'respiratoryRateBrpm', digits: 1 }),
  oxygen_saturation_pct: Object.freeze({ key: 'oxygenSaturationPct', digits: 1 })
});

// rows: [{ day, metric, value }]; returns ascending days with every metric key.
function pivotHealthRows(rows) {
  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.day)) {
      const entry = { day: row.day };
      for (const field of Object.values(HEALTH_DAY_FIELDS)) entry[field.key] = null;
      byDay.set(row.day, entry);
    }
    const field = Object.hasOwn(HEALTH_DAY_FIELDS, row.metric) ? HEALTH_DAY_FIELDS[row.metric] : null;
    if (field) byDay.get(row.day)[field.key] = round(Number(row.value), field.digits);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function metricValues(rows, metric) {
  return rows.filter((row) => row.metric === metric).map((row) => Number(row.value));
}

// Averages over days that have each metric (daily sums average to a daily
// mean); VO2 max is the latest reading, and the lowest daily minimum heart rate
// is reported next to the mean of daily minimums. Raw (unrounded) daily values
// are averaged, then rounded once.
function summarizeHealthRows(rows) {
  const values = (metric) => metricValues(rows, metric);
  const vo2 = rows.filter((row) => row.metric === 'vo2max_ml_kg_min')
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const minimumHeartRates = values('heart_rate_min_bpm');
  return {
    daysWithData: new Set(rows.map((row) => row.day)).size,
    avgSteps: round(mean(values('steps'))),
    avgActiveEnergyKcal: round(mean(values('active_energy_kcal'))),
    avgExerciseMinutes: round(mean(values('exercise_minutes'))),
    avgRestingHeartRate: round(mean(values('resting_heart_rate_bpm')), 1),
    avgHrvMs: round(mean(values('hrv_sdnn_ms')), 1),
    latestVo2Max: vo2.length ? round(Number(vo2.at(-1).value), 1) : null,
    avgWalkingRunningDistanceM: round(mean(values('walking_running_distance_m'))),
    avgFlightsClimbed: round(mean(values('flights_climbed')), 1),
    avgWalkingSpeedMps: round(mean(values('walking_speed_mps')), 2),
    avgWalkingStepLengthM: round(mean(values('walking_step_length_m')), 2),
    avgHeartRateAvgBpm: round(mean(values('heart_rate_avg_bpm')), 1),
    avgHeartRateMinBpm: round(mean(minimumHeartRates), 1),
    lowestHeartRateMinBpm: minimumHeartRates.length ? round(Math.min(...minimumHeartRates), 1) : null,
    avgRespiratoryRateBrpm: round(mean(values('respiratory_rate_brpm')), 1),
    avgOxygenSaturationPct: round(mean(values('oxygen_saturation_pct')), 1)
  };
}

const METERS_PER_MILE = 1609.344;

// The weekly-summary `health` block: the original seven keys plus averages of
// the newer metrics in US units (miles, mph). Raw daily values are averaged
// before converting and rounding.
function summarizeWeeklyHealthRows(rows) {
  const summary = summarizeHealthRows(rows);
  const values = (metric) => metricValues(rows, metric);
  const distanceM = mean(values('walking_running_distance_m'));
  const speedMps = mean(values('walking_speed_mps'));
  return {
    daysWithData: summary.daysWithData,
    avgSteps: summary.avgSteps,
    avgActiveEnergyKcal: summary.avgActiveEnergyKcal,
    avgExerciseMinutes: summary.avgExerciseMinutes,
    avgRestingHeartRate: summary.avgRestingHeartRate,
    avgHrvMs: summary.avgHrvMs,
    latestVo2Max: summary.latestVo2Max,
    avgDistanceMiles: distanceM == null ? null : round(distanceM / METERS_PER_MILE, 1),
    avgFlightsClimbed: round(mean(values('flights_climbed'))),
    avgWalkingSpeedMph: speedMps == null ? null : round(speedMps * 3600 / METERS_PER_MILE, 1),
    avgHeartRateBpm: round(mean(values('heart_rate_avg_bpm'))),
    avgLowestHeartRateBpm: round(mean(values('heart_rate_min_bpm'))),
    avgRespiratoryRate: round(mean(values('respiratory_rate_brpm')), 1),
    avgOxygenSaturationPct: round(mean(values('oxygen_saturation_pct')))
  };
}

function healthMetricsWindow(scope, timezone, now = new Date()) {
  const length = SCOPE_DAYS[scope] || SCOPE_DAYS.week;
  const end = localIsoDay(timezone, now);
  const start = addDays(end, -(length - 1));
  return {
    current: { start, end },
    previous: { start: addDays(start, -length), end: addDays(start, -1) }
  };
}

const METRIC_CHECK_NAME = 'health_daily_metrics_metric_check';

// Moves an existing table from the version-3 metric CHECK to the current one
// (shared by initDb and scripts/migrate-health-metrics-v2.js). Idempotent:
// returns false when the current CHECK is already the only metric CHECK. Any
// other CHECK definition is drift and is refused rather than replaced. Only the
// constraint changes: owner, grants, rows and indexes are untouched, and every
// existing row already satisfies the wider CHECK.
async function widenHealthMetricsCheck(queryable) {
  const { rows } = await queryable.query(
    `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = 'public.health_daily_metrics'::regclass AND contype = 'c'
      ORDER BY conname`
  );
  const legacyIds = healthMetricIdsForSchemaVersion(3);
  const currentIds = healthMetricIdsForSchemaVersion(HEALTH_METRICS_SCHEMA_VERSION);
  const catalogDefinition = (ids) => `CHECK ((metric = ANY (ARRAY[${ids.map((id) => `'${id}'::text`).join(', ')}])))`;
  const current = rows.filter((row) => row.definition === catalogDefinition(currentIds));
  const legacy = rows.filter((row) => row.definition === catalogDefinition(legacyIds));
  if (current.length + legacy.length !== rows.length || current.length > 1 || legacy.length > 1) {
    throw new Error('health_daily_metrics has an unreviewed CHECK constraint');
  }
  if (current.length && !legacy.length) return false;
  if (legacy.length) {
    await queryable.query(`ALTER TABLE public.health_daily_metrics DROP CONSTRAINT ${quoteIdent(legacy[0].conname)}`);
  }
  if (!current.length) {
    await queryable.query(
      `ALTER TABLE public.health_daily_metrics ADD CONSTRAINT ${METRIC_CHECK_NAME} ${HEALTH_METRICS_CHECK_SQL}`
    );
  }
  return true;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function buildHealthMetricsResponse(scope, rows, window, { enabled = true } = {}) {
  const within = (range) => rows.filter((row) => row.day >= range.start && row.day <= range.end);
  const current = within(window.current);
  return {
    scope,
    enabled,
    days: pivotHealthRows(current),
    summary: {
      current: summarizeHealthRows(current),
      previous: summarizeHealthRows(within(window.previous))
    }
  };
}

const PROBE_RETRY_MS = 60_000;

// detect(pool) resolves the structure version of the reviewed table (3 or 4),
// true for the current version, or a falsy value when the table is absent or
// drifted. Until the owner runs `npm run db:migrate:health-metrics`, the
// feature is off: reads return empty and writes are refused, so startup never
// depends on the table. On version 3 the feature is on but metrics newer than
// that CHECK are skipped. Only the current version is cached; absence and older
// versions are re-probed at most once a minute, so the feature turns on (or
// widens) after a migration without a restart.
function createHealthMetricsStore(pool, { detect, now = () => Date.now() } = {}) {
  let version = null; // null: never probed; 0: absent
  let checkedAt = 0;
  let pending = null;

  function normalizeVersion(value) {
    if (value === true) return HEALTH_METRICS_SCHEMA_VERSION;
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  async function schemaVersion() {
    if (version != null && version >= HEALTH_METRICS_SCHEMA_VERSION) return version;
    if (version != null && now() - checkedAt < PROBE_RETRY_MS) return version;
    if (!pending) {
      pending = (async () => {
        try {
          version = normalizeVersion(await detect(pool));
        } catch {
          version = 0;
        } finally {
          checkedAt = now();
          pending = null;
        }
        return version;
      })();
    }
    return pending;
  }

  return {
    isHealthMetricsAvailable: async () => (await schemaVersion()) > 0,
    // Metric ids the live table accepts; empty while the table is absent.
    async healthMetricIdsAccepted() {
      return healthMetricIdsForSchemaVersion(await schemaVersion());
    },
    setHealthMetricsAvailable(value) {
      version = value == null ? null : normalizeVersion(value === false ? 0 : value);
      checkedAt = now();
    },
    async upsertHealthDailyMetrics(userId, items, { source = 'healthkit' } = {}) {
      if (!items.length) return 0;
      const result = await pool.query(
        `INSERT INTO health_daily_metrics (user_id, local_date, metric, value, sample_count, source, external_id)
         SELECT $1, d::date, m, v, c, $2, e
           FROM unnest($3::text[], $4::text[], $5::float8[], $6::int[], $7::text[]) AS t(d, m, v, c, e)
         ON CONFLICT (user_id, metric, local_date) WHERE deleted_at IS NULL
         DO UPDATE SET value = EXCLUDED.value, sample_count = EXCLUDED.sample_count,
                       source = EXCLUDED.source, external_id = EXCLUDED.external_id, updated_at = NOW()`,
        [
          userId, source,
          items.map((item) => item.date),
          items.map((item) => item.metric),
          items.map((item) => item.value),
          items.map((item) => item.sampleCount),
          items.map((item) => item.externalId)
        ]
      );
      return result.rowCount;
    },
    async listHealthDailyMetrics(userId, { startDay, endDay }) {
      const result = await pool.query(
        `SELECT to_char(local_date, 'YYYY-MM-DD') AS day, metric, value::float8 AS value
           FROM health_daily_metrics
          WHERE user_id = $1 AND deleted_at IS NULL AND source = 'healthkit'
            AND local_date BETWEEN $2::date AND $3::date
          ORDER BY local_date, metric`,
        [userId, startDay, endDay]
      );
      return result.rows;
    }
  };
}

module.exports = {
  TABLE,
  HEALTH_METRICS,
  HEALTH_METRIC_IDS,
  HEALTH_METRIC_GROUPS,
  HEALTH_METRICS_DDL,
  HEALTH_METRICS_V3_DDL,
  HEALTH_METRICS_CHECK_SQL,
  HEALTH_METRICS_SCHEMA_VERSION,
  HEALTH_DAY_FIELDS,
  SCOPE_DAYS,
  localIsoDay,
  healthMetricIdsForSchemaVersion,
  normalizeHealthMetricsPayload,
  pivotHealthRows,
  summarizeHealthRows,
  summarizeWeeklyHealthRows,
  widenHealthMetricsCheck,
  healthMetricsWindow,
  buildHealthMetricsResponse,
  createHealthMetricsStore
};
