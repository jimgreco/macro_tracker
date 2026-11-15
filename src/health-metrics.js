// Apple Health daily metrics (steps, active energy, exercise minutes, resting
// heart rate, HRV, VO2 max). Rows are HealthKit daily aggregates computed on the
// device; HealthKit copies written by other apps (including the Oura app) are
// allowed. Direct Oura Cloud API documents never land in this table.

const TABLE = 'health_daily_metrics';

// id -> { group (integration data type), max (inclusive upper bound) }
const HEALTH_METRICS = Object.freeze({
  steps: Object.freeze({ group: 'activity', max: 200000 }),
  active_energy_kcal: Object.freeze({ group: 'activity', max: 20000 }),
  exercise_minutes: Object.freeze({ group: 'activity', max: 1440 }),
  resting_heart_rate_bpm: Object.freeze({ group: 'heart', max: 250 }),
  hrv_sdnn_ms: Object.freeze({ group: 'heart', max: 1000 }),
  vo2max_ml_kg_min: Object.freeze({ group: 'heart', max: 100 })
});
const HEALTH_METRIC_IDS = Object.freeze(Object.keys(HEALTH_METRICS));
const HEALTH_METRIC_GROUPS = Object.freeze(['activity', 'heart']);
const MAX_ITEMS = 1000;
const MAX_AGE_DAYS = 400;
const MAX_SAMPLE_COUNT = 1000000;

// Shared by initDb (fresh schema) and scripts/migrate-health-metrics.js.
const HEALTH_METRICS_DDL = `
  CREATE TABLE IF NOT EXISTS health_daily_metrics (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    local_date DATE NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('steps', 'active_energy_kcal', 'exercise_minutes',
      'resting_heart_rate_bpm', 'hrv_sdnn_ms', 'vo2max_ml_kg_min')),
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
    if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0 || item.value > definition.max) {
      throw validationError(`${where}.value must be a number from 0 to ${definition.max}.`);
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

// rows: [{ day, metric, value }]; returns ascending days with every metric key.
function pivotHealthRows(rows) {
  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.day)) {
      byDay.set(row.day, {
        day: row.day, steps: null, activeEnergyKcal: null, exerciseMinutes: null,
        restingHeartRate: null, hrvMs: null, vo2max: null
      });
    }
    const entry = byDay.get(row.day);
    const value = Number(row.value);
    switch (row.metric) {
      case 'steps': entry.steps = round(value); break;
      case 'active_energy_kcal': entry.activeEnergyKcal = round(value); break;
      case 'exercise_minutes': entry.exerciseMinutes = round(value); break;
      case 'resting_heart_rate_bpm': entry.restingHeartRate = round(value, 1); break;
      case 'hrv_sdnn_ms': entry.hrvMs = round(value, 1); break;
      case 'vo2max_ml_kg_min': entry.vo2max = round(value, 1); break;
      default: break;
    }
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// Averages over days that have each metric; VO2 max is the latest reading.
// Raw (unrounded) daily values are averaged, then rounded once.
function summarizeHealthRows(rows) {
  const values = (metric) => rows.filter((row) => row.metric === metric).map((row) => Number(row.value));
  const vo2 = rows.filter((row) => row.metric === 'vo2max_ml_kg_min')
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return {
    daysWithData: new Set(rows.map((row) => row.day)).size,
    avgSteps: round(mean(values('steps'))),
    avgActiveEnergyKcal: round(mean(values('active_energy_kcal'))),
    avgExerciseMinutes: round(mean(values('exercise_minutes'))),
    avgRestingHeartRate: round(mean(values('resting_heart_rate_bpm')), 1),
    avgHrvMs: round(mean(values('hrv_sdnn_ms')), 1),
    latestVo2Max: vo2.length ? round(Number(vo2.at(-1).value), 1) : null
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

// detect(pool) resolves true when the reviewed table structure is present.
// Until the owner runs `npm run db:migrate:health-metrics`, the feature is
// off: reads return empty and writes are refused, so startup never depends on
// the table. A positive result is cached; a negative one is re-probed at most
// once a minute so the feature turns on after the migration without a restart.
function createHealthMetricsStore(pool, { detect, now = () => Date.now() } = {}) {
  let available = null;
  let checkedAt = 0;
  let pending = null;

  async function isAvailable() {
    if (available === true) return true;
    if (available === false && now() - checkedAt < PROBE_RETRY_MS) return false;
    if (!pending) {
      pending = (async () => {
        try {
          available = Boolean(await detect(pool));
        } catch {
          available = false;
        } finally {
          checkedAt = now();
          pending = null;
        }
        return available;
      })();
    }
    return pending;
  }

  return {
    isHealthMetricsAvailable: isAvailable,
    setHealthMetricsAvailable(value) {
      available = value == null ? null : Boolean(value);
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
  SCOPE_DAYS,
  localIsoDay,
  normalizeHealthMetricsPayload,
  pivotHealthRows,
  summarizeHealthRows,
  healthMetricsWindow,
  buildHealthMetricsResponse,
  createHealthMetricsStore
};
