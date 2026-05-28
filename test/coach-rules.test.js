const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../public/coach-rules.js');

const TODAY = '2026-05-27';
const NOW = new Date('2026-05-27T16:30:00');

function day(offset) {
  return rules.shiftIsoDay(TODAY, offset);
}

function macroDay(offset, overrides = {}) {
  return {
    day: day(offset),
    calories: 1800,
    protein: 160,
    carbs: 160,
    fat: 60,
    ...overrides
  };
}

function baseContext(overrides = {}) {
  return {
    today: TODAY,
    now: NOW,
    dashboardData: {
      targets: {
        calories: 1900,
        protein: 160,
        carbs: 160,
        fat: 60,
        workouts: 4,
        workout_calories: 1800
      },
      entries: [],
      previousDays: [],
      currentDayTotals: { day: TODAY, calories: 0, protein: 0, carbs: 0, fat: 0 }
    },
    macroDailyTotals: [],
    workoutEntries: [],
    weightEntries: [],
    weightChartEntries: [],
    weightTargetData: null,
    weightTarget: null,
    savedItems: [],
    sleepChartRows: [],
    sleepTargetHours: 8,
    ...overrides
  };
}

test('macro protein coach requires enough complete days and repeated misses', () => {
  const lowData = baseContext({
    macroDailyTotals: [
      macroDay(-1, { protein: 90 }),
      macroDay(-2, { protein: 92 }),
      macroDay(-3, { protein: 94 }),
      macroDay(-4, { protein: 96 })
    ]
  });
  assert.equal(rules.buildCoachCandidates('macros', lowData).some((s) => s.category === 'protein-shortfall'), false);

  const borderline = baseContext({
    macroDailyTotals: [
      macroDay(-1, { protein: 90 }),
      macroDay(-2, { protein: 92 }),
      macroDay(-3, { protein: 94 }),
      macroDay(-4, { protein: 150 }),
      macroDay(-5, { protein: 152 })
    ]
  });
  assert.equal(rules.buildCoachCandidates('macros', borderline).some((s) => s.category === 'protein-shortfall'), false);

  const highConfidence = baseContext({
    macroDailyTotals: [
      macroDay(-1, { protein: 90 }),
      macroDay(-2, { protein: 92 }),
      macroDay(-3, { protein: 94 }),
      macroDay(-4, { protein: 96 }),
      macroDay(-5, { protein: 155 })
    ]
  });
  const suggestion = rules.buildCoachCandidates('macros', highConfidence).find((s) => s.category === 'protein-shortfall');
  assert.ok(suggestion);
  assert.equal(suggestion.confidence >= 0.85, true);
  assert.equal(suggestion.modelSource, 'local_rules');
  assert.equal(suggestion.evidence[0].includes('4 recent complete days'), true);
});

test('coach rules attach to a browser-style global', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/coach-rules.js'), 'utf8');
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context);

  assert.equal(typeof context.DailyMacrosCoachRules?.buildCoachCandidates, 'function');
  assert.equal(typeof context.DailyMacrosCoachRules?.isSuggestionDismissed, 'function');
});

test('missed meal coach requires learned daypart history and late timing', () => {
  const entries = [
    { itemName: 'yogurt', consumedAt: `${day(-1)}T08:10:00` },
    { itemName: 'eggs', consumedAt: `${day(-2)}T08:20:00` }
  ];
  const tooLittleHistory = baseContext({ dashboardData: { ...baseContext().dashboardData, entries } });
  assert.equal(rules.buildCoachCandidates('macros', tooLittleHistory).some((s) => s.category === 'missed-breakfast'), false);

  const learnedEntries = [
    ...entries,
    { itemName: 'oats', consumedAt: `${day(-3)}T08:30:00` }
  ];
  const notLateYet = baseContext({
    now: new Date('2026-05-27T09:00:00'),
    dashboardData: { ...baseContext().dashboardData, entries: learnedEntries }
  });
  assert.equal(rules.buildCoachCandidates('macros', notLateYet).some((s) => s.category === 'missed-breakfast'), false);

  const lateEnough = baseContext({
    now: new Date('2026-05-27T11:00:00'),
    dashboardData: { ...baseContext().dashboardData, entries: learnedEntries }
  });
  assert.equal(rules.buildCoachCandidates('macros', lateEnough).some((s) => s.category === 'missed-breakfast'), true);
});

