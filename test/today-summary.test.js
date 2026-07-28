const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTodaySummary,
  isoDayInTimezone
} = require('../src/today-summary');

const now = new Date('2026-07-27T16:00:00.000Z');

function dashboard(overrides = {}) {
  return {
    currentDayTotals: {
      day: '2026-07-27',
      calories: 1200,
      protein: 90,
      carbs: 110,
      fat: 40
    },
    previousDays: [],
    entries: [{ id: 1 }],
    targets: {
      calories: 2000,
      protein: 160,
      carbs: 220,
      fat: 70,
      workouts: 4,
      workout_calories: 1600,
      sleep_hours: 8
    },
    ...overrides
  };
}

test('Today summary keeps an empty account useful without inventing measurements', () => {
  const summary = buildTodaySummary({ now });

  assert.equal(summary.empty, true);
  assert.equal(summary.macros.state, 'needs_targets');
  assert.equal(summary.macros.remaining.calories, null);
  assert.equal(summary.workout.state, 'not_logged');
  assert.equal(summary.weight.state, 'empty');
  assert.equal(summary.recovery.state, 'empty');
  assert.equal(summary.recovery.ouraStatus, 'unavailable');
});

test('Today summary calculates remaining macros and current workout state', () => {
  const summary = buildTodaySummary({
    now,
    dashboard: dashboard(),
    workouts: {
      entries: [{
        id: 1,
        description: 'Strength',
        caloriesBurned: 325,
        loggedAt: '2026-07-27T12:00:00.000Z'
      }],
      dailyCalories: [{ day: '2026-07-27', calories: 325 }]
    }
  });

  assert.equal(summary.empty, false);
  assert.equal(summary.macros.remaining.calories, 800);
  assert.equal(summary.macros.remaining.protein, 70);
  assert.equal(summary.workout.state, 'logged');
  assert.equal(summary.workout.activeCalories, 325);
  assert.equal(summary.workout.latestDescription, 'Strength');
  assert.equal(summary.workout.weeklyActiveDays, 1);
});

test('Today summary reports weight cadence instead of daily weight judgment', () => {
  const onCadence = buildTodaySummary({
    now,
    dashboard: dashboard(),
    weights: {
      entries: [{
        id: 1,
        weight: 181.4,
        loggedAt: '2026-07-24T12:00:00.000Z',
        source: 'healthkit'
      }]
    },
    weightTarget: { targetWeight: 178, targetDate: '2026-12-31' }
  });
  const due = buildTodaySummary({
    now,
    dashboard: dashboard(),
    weights: {
      entries: [{
        id: 1,
        weight: 181.4,
        loggedAt: '2026-07-18T12:00:00.000Z'
      }]
    }
  });

  assert.equal(onCadence.weight.state, 'on_cadence');
  assert.equal(onCadence.weight.daysSinceLast, 3);
  assert.equal(onCadence.weight.targetWeight, 178);
  assert.equal(due.weight.state, 'due');
  assert.equal(due.weight.daysSinceLast, 9);
});

test('Today recovery distinguishes current Oura data, disconnected data, and stale fallback data', () => {
  const currentOura = buildTodaySummary({
    now,
    dashboard: dashboard(),
    sleep: {
      entries: [{
        id: 1,
        durationHours: 7.75,
        wakeUps: 1,
        quality: 4,
        loggedAt: '2026-07-27T10:00:00.000Z',
        source: 'oura'
      }]
    }
  });
  const staleHealthKit = buildTodaySummary({
    now,
    dashboard: dashboard(),
    sleep: {
      entries: [{
        id: 2,
        durationHours: 6.5,
        wakeUps: 3,
        quality: 2,
        loggedAt: '2026-07-24T08:00:00.000Z',
        source: 'healthkit'
      }]
    }
  });
  const disconnected = buildTodaySummary({
    now,
    dashboard: dashboard(),
    sleep: {
      entries: [{
        id: 3,
        durationHours: 7,
        wakeUps: 2,
        loggedAt: '2026-07-24T08:00:00.000Z',
        source: 'healthkit'
      }]
    },
    ouraStatus: 'disconnected'
  });

  assert.equal(currentOura.recovery.state, 'current');
  assert.equal(currentOura.recovery.sourceLabel, 'Oura');
  assert.equal(currentOura.recovery.ouraStatus, 'connected');
  assert.equal(staleHealthKit.recovery.state, 'stale');
  assert.equal(staleHealthKit.recovery.sourceLabel, 'Apple Health');
  assert.equal(staleHealthKit.recovery.ouraStatus, 'unavailable');
  assert.equal(disconnected.recovery.ouraStatus, 'disconnected');
});

test('Today date grouping follows the account timezone near midnight', () => {
  assert.equal(
    isoDayInTimezone('2026-07-28T02:00:00.000Z', 'America/New_York'),
    '2026-07-27'
  );
  assert.equal(
    isoDayInTimezone('2026-07-28T02:00:00.000Z', 'Europe/London'),
    '2026-07-28'
  );
});
