const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing browser function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function timestamps() {
  const context = vm.createContext({});
  vm.runInContext(['toDateTimeLocalValue', 'isoToLocalInputValue', 'editedLogTimestamp'].map(browserFunction).join('\n'), context);
  return context;
}

for (const fixture of [
  { timezone: 'America/New_York', original: '2026-10-12T02:45:37.123Z', displayed: '2026-10-11T22:45' },
  { timezone: 'Asia/Tokyo', original: '2026-10-12T22:45:37.123Z', displayed: '2026-10-13T07:45' },
  { timezone: 'America/New_York', original: '2026-11-01T06:30:47.123Z', displayed: '2026-11-01T01:30' }
]) {
  test(`workout editing preserves the original instant in ${fixture.timezone}: ${fixture.original}`, () => {
    const previousTZ = process.env.TZ;
    try {
      process.env.TZ = fixture.timezone;
      const context = timestamps();
      assert.equal(context.isoToLocalInputValue(fixture.original), fixture.displayed);
      assert.equal(context.editedLogTimestamp(fixture.displayed, fixture.original), fixture.original);
    } finally {
      if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
    }
  });
}

test('an intentional workout time change uses the entered local date and time', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(timestamps().editedLogTimestamp('2026-10-13T18:15', '2026-10-12T02:45:37.123Z'), '2026-10-13T22:15:00.000Z');
  } finally {
    if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;
  }
});

test('clearing an edit timestamp cannot silently move a historical entry to now', () => {
  assert.throws(() => timestamps().editedLogTimestamp('', '2026-10-12T02:45:37.123Z'), /Choose a valid date and time/);
  assert.throws(() => timestamps().editedLogTimestamp('invalid', '2026-10-12T02:45:37.123Z'), /Choose a valid date and time/);
});

function modalHarness(kind, { imported = false, refreshFails = false } = {}) {
  const elements = new Map();
  const requests = [];
  const banners = [];
  const created = [];
  function element() {
    const el = {
      disabled: false, value: '', textContent: '', removed: false, listeners: {}, attributes: {},
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; if (name === 'disabled') this.disabled = true; },
      removeAttribute(name) { delete this.attributes[name]; },
      remove() { this.removed = true; }, focus() {},
      querySelector(selector) { return selector === 'h3' ? {} : elements.get(selector.slice(1)); },
      querySelectorAll() { return [...elements.values()].filter(control => control !== this); },
      set innerHTML(html) {
        this.html = html;
        for (const match of html.matchAll(/<(input|select|textarea|button)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
          const control = element();
          control.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
          elements.set(match[3], control);
        }
      }
    };
    return el;
  }
  const api = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement() { const el = element(); created.push(el); return el; }, body: { appendChild() {} } },
    window: { confirm: () => true }, api,
    escapeAttr: String, escapeHtml: String,
    setActionBanner: (message, type) => banners.push({ message, type }),
    normalizeWorkoutIntensity: value => value || 'medium',
    normalizeSleepQuality: value => value || null, normalizeSleepNotes: value => value || null,
    sleepQualityOptions: () => '',
    deleteWeightEntryApi: id => api(`/api/weights/${id}`, { method: 'DELETE' }),
    updateWorkoutEntryApi: (id, payload) => api(`/api/workouts/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
  });
  for (const name of ['refreshWeightData', 'refreshWorkoutData', 'refreshSleepData', 'refreshHealthData']) {
    context[name] = async () => { if (refreshFails) throw new Error('Refresh failed'); };
  }
  const name = `show${kind[0].toUpperCase()}${kind.slice(1)}EditModal`;
  vm.runInContext(['toDateTimeLocalValue', 'isoToLocalInputValue', 'editedLogTimestamp', 'parseWeightInputValue', 'createLogEditActions', name].map(browserFunction).join('\n'), context);
  const entry = { id: 7, loggedAt: '2026-10-12T02:45:37.123Z', weight: 172, description: 'Run', intensity: 'medium', durationHours: 1, caloriesBurned: 350, wakeUps: 1, type: 'other', source: imported ? 'healthkit' : 'manual' };
  context[name](entry);
  return { entry, overlay: created[0], elements, requests, banners, click: action => elements.get(`${kind}-modal-${action}-btn`).listeners.click() };
}

for (const kind of ['weight', 'workout', 'sleep', 'health']) {
  test(`${kind} edits retain changes after failure and prevent overlapping save/delete or dismissal`, async () => {
    const { entry, overlay, elements, requests, banners, click } = modalHarness(kind, { imported: kind === 'sleep' });
    const field = { weight: 'weight', workout: 'desc', sleep: 'notes', health: 'type' }[kind];
    const input = elements.get(`${kind}-modal-${field}`);
    input.value = kind === 'weight' ? '171.5' : 'Changed value';
    const saving = click('save');
    assert.equal(overlay.removed, false);
    assert.equal(elements.get(`${kind}-modal-save-btn`).disabled, true);
    assert.equal(elements.get(`${kind}-modal-delete-btn`).disabled, true);
    assert.equal(overlay.attributes['aria-busy'], 'true');
    await click('save');
    await click('delete');
    await click('cancel');
    overlay.listeners.click({ target: overlay });
    overlay.listeners.keydown?.({ key: 'Escape' });
    assert.equal(overlay.removed, false);
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].options.body).loggedAt, entry.loggedAt);
    requests[0].reject(new Error('Save unavailable'));
    await saving;
    assert.equal(overlay.removed, false);
    assert.equal(input.value, kind === 'weight' ? '171.5' : 'Changed value');
    assert.equal(elements.get(`${kind}-modal-save-btn`).disabled, false);
    assert.equal(banners.at(-1).message, 'Save unavailable');
    if (kind === 'sleep') {
      assert.equal(elements.get('sleep-modal-hours').disabled, true, 'imported objective sleep data stays read-only');
      assert.equal(elements.get('sleep-modal-date').disabled, true);
    }
    const retry = click('save');
    requests[1].resolve({ ok: true });
    await retry;
    assert.equal(overlay.removed, true);
    assert.equal(banners.at(-1).type, 'success');
  });
}

test('failed deletion retains the edit dialog; success plus failed refresh is still reported as deleted', async () => {
  const { overlay, requests, banners, click } = modalHarness('weight', { refreshFails: true });
  const first = click('delete');
  requests[0].reject(new Error('Delete unavailable'));
  await first;
  assert.equal(overlay.removed, false);
  const retry = click('delete');
  requests[1].resolve({ ok: true });
  await retry;
  assert.equal(overlay.removed, true);
  assert.equal(banners.at(-1).type, 'info');
  assert.match(banners.at(-1).message, /^Weight entry deleted\..*could not refresh/);
});
