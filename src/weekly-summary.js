const crypto = require('crypto');

// Read-only GET /api/weekly-summary for the weekly-review routine.
// Contract: weekly-review/docs/weekly-summary-contract.md. `data` mirrors
// weekly-review src/sources/macros.js collectMacros (same keys, rounding and
// statuses), except that Oura-derived values are always null: Oura API data
// and derived values must never reach an AI/ML model, and the routine passes
// this payload to one. Sleep hours come only from Apple Health and manual
// sleep_entries (see getWeeklySummaryRows), never from the Oura API.

const WEEK_ERROR = 'week must be a Monday (YYYY-MM-DD)';
const CM_PER_IN = 2.54;
const SHA256_HEX = /^[0-9a-f]{64}$/;

// Same as weekly-review src/stats.js: Math.round rounds half up.
function round(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function mean(values) {
  const xs = values.filter((v) => v != null && !Number.isNaN(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function delta(current, previous, digits = 0) {
  if (current == null || previous == null) return null;
  return round(current - previous, digits);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekRange(monday) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return { start: monday, end: days[6], days };
}

// Returns { week, prev } for a real calendar Monday, otherwise null.
function parseWeekParam(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  if (date.getUTCDay() !== 1) return null;
  return { week: weekRange(value), prev: weekRange(addDays(value, -7)) };
}

function summarizeWeek(week, rows) {
  const byDay = Object.fromEntries(rows.totals.map((t) => [t.day, t]));
  const days = week.days.map((day) => {
    const t = byDay[day];
    return {
      date: day,
      state: rows.states[day] ?? (t ? 'unknown' : 'unlogged'),
      calories: t ? round(t.calories) : null,
      protein: t ? round(t.protein) : null,
      carbs: t ? round(t.carbs) : null,
      fat: t ? round(t.fat) : null,
      // Fiber shows only when every entry that day has it.
      fiber: t && t.fiber_known === t.entries ? round(t.fiber) : null
    };
  });
  const complete = days.filter((d) => d.state === 'complete' && d.calories != null);
  const inWeek = (list) => list.filter((r) => r.day >= week.start && r.day <= week.end);
  const weights = inWeek(rows.weights);
  const waists = inWeek(rows.waists);
  const latestWaist = waists.at(-1);
  const nights = inWeek(rows.sleep || []).filter((r) => r.hours > 0);

  return {
    days,
    loggedDays: days.filter((d) => d.calories != null).length,
    completeDays: complete.length,
    // Averages use Complete days only.
    avgCalories: round(mean(complete.map((d) => d.calories))),
    avgProtein: round(mean(complete.map((d) => d.protein))),
    avgFiber: round(mean(complete.map((d) => d.fiber))),
    weight: {
      count: weights.length,
      avg: round(mean(weights.map((w) => w.weight)), 1)
    },
    waistIn: latestWaist
      ? { latest: round(latestWaist.value_cm / CM_PER_IN, 2), method: latestWaist.method, day: latestWaist.day }
      : null,
    // Apple Health / manual sleep: nights with any logged sleep, and their mean.
    sleepNights: nights.length,
    avgSleepHours: round(mean(nights.map((r) => r.hours)), 1),
    // Oura-derived; withheld from this AI-bound payload (see file header).
    sleepScore: null,
    readinessScore: null,
    avgSteps: null
  };
}

// rows: { user, totals, states, weights, waists, sleep, targets } from getWeeklySummaryRows.
function buildMacrosSummary(rows, { week, prev }) {
  if (!rows || !rows.user) return { status: 'no-account' };
  const current = summarizeWeek(week, rows);
  const { days: _days, ...previous } = summarizeWeek(prev, rows);
  const targets = rows.targets || {};
  return {
    status: 'ok',
    targets: {
      calories: targets.calories ?? null,
      protein: targets.protein ?? null,
      fiber: targets.fiber ?? null,
      sleepHours: targets.sleep_hours ?? null
    },
    current,
    previous,
    change: {
      avgCalories: delta(current.avgCalories, previous.avgCalories),
      avgProtein: delta(current.avgProtein, previous.avgProtein),
      weight: delta(current.weight.avg, previous.weight.avg, 1),
      avgSleepHours: delta(current.avgSleepHours, previous.avgSleepHours, 1),
      sleepScore: delta(current.sleepScore, previous.sleepScore)
    }
  };
}

// Both variables are read per request; either missing disables the route.
function readWeeklySummaryConfig(env = process.env) {
  const tokenHash = String(env.WEEKLY_SUMMARY_TOKEN_SHA256 || '').trim().toLowerCase();
  const email = String(env.WEEKLY_SUMMARY_EMAIL || '').trim();
  if (!SHA256_HEX.test(tokenHash) || !email) return null;
  return { tokenHash, email };
}

// Hash the presented bearer token and compare digests in constant time.
// Both buffers are always 32 bytes, so length never short-circuits.
function weeklySummaryTokenMatches(authorizationHeader, expectedHashHex) {
  const header = String(authorizationHeader || '');
  if (!header.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  if (!token) return false;
  const presented = crypto.createHash('sha256').update(token, 'utf8').digest();
  const expected = Buffer.from(expectedHashHex, 'hex');
  return expected.length === presented.length && crypto.timingSafeEqual(presented, expected);
}

function sendExactJson(res, status, body) {
  res.status(status).type('application/json').send(JSON.stringify(body));
}

// Middleware chain for the route. It never reads the session or validates
// normal API tokens (that writes last_used_at), so user credentials are
// neither accepted nor touched.
function createWeeklySummaryRoute({ getWeeklySummaryRows, rateLimiter, notFound, logError, env = process.env, now = () => new Date() }) {
  const requireConfig = (req, res, next) => {
    const config = readWeeklySummaryConfig(env);
    if (!config) return notFound(req, res);
    req.weeklySummaryConfig = config;
    return next();
  };

  const requireToken = (req, res, next) => {
    if (!weeklySummaryTokenMatches(req.get('authorization'), req.weeklySummaryConfig.tokenHash)) {
      return notFound(req, res);
    }
    return next();
  };

  const handler = async (req, res) => {
    const range = parseWeekParam(req.query.week);
    if (!range) return sendExactJson(res, 400, { error: WEEK_ERROR });
    try {
      const rows = await getWeeklySummaryRows(req.weeklySummaryConfig.email, {
        startDay: range.prev.start,
        endDay: range.week.end
      });
      res.set('Cache-Control', 'no-store');
      return sendExactJson(res, 200, {
        version: 1,
        app: 'macros',
        week: { start: range.week.start, end: range.week.end },
        generatedAt: now().toISOString(),
        data: buildMacrosSummary(rows, range)
      });
    } catch (error) {
      logError(req, error);
      res.set('Cache-Control', 'no-store');
      return sendExactJson(res, 500, { error: 'internal' });
    }
  };

  return [requireConfig, rateLimiter, requireToken, handler].filter(Boolean);
}

module.exports = {
  WEEK_ERROR,
  round,
  mean,
  delta,
  parseWeekParam,
  buildMacrosSummary,
  readWeeklySummaryConfig,
  weeklySummaryTokenMatches,
  createWeeklySummaryRoute
};
