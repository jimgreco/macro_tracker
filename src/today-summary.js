const DEFAULT_WEIGHT_CADENCE_DAYS = 7;
const RECOVERY_STALE_HOURS = 48;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateFrom(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDayInTimezone(value, timezone = 'America/New_York') {
  const date = dateFrom(value);
  if (!date) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch (_error) {
    return date.toISOString().slice(0, 10);
  }
}

function newestEntry(entries, field = 'loggedAt') {
  return [...(entries || [])]
    .filter((entry) => dateFrom(entry?.[field]))
    .sort((a, b) => dateFrom(b[field]) - dateFrom(a[field]))[0] || null;
}

function sourceLabel(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized.includes('oura')) return 'Oura';
  if (normalized === 'healthkit') return 'Apple Health';
  if (normalized) return 'Manual';
  return 'No source';
}

function hoursSince(value, now) {
  const date = dateFrom(value);
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 3_600_000));
}

function daysSince(value, now) {
  const hours = hoursSince(value, now);
  return hours == null ? null : Math.floor(hours / 24);
}

function buildTodaySummary({
  dashboard = {},
  workouts = {},
  weights = {},
  weightTarget = null,
  sleep = {},
  timezone = 'America/New_York',
  now = new Date(),
  weightCadenceDays = DEFAULT_WEIGHT_CADENCE_DAYS,
  recoveryStaleHours = RECOVERY_STALE_HOURS,
  ouraStatus
} = {}) {
  const generatedAt = dateFrom(now) || new Date();
  const totals = {
    day: dashboard.currentDayTotals?.day || isoDayInTimezone(generatedAt, timezone),
    calories: finiteNumber(dashboard.currentDayTotals?.calories),
    protein: finiteNumber(dashboard.currentDayTotals?.protein),
    carbs: finiteNumber(dashboard.currentDayTotals?.carbs),
    fat: finiteNumber(dashboard.currentDayTotals?.fat)
  };
  const targets = {
    calories: finiteNumber(dashboard.targets?.calories),
    protein: finiteNumber(dashboard.targets?.protein),
    carbs: finiteNumber(dashboard.targets?.carbs),
    fat: finiteNumber(dashboard.targets?.fat),
    workouts: finiteNumber(dashboard.targets?.workouts),
    workoutCalories: finiteNumber(
      dashboard.targets?.workout_calories ?? dashboard.targets?.workoutCalories
    ),
    sleepHours: finiteNumber(
      dashboard.targets?.sleep_hours ?? dashboard.targets?.sleepHours,
      8
    )
  };
  const hasMacroTargets = targets.calories > 0 || targets.protein > 0;
  const remaining = {
    calories: targets.calories > 0 ? Math.max(0, targets.calories - totals.calories) : null,
    protein: targets.protein > 0 ? Math.max(0, targets.protein - totals.protein) : null,
    carbs: targets.carbs > 0 ? Math.max(0, targets.carbs - totals.carbs) : null,
    fat: targets.fat > 0 ? Math.max(0, targets.fat - totals.fat) : null
  };

  const todayWorkouts = (workouts.entries || []).filter(
    (entry) => isoDayInTimezone(entry.loggedAt, timezone) === totals.day
  );
  const todayWorkoutCalories = todayWorkouts.reduce(
    (sum, entry) => sum + finiteNumber(entry.caloriesBurned),
    0
  );
  const latestWorkout = newestEntry(todayWorkouts);
  const weeklyActiveDays = new Set(
    (workouts.dailyCalories || [])
      .filter((row) => finiteNumber(row.calories) > 0)
      .map((row) => row.day)
  ).size;

  const latestWeight = newestEntry(weights.entries);
  const weightDaysSince = latestWeight
    ? daysSince(latestWeight.loggedAt, generatedAt)
    : null;
  const normalizedCadenceDays = Math.max(1, Math.round(finiteNumber(weightCadenceDays, 7)));
  const nextWeightDueAt = latestWeight
    ? new Date(
      dateFrom(latestWeight.loggedAt).getTime() + normalizedCadenceDays * 86_400_000
    ).toISOString()
    : null;

  const latestSleep = newestEntry(sleep.entries);
  const sleepAgeHours = latestSleep
    ? hoursSince(latestSleep.loggedAt, generatedAt)
    : null;
  const sleepSource = latestSleep?.source || null;
  const normalizedOuraStatus = ['connected', 'stale', 'disconnected'].includes(ouraStatus)
    ? ouraStatus
    : String(sleepSource || '').toLowerCase().includes('oura')
      ? 'connected'
      : 'unavailable';

  return {
    generatedAt: generatedAt.toISOString(),
    day: totals.day,
    macros: {
      totals,
      targets,
      remaining,
      state: hasMacroTargets ? (totals.calories > 0 ? 'tracked' : 'empty') : 'needs_targets'
    },
    workout: {
      state: todayWorkouts.length ? 'logged' : 'not_logged',
      loggedCount: todayWorkouts.length,
      activeCalories: Number(todayWorkoutCalories.toFixed(1)),
      latestDescription: latestWorkout?.description || null,
      weeklyActiveDays,
      targetPerWeek: targets.workouts
    },
    weight: {
      state: !latestWeight
        ? 'empty'
        : weightDaysSince >= normalizedCadenceDays
          ? 'due'
          : 'on_cadence',
      latestWeight: latestWeight ? finiteNumber(latestWeight.weight) : null,
      lastLoggedAt: latestWeight?.loggedAt || null,
      daysSinceLast: weightDaysSince,
      cadenceDays: normalizedCadenceDays,
      nextDueAt: nextWeightDueAt,
      source: latestWeight?.source || null,
      targetWeight: weightTarget?.targetWeight ?? null,
      targetDate: weightTarget?.targetDate ?? null
    },
    recovery: {
      state: !latestSleep
        ? 'empty'
        : sleepAgeHours > Math.max(1, finiteNumber(recoveryStaleHours, RECOVERY_STALE_HOURS))
          ? 'stale'
          : 'current',
      sleepHours: latestSleep ? finiteNumber(latestSleep.durationHours) : null,
      wakeUps: latestSleep ? finiteNumber(latestSleep.wakeUps) : null,
      quality: latestSleep?.quality ?? null,
      lastLoggedAt: latestSleep?.loggedAt || null,
      ageHours: sleepAgeHours,
      source: sleepSource,
      sourceLabel: sourceLabel(sleepSource),
      ouraStatus: normalizedOuraStatus
    },
    empty: !(dashboard.entries || []).length
      && !(workouts.entries || []).length
      && !(weights.entries || []).length
      && !(sleep.entries || []).length
  };
}

module.exports = {
  DEFAULT_WEIGHT_CADENCE_DAYS,
  RECOVERY_STALE_HOURS,
  buildTodaySummary,
  isoDayInTimezone,
  sourceLabel
};
