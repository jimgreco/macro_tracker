const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function harness() {
  const requests = [];
  const renders = [];
  const state = { currentUser: { id: 'synthetic-a' }, selectedEntriesDay: '2026-10-23',
    dashboardData: { entries: [{ id: 'recent' }] }, entriesDayLog: null };
  const ctx = vm.createContext({ state, Map, Date, getTimezone: () => 'America/New_York',
    getLocalIsoDay: value => value.slice(0, 10),
    api: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    renderDashboard: () => renders.push(state.selectedEntriesDay), updateCompletenessAcrossState() {} });
  vm.runInContext(['shiftIsoDay', 'macroTrendDays', 'nutritionReviewDays', 'selectedEntriesLog',
    'macroEntrySelectionRows', 'appendUniqueById', 'loadSelectedDayEntries'].map(browserFunction).join('\n'), ctx);
  return { ctx, state, requests, renders };
}
function response(entries, day = '2026-10-23') {
  return { entries: entries.map(entry => ({ consumedAt: `${day}T12:00:00Z`, ...entry })), currentDayTotals: { day, calories: 2500, completeness: { state: 'partial' } }, targets: { calories: 2100 } };
}

for (const [period, days] of [['weekly', 7], ['monthly', 30], ['annual', 365]]) {
  test(`${period}: review dates fill missing days without inferring completeness or changing source`, () => {
    const { ctx } = harness();
    const rows = [{ day: '2026-10-23', completeness: { state: 'partial' } },
      { day: '2026-10-22', calories: 0, completeness: { state: 'complete' } },
      { day: '2026-10-21', completeness: { suggestedState: 'complete' } },
      { day: '2026-10-24', completeness: { state: 'complete' } }];
    const before = JSON.stringify(rows);
    const all = ctx.nutritionReviewDays(rows, period, '2026-10-23', 'all');
    assert.equal(all.length, days);
    assert.equal(all[0].day, '2026-10-23');
    assert.equal(all.at(-1).day, ctx.shiftIsoDay('2026-10-23', 1 - days));
    assert.equal(all[2].state, 'unknown');
    assert.equal(ctx.nutritionReviewDays(rows, period, '2026-10-23').length, days - 1);
    assert.equal(ctx.nutritionReviewDays(rows, period, '2026-10-23', 'complete')[0].day, '2026-10-22');
    assert.equal(JSON.stringify(rows), before);
  });
}

test('review dates cross leap day and DST as calendar days', () => {
  const { ctx } = harness();
  assert.equal(ctx.nutritionReviewDays([], 'weekly', '2024-03-01', 'all')[1].day, '2024-02-29');
  for (const today of ['2026-03-09', '2026-11-02']) {
    const days = ctx.nutritionReviewDays([], 'weekly', today, 'all').map(row => row.day);
    assert.equal(new Set(days).size, 7);
    assert.equal(days[1], ctx.shiftIsoDay(today, -1));
  }
});

test('day pages finish before exposing a meal, and retain global quick-item history', async () => {
  const { ctx, state, requests } = harness();
  const pending = ctx.loadSelectedDayEntries();
  requests.shift().resolve(response(Array.from({ length: 100 }, (_, id) => ({ id }))));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.macroEntrySelectionRows().length, 0, 'partial meal groups must not be editable');
  assert.equal(requests[0].url.includes('offset=100'), true);
  requests.shift().resolve(response([{ id: 100 }]));
  await pending;
  assert.equal(ctx.macroEntrySelectionRows().length, 101);
  assert.equal(state.entriesDayLog.loaded, true);
  assert.equal(state.entriesDayLog.totals.calories, 2500);
  assert.equal(state.dashboardData.entries[0].id, 'recent');
});

test('an interrupted old day stops pagination and cannot overwrite the new day', async () => {
  const { ctx, state, requests, renders } = harness();
  const old = ctx.loadSelectedDayEntries();
  const oldRequest = requests.shift();
  state.selectedEntriesDay = '2026-10-22';
  const current = ctx.loadSelectedDayEntries();
  requests.shift().resolve(response([{ id: 'new' }], '2026-10-22'));
  await current;
  const renderCount = renders.length;
  oldRequest.resolve(response(Array.from({ length: 100 }, (_, id) => ({ id }))));
  await old;
  assert.equal(state.entriesDayLog.entries[0].id, 'new');
  assert.equal(requests.length, 0, 'no second page for the abandoned day');
  assert.equal(renders.length, renderCount);
});

test('repeated same-day reload keeps the latest response and suppresses stale errors', async () => {
  const { ctx, state, requests, renders } = harness();
  const old = ctx.loadSelectedDayEntries();
  const oldRequest = requests.shift();
  const current = ctx.loadSelectedDayEntries();
  requests.shift().resolve(response([{ id: 'latest' }]));
  await current;
  const renderCount = renders.length;
  oldRequest.reject(new Error('abandoned'));
  await old;
  assert.equal(state.entriesDayLog.entries[0].id, 'latest');
  assert.equal(state.entriesDayLog.error, '');
  assert.equal(renders.length, renderCount);
});

test('a backend that ignores day scoping cannot display another day as an empty or partial log', async () => {
  const { ctx, state, requests } = harness();
  const pending = ctx.loadSelectedDayEntries();
  requests.shift().resolve(response([{ id: 'other-day', consumedAt: '2026-10-22T12:00:00Z' }]));
  await pending;
  assert.equal(state.entriesDayLog.loaded, false);
  assert.equal(ctx.macroEntrySelectionRows().length, 0);
  assert.match(state.entriesDayLog.error, /could not be loaded/);
});

test('failed second page stays hidden and retries without losing or duplicating entries', async () => {
  const { ctx, state, requests } = harness();
  const pending = ctx.loadSelectedDayEntries();
  requests.shift().resolve(response(Array.from({ length: 100 }, (_, id) => ({ id }))));
  await new Promise(resolve => setImmediate(resolve));
  requests.shift().reject(new Error('offline'));
  await pending;
  assert.equal(ctx.macroEntrySelectionRows().length, 0);
  assert.equal(state.entriesDayLog.loaded, false);
  const retry = ctx.loadSelectedDayEntries({ append: true });
  assert.match(requests[0].url, /offset=100/);
  requests.shift().resolve(response([{ id: 99 }, { id: 100 }]));
  await retry;
  assert.equal(ctx.macroEntrySelectionRows().length, 101);
  assert.equal(state.entriesDayLog.error, '');
});

for (const change of ['account', 'timezone']) {
  test(`${change} change discards in-flight day data`, async () => {
    const { ctx, state, requests, renders } = harness();
    const pending = ctx.loadSelectedDayEntries();
    if (change === 'account') state.currentUser = { id: 'synthetic-b' };
    else ctx.getTimezone = () => 'Pacific/Auckland';
    const count = renders.length;
    requests.shift().resolve(response([{ id: 'private-old' }]));
    await pending;
    assert.equal(ctx.selectedEntriesLog(), null);
    assert.equal(state.entriesDayLog.entries.length, 0);
    assert.equal(renders.length, count);
  });
}
