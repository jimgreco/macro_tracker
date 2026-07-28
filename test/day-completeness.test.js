const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DAY_COMPLETENESS_STATES,
  buildDayCompleteness,
  evaluateOuraPairedHistoryCoverage,
  normalizeDayCompletenessState,
  summarizeDayCompleteness
} = require('../src/day-completeness');

function nutritionDay(day, state) {
  return { day, completeness: { state } };
}

test('breakfast-only and no-entry days remain ineligible without an explicit complete state', () => {
  const breakfastOnly = buildDayCompleteness({
    day: '2026-07-26',
    today: '2026-07-27',
    timezone: 'America/New_York',
    entryCount: 1,
    daypartCount: 1,
    spanHours: 0
  });
  const noEntry = buildDayCompleteness({
    day: '2026-07-26',
    today: '2026-07-27',
    timezone: 'America/New_York'
  });

  assert.equal(breakfastOnly.state, DAY_COMPLETENESS_STATES.UNKNOWN);
  assert.equal(breakfastOnly.suggestedState, DAY_COMPLETENESS_STATES.PARTIAL);
  assert.equal(breakfastOnly.eligibleForNutritionAnalysis, false);
  assert.equal(noEntry.state, DAY_COMPLETENESS_STATES.UNKNOWN);
  assert.equal(noEntry.suggestedState, null);
  assert.equal(noEntry.eligibleForNutritionAnalysis, false);
});

test('broad logging may suggest completion but never infers eligibility', () => {
  const broadlyLogged = buildDayCompleteness({
    day: '2026-07-25',
    today: '2026-07-27',
    timezone: 'America/Los_Angeles',
    entryCount: 4,
    daypartCount: 3,
    spanHours: 11
  });

  assert.equal(broadlyLogged.state, DAY_COMPLETENESS_STATES.UNKNOWN);
  assert.equal(broadlyLogged.suggestedState, DAY_COMPLETENESS_STATES.COMPLETE);
  assert.equal(broadlyLogged.explicit, false);
  assert.equal(broadlyLogged.eligibleForNutritionAnalysis, false);
});

test('complete, reopen, and legacy incomplete states share one canonical contract', () => {
  const complete = buildDayCompleteness({
    day: '2026-07-24',
    state: 'complete',
    timezone: 'UTC'
  });
  const reopened = buildDayCompleteness({
    day: '2026-07-24',
    state: 'partial',
    timezone: 'UTC'
  });

  assert.equal(complete.eligibleForNutritionAnalysis, true);
  assert.equal(reopened.eligibleForNutritionAnalysis, false);
  assert.equal(normalizeDayCompletenessState('incomplete'), DAY_COMPLETENESS_STATES.PARTIAL);
  assert.deepEqual(
    summarizeDayCompleteness([complete, reopened], 4),
    {
      periodDays: 4,
      completeDays: 1,
      partialDays: 1,
      unknownDays: 2,
      eligibleSampleDays: 1,
      coveragePct: 25
    }
  );
});

test('Oura paired-history eligibility requires enough explicit days and wearable coverage', () => {
  const completeDays = Array.from({ length: 15 }, (_, index) =>
    nutritionDay(`2026-07-${String(index + 1).padStart(2, '0')}`, 'complete')
  );
  const unknownDays = [
    nutritionDay('2026-07-16', 'unknown'),
    nutritionDay('2026-07-17', 'partial')
  ];

  const enoughPaired = evaluateOuraPairedHistoryCoverage({
    nutritionDays: [...completeDays, ...unknownDays],
    wearableDays: completeDays.slice(0, 11).map((row) => row.day)
  });
  assert.equal(enoughPaired.eligible, true);
  assert.equal(enoughPaired.completeNutritionDays, 15);
  assert.equal(enoughPaired.pairedDays, 11);
  assert.equal(enoughPaired.wearableCoveragePct, 73);

  const sparseWearable = evaluateOuraPairedHistoryCoverage({
    nutritionDays: completeDays,
    wearableDays: completeDays.slice(0, 10).map((row) => row.day)
  });
  assert.equal(sparseWearable.eligible, false);
  assert.equal(sparseWearable.wearableCoveragePct, 67);

  const tooFewNutritionDays = evaluateOuraPairedHistoryCoverage({
    nutritionDays: completeDays.slice(0, 9),
    wearableDays: completeDays.slice(0, 9).map((row) => row.day)
  });
  assert.equal(tooFewNutritionDays.eligible, false);
  assert.equal(tooFewNutritionDays.nutritionSufficient, false);
});
