const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function fixture(currentTarget = 8) {
  const elements = new Map();
  const created = [];
  const requests = [];
  const refreshes = [];
  function node() {
    return {
      value: '', disabled: false, removed: false, attributes: {}, listeners: {},
      focus() {}, select() {}, remove() { this.removed = true; },
      addEventListener(event, handler) { this.listeners[event] = handler; },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      querySelector(selector) { return selector === '[role="alert"]' ? created[1] : { before() {} }; },
      querySelectorAll() { return [...elements.values()]; },
      set innerHTML(html) {
        for (const match of html.matchAll(/<(input|button)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
          const control = node();
          control.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
          elements.set(match[3], control);
        }
      }
    };
  }
  const state = { sleepTargetHours: currentTarget };
  const context = vm.createContext({
    state, document: { getElementById: id => elements.get(id), createElement() { const el = node(); created.push(el); return el; }, body: { appendChild() {} } },
    getSleepTargetHours: () => state.sleepTargetHours, fmtNumber: String, escapeAttr: String,
    getLocalIsoDay: () => '2026-10-12', getTimezone: () => 'America/New_York',
    api: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    setActionBanner() {}, mergeTodayTargets: targets => refreshes.push(['today', targets.sleep_hours]),
    renderSleepChart: () => refreshes.push(['chart']), renderCoachForPage: page => refreshes.push(['coach', page]),
  });
  vm.runInContext(['createLogEditActions', 'showSleepTargetModal'].map(browserFunction).join('\n'), context);
  context.showSleepTargetModal();
  return { state, requests, refreshes, overlay: created[0], error: created[1], elements,
    input: elements.get('sleep-target-modal-hours'),
    click: action => elements.get(`sleep-target-modal-${action}-btn`).listeners.click() };
}

for (const action of ['save', 'clear']) {
  test(`sleep target ${action} retains failed drafts and blocks overlapping writes and dismissal`, async () => {
    const { state, requests, refreshes, overlay, error, input, elements, click } = fixture();
    input.value = '7.25';
    const saving = click(action);
    assert.equal(overlay.removed, false);
    assert.equal(input.disabled, true);
    await click('save');
    await click('clear');
    await click('cancel');
    overlay.listeners.click({ target: overlay });
    overlay.listeners.keydown({ key: 'Escape' });
    assert.equal(overlay.removed, false);
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].options.body).target, action === 'clear' ? 0 : 7.25);
    requests[0].reject(new Error('Target save unavailable'));
    await saving;
    assert.equal(overlay.removed, false);
    assert.equal(state.sleepTargetHours, 8);
    assert.equal(input.value, '7.25');
    assert.equal(input.disabled, false);
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, 'Target save unavailable');
    assert.equal(elements.get('sleep-target-modal-clear-btn').disabled, false);
    assert.equal(refreshes.length, 0);
    const retry = click(action);
    requests[1].resolve({ ok: true });
    await retry;
    const target = action === 'clear' ? 0 : 7.25;
    assert.equal(state.sleepTargetHours, target);
    assert.equal(state.dashboardData.targets.sleep_hours, target);
    assert.equal(overlay.removed, true);
    assert.deepEqual(refreshes, [['today', target], ['chart'], ['coach', 'sleep']]);
  });
}

test('failed save restores Clear Target to disabled when no previous target exists', async () => {
  const { requests, elements, input, click } = fixture(0);
  input.value = '7.5';
  const saving = click('save');
  requests[0].reject(new Error('Offline'));
  await saving;
  assert.equal(elements.get('sleep-target-modal-clear-btn').disabled, true);
});

for (const value of ['0.01', '0', '-1', '25', '']) {
  test(`sleep target ${JSON.stringify(value)} cannot clear the goal through rounding`, async () => {
    const { requests, state, input, error, overlay, click } = fixture();
    input.value = value;
    await click('save');
    assert.equal(requests.length, 0);
    assert.equal(state.sleepTargetHours, 8);
    assert.equal(overlay.removed, false);
    assert.equal(input.value, value);
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /between 0.25 and 24/);
  });
}

test('the minimum quarter-hour target stays positive', async () => {
  const { requests, state, input, click } = fixture();
  input.value = '0.25';
  const saving = click('save');
  assert.equal(JSON.parse(requests[0].options.body).target, 0.25);
  requests[0].resolve({ ok: true });
  await saving;
  assert.equal(state.sleepTargetHours, 0.25);
});
