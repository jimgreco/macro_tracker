const DAY_COMPLETENESS_STATES = Object.freeze({
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  UNKNOWN: 'unknown'
});

const OURA_PAIRED_HISTORY_MIN_COMPLETE_DAYS = 10;
const OURA_PAIRED_HISTORY_MIN_WEARABLE_COVERAGE = 0.7;

function normalizeDayCompletenessState(value, { allowUnknown = true } = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'incomplete') {
    return DAY_COMPLETENESS_STATES.PARTIAL;
  }
  if (
    normalized === DAY_COMPLETENESS_STATES.COMPLETE ||
    normalized === DAY_COMPLETENESS_STATES.PARTIAL ||
    (allowUnknown && normalized === DAY_COMPLETENESS_STATES.UNKNOWN)
  ) {
    return normalized;
  }
  const allowed = allowUnknown ? 'complete, partial, or unknown' : 'complete or partial';
  throw new Error(`Day state must be ${allowed}.`);
}

function isExplicitlyCompleteDay(row) {
  const state = row?.completeness?.state ?? row?.state;
  return state === DAY_COMPLETENESS_STATES.COMPLETE;
}

function inferSuggestedDayState({
  state,
  day,
  today,
  entryCount = 0,
  daypartCount = 0,
  spanHours = 0
} = {}) {
  if (state && state !== DAY_COMPLETENESS_STATES.UNKNOWN) {
    return { state: null, reason: null };
  }

  const normalizedEntryCount = Math.max(0, Number(entryCount) || 0);
  if (!normalizedEntryCount) {
    return { state: null, reason: null };
  }

  const isPastDay = Boolean(day && today && day < today);
  const looksBroadlyLogged =
    normalizedEntryCount >= 3 &&
    Number(daypartCount || 0) >= 2 &&
    Number(spanHours || 0) >= 6;

  if (isPastDay && looksBroadlyLogged) {
    return {
      state: DAY_COMPLETENESS_STATES.COMPLETE,
      reason: 'Entries span multiple parts of the day. Mark complete if nothing is missing.'
    };
  }

  return {
    state: DAY_COMPLETENESS_STATES.PARTIAL,
    reason: 'This day has entries but has not been marked complete.'
  };
}

function buildDayCompleteness({
  day,
  state,
  timezone,
  updatedAt = null,
  entryCount = 0,
  daypartCount = 0,
  spanHours = 0,
  today
} = {}) {
  const normalizedState = state
    ? normalizeDayCompletenessState(state)
    : DAY_COMPLETENESS_STATES.UNKNOWN;
  const suggestion = inferSuggestedDayState({
    state: normalizedState,
    day,
    today,
    entryCount,
    daypartCount,
    spanHours
  });

  return {
    day,
    state: normalizedState,
    explicit: normalizedState !== DAY_COMPLETENESS_STATES.UNKNOWN,
    eligibleForNutritionAnalysis: normalizedState === DAY_COMPLETENESS_STATES.COMPLETE,
    suggestedState: suggestion.state,
    suggestionReason: suggestion.reason,
    timezone: timezone || 'America/New_York',
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null
  };
}

function summarizeDayCompleteness(rows, periodDays) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const completeDays = normalizedRows.filter(isExplicitlyCompleteDay).length;
  const partialDays = normalizedRows.filter((row) => {
    const state = row?.completeness?.state ?? row?.state;
    return state === DAY_COMPLETENESS_STATES.PARTIAL;
  }).length;
  const totalDays = Math.max(
    completeDays + partialDays,
    Math.max(0, Math.round(Number(periodDays) || 0))
  );
  const unknownDays = Math.max(0, totalDays - completeDays - partialDays);

  return {
    periodDays: totalDays,
    completeDays,
    partialDays,
    unknownDays,
    eligibleSampleDays: completeDays,
    coveragePct: totalDays > 0 ? Math.round((completeDays / totalDays) * 100) : 0
  };
}

function evaluateOuraPairedHistoryCoverage({
  nutritionDays,
  wearableDays,
  minCompleteDays = OURA_PAIRED_HISTORY_MIN_COMPLETE_DAYS,
  minWearableCoverage = OURA_PAIRED_HISTORY_MIN_WEARABLE_COVERAGE
} = {}) {
  const completeDayKeys = new Set(
    (Array.isArray(nutritionDays) ? nutritionDays : [])
      .filter(isExplicitlyCompleteDay)
      .map((row) => String(row.day || ''))
      .filter(Boolean)
  );
  const wearableDayKeys = new Set(
    (Array.isArray(wearableDays) ? wearableDays : [])
      .map((row) => String(typeof row === 'string' ? row : row?.day || ''))
      .filter(Boolean)
  );
  const pairedDays = [...completeDayKeys].filter((day) => wearableDayKeys.has(day)).length;
  const wearableCoverage = completeDayKeys.size > 0 ? pairedDays / completeDayKeys.size : 0;
  const nutritionSufficient = completeDayKeys.size >= minCompleteDays;
  const wearableSufficient =
    pairedDays >= minCompleteDays &&
    wearableCoverage >= minWearableCoverage;

  return {
    eligible: nutritionSufficient && wearableSufficient,
    completeNutritionDays: completeDayKeys.size,
    wearableDays: wearableDayKeys.size,
    pairedDays,
    wearableCoveragePct: Math.round(wearableCoverage * 100),
    requiredCompleteNutritionDays: minCompleteDays,
    requiredWearableCoveragePct: Math.round(minWearableCoverage * 100),
    nutritionSufficient,
    wearableSufficient
  };
}

module.exports = {
  DAY_COMPLETENESS_STATES,
  OURA_PAIRED_HISTORY_MIN_COMPLETE_DAYS,
  OURA_PAIRED_HISTORY_MIN_WEARABLE_COVERAGE,
  normalizeDayCompletenessState,
  isExplicitlyCompleteDay,
  inferSuggestedDayState,
  buildDayCompleteness,
  summarizeDayCompleteness,
  evaluateOuraPairedHistoryCoverage
};