test('alcohol coach uses specific tags and avoids non-alcohol false positives', () => {
  assert.equal(rules.alcoholTag('root beer'), null);
  assert.equal(rules.alcoholTag('non-alcoholic IPA'), null);
  assert.equal(rules.alcoholTag('IPA'), 'beer');
  assert.equal(rules.alcoholTag('hard seltzer'), 'hard seltzer');
  assert.equal(rules.alcoholTag('margarita'), 'cocktail');

  const context = baseContext({
    dashboardData: {
      ...baseContext().dashboardData,
      entries: [
        { itemName: 'IPA', calories: 180, consumedAt: `${day(-1)}T20:00:00` },
        { itemName: 'hard seltzer', calories: 120, consumedAt: `${day(-2)}T20:00:00` },
        { itemName: 'root beer', calories: 160, consumedAt: `${day(-3)}T20:00:00` }
      ]
    }
  });
  const suggestion = rules.buildCoachCandidates('macros', context).find((s) => s.category === 'alcohol');
  assert.ok(suggestion);
  assert.equal(suggestion.evidence[0].includes('2 alcohol days'), true);
});

test('macro coach suggests saved item cleanup only with strong local evidence', () => {
  const context = baseContext({
    savedItems: [
      { name: 'Greek Yogurt Bowl', quantity: 1, unit: 'bowl', calories: 320, protein: 28, carbs: 34, fat: 8, usageCount: 4 },
      { name: 'Greek Yogurt Bowl', quantity: 1, unit: 'bowl', calories: 320, protein: 28, carbs: 34, fat: 8, usageCount: 0 },
      { name: 'Protein Bar', quantity: 1, unit: 'bar', calories: 230, protein: 14, carbs: 20, fat: 8, usageCount: 2 },
      { name: 'Turkey Wrap', quantity: 1, unit: 'wrap', calories: 410, protein: 32, carbs: 38, fat: 14, usageCount: 1 }
    ]
  });
  const suggestion = rules.buildCoachCandidates('macros', context).find((s) => s.category === 'cleanup');
  assert.ok(suggestion);
  assert.equal(suggestion.action.type, 'focus-quick-add');
});

test('workout target reminder does not fire after target is met', () => {
  const target = { ...baseContext().dashboardData.targets, workouts: 3 };
  const behind = baseContext({
    dashboardData: { ...baseContext().dashboardData, targets: target },
    workoutEntries: [
      { loggedAt: `${day(-8)}T12:00:00`, durationHours: 1, caloriesBurned: 300 },
      { loggedAt: `${day(-12)}T12:00:00`, durationHours: 1, caloriesBurned: 300 },
      { loggedAt: `${day(-16)}T12:00:00`, durationHours: 1, caloriesBurned: 300 },
      { loggedAt: `${day(-20)}T12:00:00`, durationHours: 1, caloriesBurned: 300 }
    ]
  });
  assert.equal(rules.buildCoachCandidates('workout', behind).some((s) => s.category === 'workout-target-behind'), true);

  const met = baseContext({
    dashboardData: { ...baseContext().dashboardData, targets: target },
    workoutEntries: [
      { loggedAt: `${TODAY}T12:00:00`, durationHours: 1, caloriesBurned: 300 },
      { loggedAt: `${day(-1)}T12:00:00`, durationHours: 1, caloriesBurned: 300 },
      { loggedAt: `${day(-2)}T12:00:00`, durationHours: 1, caloriesBurned: 300 },
      { loggedAt: `${day(-8)}T12:00:00`, durationHours: 1, caloriesBurned: 300 }
    ]
  });
  const metSuggestions = rules.buildCoachCandidates('workout', met);
  assert.equal(metSuggestions.some((s) => s.category === 'workout-target-behind'), false);
  assert.equal(metSuggestions.some((s) => s.category === 'workout-target-hit'), true);
});

