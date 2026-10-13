const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual browser loaders with controllable network completion order.
const source = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing browser function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function harness() {
  const requests = [];
  const renders = [];
  const errors = [];
  const state = { dashboardData: {}, features: { sexualActivity: true } };
  const context = {
    state, URLSearchParams, LOG_PAGE_SIZE: 2,
    console: { error: (...args) => errors.push(args) },
    api: (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    getTimezone: () => 'America/New_York',
    setActionBanner: (message) => errors.push(message),
    renderPagedLogList: ({ kind }) => renders.push(kind),
    refreshWaistData() {}, refreshCheckins() {}, bindSnapshotToggles() {},
    cacheDayCompletenessRows() {}, setMacroTargetHistory() {},
    drawTrend() {}, renderSnapshotStats() {}, renderAllCoachSlots() {},
    renderWeightChart() {}, renderWorkoutChart() {}, renderWorkoutStats() {},
    renderWorkoutQuickAdds() {}, renderSleepChart() {}, renderRecovery() {},
    setSleepTargetFromTargets() {}, drawHealthOccurrenceChart() {},
    renderCoachForPage() {}, syncFeatureVisibility() {}
  };
  for (const kind of ['weight', 'sleep', 'health', 'workout']) {
    state[`${kind}SnapshotPeriod`] = 'weekly';
    state[`${kind}Entries`] = [];
    context[`${kind}LogListEl`] = {};
    context[`render${kind[0].toUpperCase()}${kind.slice(1)}Card`] = () => '';
  }
  state.macroSnapshotPeriod = 'weekly';
  vm.createContext(context);
  vm.runInContext([
    'let macroSnapshotRequestRevision = 0;',
    ...['getLogPaging', 'resetLogPaging', 'appendUniqueById', 'buildLogPageUrl',
      'refreshMacroSnapshotData', 'refreshWeightData', 'refreshSleepData',
      'refreshHealthData', 'refreshWorkoutData'].map(browserFunction)
  ].join('\n'), context);
  return { context, state, requests, renders, errors };
}

function response(id) {
  return {
    entries: [{ id, loggedAt: '2026-10-12T12:00:00Z', weight: 160 }],
    dailyTotals: [], dailyCalories: [], dailyTypes: [], targetWeight: 155,
    daysCounted: 7, targets: { calories: id }
  };
}

for (const kind of ['weight', 'sleep', 'health', 'workout']) {
  const loader = `refresh${kind[0].toUpperCase()}${kind.slice(1)}Data`;

  test(`${kind}: a late previous-period response cannot overwrite the selected period`, async () => {
    const { context, state, requests, renders } = harness();
    const previous = context[loader]();
    const previousRequests = requests.splice(0);
    state[`${kind}SnapshotPeriod`] = 'monthly';
    const current = context[loader]();
    const currentRequests = requests.splice(0);
    assert.ok(previousRequests.some(({ url }) => url.includes('scope=week')));
    assert.ok(currentRequests.some(({ url }) => url.includes('scope=month')));
    currentRequests.forEach((request) => request.resolve(response('month')));
    await current;
    const renderCount = renders.length;
    previousRequests.forEach((request) => request.resolve(response('week')));
    await previous;
    assert.equal(state[`${kind}Entries`].map(({ id }) => id).join(','), 'month');
    assert.equal(state.logPaging[kind].offset, 1);
    assert.equal(state.logPaging[kind].loading, false);
    assert.equal(renders.length, renderCount, 'stale data must not redraw the current view');
  });

  test(`${kind}: a stale load-more failure cannot end or disturb a newer refresh`, async () => {
    const { context, state, requests, renders, errors } = harness();
    state[`${kind}Entries`] = [{ id: 'old-page' }];
    context.getLogPaging(kind).offset = 1;
    const previous = context[loader]({ reset: false });
    const previousRequests = requests.splice(0);
    assert.ok(previousRequests.some(({ url }) => url.includes('offset=1')));
    const current = context[loader]();
    const currentRequests = requests.splice(0);
    const renderCount = renders.length;
    previousRequests.forEach((request) => request.reject(new Error('old connection failed')));
    await previous;
    assert.equal(state.logPaging[kind].loading, true);
    assert.equal(state.logPaging[kind].offset, 0);
    assert.equal(state[`${kind}Entries`].length, 0);
    assert.equal(renders.length, renderCount);
    assert.equal(errors.length, 0, 'superseded errors should not show over the new request');
    currentRequests.forEach((request) => request.resolve(response('refreshed')));
    await current;
    assert.equal(state[`${kind}Entries`][0].id, 'refreshed');
    assert.equal(state.logPaging[kind].loading, false);
  });

  test(`${kind}: an old next page cannot append into a refreshed history`, async () => {
    const { context, state, requests } = harness();
    const previous = context[loader]({ reset: false });
    const previousRequests = requests.splice(0);
    const current = context[loader]();
    requests.splice(0).forEach((request) => request.resolve(response('fresh-page')));
    await current;
    previousRequests.forEach((request) => request.resolve(response('stale-next-page')));
    await previous;
    assert.equal(state[`${kind}Entries`].map(({ id }) => id).join(','), 'fresh-page');
  });
}

test('macro snapshot retains the last requested period when responses finish in reverse order', async () => {
  const { context, state, requests } = harness();
  const previous = context.refreshMacroSnapshotData();
  const [previousRequest] = requests.splice(0);
  state.macroSnapshotPeriod = 'annual';
  const current = context.refreshMacroSnapshotData();
  requests.splice(0)[0].resolve({ dailyTotals: [{ day: 'annual' }], targets: { calories: 2200 } });
  await current;
  previousRequest.resolve({ dailyTotals: [{ day: 'weekly' }], targets: { calories: 1800 } });
  await previous;
  assert.equal(state.macroDailyTotals[0].day, 'annual');
  assert.equal(state.dashboardData.targets.calories, 2200);
});

test('macro snapshot same-period refresh also ignores an older response', async () => {
  const { context, state, requests } = harness();
  const previous = context.refreshMacroSnapshotData();
  const [previousRequest] = requests.splice(0);
  const current = context.refreshMacroSnapshotData();
  requests.splice(0)[0].resolve({ dailyTotals: [{ day: 'new' }] });
  await current;
  previousRequest.resolve({ dailyTotals: [{ day: 'old' }] });
  await previous;
  assert.equal(state.macroDailyTotals[0].day, 'new');
});
