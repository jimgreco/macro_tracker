const { createWeeklySummaryAuth, sendExactJson } = require('./weekly-summary');

// Read-only GET /api/checkin-evidence?start=YYYY-MM-DD&end=YYYY-MM-DD for the
// weekly-review coaching routine: the detailed nutrition/body evidence behind
// the weekly summary. It reuses the weekly-summary token and account
// (WEEKLY_SUMMARY_TOKEN_SHA256 / WEEKLY_SUMMARY_EMAIL) through the same auth
// guards; that token is accepted only on these two routes. Rows come from
// getCheckinEvidenceRows (one READ ONLY snapshot) and exclude Oura API data
// and derived values, because the routine passes this payload to an AI model.

const RANGE_ERROR = 'start and end must be YYYY-MM-DD dates with start <= end, spanning 1-31 days';
const MAX_RANGE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

// Returns { start, end } for 1-31 inclusive calendar days, otherwise null.
function parseRangeParams(query = {}) {
  const start = parseDate(query.start);
  const end = parseDate(query.end);
  if (!start || !end) return null;
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days < 1 || days > MAX_RANGE_DAYS) return null;
  return { start: query.start, end: query.end };
}

const toId = (value) => (value == null ? null : Number(value));
const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

// rows: { user, entries, nutritionDays, macroTargets, weights, waists,
// checkins, photos, weightTargets, sleep } from getCheckinEvidenceRows.
// Explicit field lists: nothing reaches the payload unless named here.
function buildCheckinEvidence(rows) {
  if (!rows || !rows.user) return { status: 'no-account' };
  return {
    status: 'ok',
    entries: (rows.entries || []).map((r) => ({
      id: toId(r.id),
      item_name: r.item_name,
      quantity: r.quantity ?? null,
      unit: r.unit ?? null,
      calories: r.calories ?? null,
      protein: r.protein ?? null,
      carbs: r.carbs ?? null,
      fat: r.fat ?? null,
      fiber: r.fiber ?? null,
      consumed_at: iso(r.consumed_at),
      localDate: r.localDate,
      meal_group: r.meal_group ?? null,
      meal_name: r.meal_name ?? null
    })),
    // Explicit complete/partial only; a missing day is unknown, never zero.
    nutritionDays: (rows.nutritionDays || []).map((r) => ({ localDate: r.localDate, state: r.state })),
    macroTargets: (rows.macroTargets || []).map((r) => ({
      macro: r.macro,
      target: r.target,
      effective_date: r.effective_date
    })),
    weights: (rows.weights || []).map((r) => ({
      id: toId(r.id),
      weight: r.weight,
      logged_at: iso(r.logged_at),
      localDate: r.localDate,
      source: r.source
    })),
    waists: (rows.waists || []).map((r) => ({
      id: toId(r.id),
      readings: r.readings,
      unit: r.unit,
      method: r.method,
      value_cm: r.value_cm,
      notes: r.notes ?? '',
      logged_at: iso(r.logged_at),
      localDate: r.localDate
    })),
    checkins: (rows.checkins || []).map((r) => ({ id: r.id, day: r.day, notes: r.notes ?? '' })),
    // Metadata only: no object keys or URLs.
    photos: (rows.photos || []).map((r) => ({ id: r.id, checkin_id: r.checkin_id, view: r.view, day: r.day })),
    weightTargets: (rows.weightTargets || []).map((r) => ({
      target_weight: r.target_weight ?? null,
      target_date: r.target_date ?? null,
      effective_date: r.effective_date
    })),
    sleep: (rows.sleep || []).map((r) => ({
      id: toId(r.id),
      localDate: r.localDate,
      logged_at: iso(r.logged_at),
      durationHours: r.duration_hours,
      wakeUps: r.wake_ups ?? null,
      source: r.source
    }))
  };
}

function createCheckinEvidenceRoute({ getCheckinEvidenceRows, rateLimiter, notFound, logError, env = process.env, now = () => new Date() }) {
  const { requireConfig, requireToken } = createWeeklySummaryAuth({ notFound, env });

  const handler = async (req, res) => {
    const range = parseRangeParams(req.query);
    if (!range) return sendExactJson(res, 400, { error: RANGE_ERROR });
    res.set('Cache-Control', 'no-store');
    try {
      const rows = await getCheckinEvidenceRows(req.weeklySummaryConfig.email, {
        startDay: range.start,
        endDay: range.end
      });
      return sendExactJson(res, 200, {
        version: 1,
        app: 'macros',
        range,
        timezone: rows && rows.user ? rows.user.timezone : null,
        generatedAt: now().toISOString(),
        data: buildCheckinEvidence(rows)
      });
    } catch (error) {
      logError(req, error);
      if (error && error.code === 'checkin_evidence_row_limit') {
        return sendExactJson(res, 500, { error: 'too-many-rows' });
      }
      return sendExactJson(res, 500, { error: 'internal' });
    }
  };

  return [requireConfig, rateLimiter, requireToken, handler].filter(Boolean);
}

module.exports = {
  RANGE_ERROR,
  MAX_RANGE_DAYS,
  parseRangeParams,
  buildCheckinEvidence,
  createCheckinEvidenceRoute
};