test('weight coach ignores single weigh-ins and flags repeated off-track trend', () => {
  const single = baseContext({
    weightTargetData: { targetWeight: 180 },
    weightChartEntries: [{ loggedAt: `${day(-1)}T07:00:00`, weight: 195 }]
  });
  assert.equal(rules.buildCoachCandidates('weight', single).length, 0);

  const offTrack = baseContext({
    weightTargetData: { targetWeight: 180 },
    weightChartEntries: [
      { loggedAt: `${day(-21)}T07:00:00`, weight: 195 },
      { loggedAt: `${day(-14)}T07:00:00`, weight: 195.1 },
      { loggedAt: `${day(-7)}T07:00:00`, weight: 195.2 },
      { loggedAt: `${day(-1)}T07:00:00`, weight: 195.3 }
    ]
  });
  assert.equal(rules.buildCoachCandidates('weight', offTrack).some((s) => s.category === 'weight-off-track'), true);
});

test('sleep coach requires five nights and uses the target threshold', () => {
  const tooLittle = baseContext({
    sleepChartRows: [
      { time: new Date(`${day(-3)}T00:00:00`).getTime(), value: 6 },
      { time: new Date(`${day(-2)}T00:00:00`).getTime(), value: 6.25 },
      { time: new Date(`${day(-1)}T00:00:00`).getTime(), value: 6.5 }
    ]
  });
  assert.equal(rules.buildCoachCandidates('sleep', tooLittle).some((s) => s.category === 'sleep-below-target'), false);

  const enough = baseContext({
    sleepChartRows: [-5, -4, -3, -2, -1].map((offset) => ({
      time: new Date(`${day(offset)}T00:00:00`).getTime(),
      value: 6.5
    }))
  });
  assert.equal(rules.buildCoachCandidates('sleep', enough).some((s) => s.category === 'sleep-below-target'), true);
});

test('sleep coach celebrates meaningful improvement before nudging below-target averages', () => {
  const improving = baseContext({
    sleepChartRows: [-6, -5, -4, -3, -2, -1].map((offset, index) => ({
      time: new Date(`${day(offset)}T00:00:00`).getTime(),
      value: [5.5, 5.75, 6, 6.5, 6.75, 7][index]
    }))
  });
  const suggestions = rules.buildCoachCandidates('sleep', improving);
  assert.equal(suggestions.some((s) => s.category === 'sleep-improving'), true);
  assert.equal(suggestions.some((s) => s.category === 'sleep-below-target'), false);
});

test('coach dismissals distinguish today expiry from persistent pattern dismissal', () => {
  const suggestion = {
    todayKey: 'web:macros:protein-shortfall:2026-05-27',
    patternKey: 'web:macros:protein-shortfall'
  };
  const beforeExpiry = {
    today: new Map([[suggestion.todayKey, new Date('2026-05-28T00:00:00').getTime()]]),
    pattern: new Set()
  };
  assert.equal(rules.isSuggestionDismissed(suggestion, beforeExpiry, new Date('2026-05-27T16:00:00')), true);
  assert.equal(rules.isSuggestionDismissed(suggestion, beforeExpiry, new Date('2026-05-28T00:01:00')), false);

  const pattern = {
    today: new Map(),
    pattern: new Set([suggestion.patternKey])
  };
  assert.equal(rules.isSuggestionDismissed(suggestion, pattern, new Date('2026-06-01T12:00:00')), true);
});
