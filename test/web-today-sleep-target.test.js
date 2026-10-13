const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('../public/coach-rules.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function hydrate(sleepHours) {
  const context = vm.createContext({
    state:{sleepTargetHours:8}, getLocalIsoDay:()=> '2026-10-12',
    fromIsoDayLocal: value => new Date(`${value}T12:00:00`),
  });
  vm.runInContext(['hydrateStateFromToday','getSleepTargetHours','buildCoachContext'].map(browserFunction).join('\n'),context);
  context.hydrateStateFromToday({
    summary:{macros:{targets:{sleepHours}}},
    context:{sleep:{entries:[],dailyTotals:Array.from({length:7},(_,i)=>({day:`2026-10-${String(6+i).padStart(2,'0')}`,totalHours:6.5,targetHours:sleepHours}))}}
  });
  return context;
}

test('a cleared sleep target survives Today refresh without reintroducing target coaching', () => {
  const context = hydrate(0);
  assert.equal(context.getSleepTargetHours(),0);
  assert.deepEqual(rules.buildCoachCandidates('sleep',context.buildCoachContext()),[]);
});

test('an active sleep goal still provides target coaching after Today refresh', () => {
  const context = hydrate(8);
  assert.equal(context.getSleepTargetHours(),8);
  assert.ok(rules.buildCoachCandidates('sleep',context.buildCoachContext()).some(candidate=>candidate.category==='sleep-below-target'));
});

test('a missing sleep goal retains the existing default for older Today responses', () => {
  assert.equal(hydrate(undefined).getSleepTargetHours(),8);
  assert.equal(hydrate(null).getSleepTargetHours(),8);
});
