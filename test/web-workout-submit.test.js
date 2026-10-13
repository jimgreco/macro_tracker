const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');

function fixture() {
  const requests = [], banners = [];
  const element = () => ({ value: '', disabled: false, hidden: false, textContent: '', addEventListener(_name, fn) { this.click = fn; } });
  const names = ['workoutTextEl', 'workoutLoggedAtEl', 'workoutDescriptionEl', 'workoutIntensityEl', 'workoutHoursEl', 'workoutCaloriesEl', 'parseWorkoutBtnEl', 'saveWorkoutBtnEl', 'workoutEditorEl'];
  const context = vm.createContext({
    ...Object.fromEntries(names.map(name => [name, element()])),
    workoutQuickListEl: null, state: { pendingWorkout: null },
    api: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    toDateTimeLocalValue: () => '2026-10-12T18:30', asIso: value => value,
    normalizeWorkoutIntensity: value => value || 'medium',
    setActionBanner: (message, type) => banners.push({ message, type }),
    parseWorkoutInput: () => ({description:'Fallback run',intensity:'low',durationHours:0.5}),
    estimateWorkoutCalories: () => 150,
    refreshWorkoutData: async () => {}
  });
  const start = source.indexOf('let workoutFormAction =');
  vm.runInContext(source.slice(start, source.indexOf('if (syncWorkoutsBtnEl)', start)), context);
  const saveStart = source.indexOf('if (saveWorkoutBtnEl) {', source.indexOf('if (syncWorkoutsBtnEl)', start));
  vm.runInContext(source.slice(saveStart, source.indexOf('\n}', saveStart) + 2), context);
  context.workoutTextEl.value = 'A run';
  const parse = async () => {
    const operation = context.parseWorkoutBtnEl.click();
    requests.at(-1).resolve({description:'Run',intensity:'medium',durationHours:0.5,caloriesBurned:200});
    await operation;
  };
  return {context, requests, banners, parse};
}

test('parsing locks saving and prevents a second parse from replacing the pending result', async () => {
  const {context:c, requests, parse} = fixture();
  await parse();
  assert.equal(c.saveWorkoutBtnEl.disabled, false);
  const pending = c.parseWorkoutBtnEl.click();
  await c.saveWorkoutBtnEl.click();
  await c.parseWorkoutBtnEl.click();
  assert.equal(requests.length, 2);
  assert.equal(c.saveWorkoutBtnEl.disabled, true);
  assert.equal(c.workoutDescriptionEl.disabled, true);
  requests[1].resolve({description:'New run',durationHours:1,caloriesBurned:300});
  await pending;
  assert.equal(c.workoutDescriptionEl.value, 'New run');
  assert.equal(c.saveWorkoutBtnEl.disabled, false);
  assert.equal(c.parseWorkoutBtnEl.textContent, 'Parse Workout');
});

test('workout save blocks duplicate saves and parsing, and keeps edits for a failed-save retry', async () => {
  const {context:c, requests, banners, parse} = fixture();
  await parse();
  c.workoutDescriptionEl.value = 'Edited run';
  c.workoutHoursEl.value = '0.75';
  const saving = c.saveWorkoutBtnEl.click();
  await c.saveWorkoutBtnEl.click();
  await c.parseWorkoutBtnEl.click();
  assert.equal(requests.length, 2);
  assert.equal(c.workoutTextEl.disabled, true);
  assert.equal(c.workoutLoggedAtEl.disabled, true);
  assert.equal(c.workoutHoursEl.disabled, true);
  assert.equal(c.saveWorkoutBtnEl.textContent, 'Saving…');
  requests[1].reject(new Error('Temporary save failure'));
  await saving;
  assert.equal(c.workoutDescriptionEl.value, 'Edited run');
  assert.equal(c.workoutHoursEl.value, '0.75');
  assert.equal(c.workoutEditorEl.hidden, false);
  assert.equal(c.saveWorkoutBtnEl.disabled, false);
  assert.equal(banners.at(-1).message, 'Temporary save failure');
  const retry = c.saveWorkoutBtnEl.click();
  assert.equal(requests[2].options.body, requests[1].options.body);
  requests[2].resolve({});
  await retry;
  assert.equal(c.state.pendingWorkout, null);
  assert.equal(c.workoutEditorEl.hidden, true);
  assert.equal(c.saveWorkoutBtnEl.disabled, true);
  assert.equal(c.parseWorkoutBtnEl.disabled, false);
  assert.equal(c.workoutTextEl.value, '');
});

test('a parser failure still creates a reviewable fallback workout and releases the form', async () => {
  const {context:c, requests} = fixture();
  const parsing = c.parseWorkoutBtnEl.click();
  requests[0].reject(new Error('Parse unavailable'));
  await parsing;
  assert.equal(c.workoutDescriptionEl.value, 'Fallback run');
  assert.equal(c.workoutCaloriesEl.value, '150');
  assert.equal(c.saveWorkoutBtnEl.disabled, false);
  assert.equal(c.workoutTextEl.disabled, false);
});

test('save cannot submit an unparsed empty workout', async () => {
  const {context:c, requests} = fixture();
  await c.saveWorkoutBtnEl.click();
  assert.equal(requests.length, 0);
});
