const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTodayPresentation } = require('../public/today-state');

const now = new Date('2026-07-27T16:00:00.000Z');

function summary(overrides = {}) {
  return {
    generatedAt: '2026-07-27T15:58:00.000Z',
    empty: false,
    macros: {
      state: 'tracked',
      totals: { calories: 1200, protein: 90, carbs: 110, fat: 40 },
      targets: { calories: 2000, protein: 160, carbs: 220, fat: 70 },
      remaining: { calories: 800, protein: 70, carbs: 110, fat: 30 }
    },
    workout: {
      state: 'not_logged',
      weeklyActiveDays: 2,
      targetPerWeek: 4,
      activeCalories: 0
    },
    weight: {
      state: 'on_cadence',
      latestWeight: 181.4,
      daysSinceLast: 3,
      cadenceDays: 7
    },
    recovery: {
      state: 'current',
      sleepHours: 7.75,
      wakeUps: 1,
      lastLoggedAt: '2026-07-27T08:00:00.000Z',
      sourceLabel: 'Apple Health',
      ouraStatus: 'disconnected'
    },
    ...overrides
  };
}

test('Today presentation exposes clear next actions for empty and partial data', () => {
  const empty = buildTodayPresentation({
    summary: summary({
      empty: true,
      macros: {
        state: 'needs_targets',
        totals: {},
        targets: {},
        remaining: {}
      },
      recovery: { state: 'empty', ouraStatus: 'disconnected' },
      weight: { state: 'empty', cadenceDays: 7 },
      workout: { state: 'not_logged', weeklyActiveDays: 0, targetPerWeek: 0 }
    }),
    now
  });

  assert.equal(empty.empty, true);
  assert.equal(empty.macro.needsTargets, true);
  assert.equal(empty.recovery.value, 'No data');
  assert.equal(empty.recovery.actionLabel, 'Log Sleep');
  assert.equal(empty.weight.actionLabel, 'Log Weight');
  assert.equal(empty.workout.actionLabel, 'Log Workout');
});

test('Today presentation keeps the latest snapshot visible while offline', () => {
  const offline = buildTodayPresentation({
    summary: summary(),
    online: false,
    lastUpdatedAt: '2026-07-27T15:00:00.000Z',
    now
  });

  assert.equal(offline.hasSnapshot, true);
  assert.equal(offline.freshness.title, 'Showing saved Today data');
  assert.equal(offline.freshness.tone, 'warning');
  assert.equal(offline.sync.value, 'Offline');
  assert.equal(offline.macro.remainingCalories, '800');
});

test('Today presentation has a useful first-load offline state', () => {
  const offline = buildTodayPresentation({
    summary: null,
    online: false,
    error: new Error('network unavailable'),
    now
  });

  assert.equal(offline.hasSnapshot, false);
  assert.equal(offline.freshness.title, 'Offline');
  assert.match(offline.freshness.detail, /Quick logging remains available/);
});

test('Today presentation calls out stale snapshots and stale recovery separately', () => {
  const stale = buildTodayPresentation({
    summary: summary({
      recovery: {
        state: 'stale',
        sleepHours: 6.5,
        wakeUps: 3,
        ageHours: 72,
        sourceLabel: 'Apple Health',
        ouraStatus: 'disconnected'
      }
    }),
    lastUpdatedAt: '2026-07-27T15:00:00.000Z',
    now
  });

  assert.equal(stale.freshness.title, 'Showing an older snapshot');
  assert.match(stale.recovery.detail, /3 days old/);
});

test('Today presentation distinguishes Oura disconnected from available Oura recovery', () => {
  const disconnected = buildTodayPresentation({ summary: summary(), now });
  const connected = buildTodayPresentation({
    summary: summary({
      recovery: {
        state: 'current',
        sleepHours: 8.2,
        wakeUps: 0,
        lastLoggedAt: '2026-07-27T08:00:00.000Z',
        sourceLabel: 'Oura',
        ouraStatus: 'connected'
      }
    }),
    now
  });

  assert.match(disconnected.recovery.source, /Apple Health · updated 8 hr ago · Oura not connected/);
  assert.equal(disconnected.recovery.detail, '1 wake-up');
  assert.match(connected.recovery.source, /Oura · updated 8 hr ago/);
});
