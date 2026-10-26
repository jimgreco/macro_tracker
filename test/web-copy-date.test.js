const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
function fixture() {
  const calls = [], banners = [];
  const context = vm.createContext({ state: { currentUser: { id: 'synthetic' } }, crypto: { randomUUID: (() => { let id = 0; return () => `uuid-${++id}`; })() },
    getLocalIsoDay: value => value ? value.slice(0, 10) : '2026-10-26', getTimezone: () => 'America/New_York',
    api: async (url, request) => { calls.push({ url, ...request }); return { copiedCount: 2 }; },
    refreshAfterMealSave: async message => banners.push(message), calls, banners });
  vm.runInContext(source.slice(source.indexOf('function createReplaySafePost()'), source.indexOf('const postParsedMeal')), context);
  vm.runInContext('const postCopiedEntries = createReplaySafePost();', context);
  vm.runInContext(source.slice(source.indexOf('function canCopyEntryToToday('), source.indexOf('function copyDateControls(')), context);
  return context;
}
test('copy date retains item/meal identity, timezone and stable retry IDs without changing nutrition', async () => {
  const c = fixture(); let fail = true;
  c.api = async (url, request) => { c.calls.push({ url, ...request }); if (fail) throw Error('Interrupted'); return { copiedCount: 2 }; };
  const copy = c.buildCopyMealToTodayHandler('meal', { consumedAt: '2026-10-20T14:15:00Z' });
  await assert.rejects(copy('2026-10-24'), /Interrupted/);
  fail = false; await copy('2026-10-24');
  assert.equal(c.calls[0].headers['X-Client-Mutation-Id'], c.calls[1].headers['X-Client-Mutation-Id']);
  assert.deepEqual(JSON.parse(c.calls[1].body), { mealGroup: 'meal', targetDay: '2026-10-24', tz: 'America/New_York' });
  await c.buildCopyEntryToTodayHandler({ id: 3, consumedAt: '2026-10-20T14:15:00Z' })();
  assert.deepEqual(JSON.parse(c.calls[2].body), { entryId: 3, targetDay: '2026-10-26', tz: 'America/New_York' });
  assert.notEqual(c.calls[1].headers['X-Client-Mutation-Id'], c.calls[2].headers['X-Client-Mutation-Id']);
});
test('invalid date and overlapping submissions do not create another write', async () => {
  const c = fixture(); const copy = c.buildCopyEntryToTodayHandler({ id: 3, consumedAt: '2026-10-20T14:15:00Z' });
  for (const day of ['2026-10-20', '2026-10-19', '2026-10-27', '']) await assert.rejects(copy(day), /Choose a date/);
  assert.equal(c.calls.length, 0);
  let resolve; c.api = () => new Promise(yes => { resolve = yes; });
  const first = copy('2026-10-24');
  await assert.rejects(copy('2026-10-24'), /already in progress/);
  resolve({ copiedCount: 1 }); await first;
  assert.equal(c.state.copyEntryBusy, false);
});
