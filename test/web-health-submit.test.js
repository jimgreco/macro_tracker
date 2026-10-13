const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');

function harness(kind) {
  const requests = [], banners = [];
  const names = {
    weight: ['weightValueEl', 'weightLoggedAtEl'],
    sleep: ['sleepHoursEl', 'sleepWakeUpsEl', 'sleepQualityEl', 'sleepNotesEl', 'sleepLoggedAtEl'],
    health: ['healthActivityTypeEl', 'healthLoggedAtEl']
  }[kind];
  const makeControl = value => ({ value, disabled: false, textContent: 'Save', attributes: {},
    addEventListener(_name, fn) { this.click = fn; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  });
  const title = kind[0].toUpperCase() + kind.slice(1);
  const button = makeControl('');
  const context = vm.createContext({
    [`save${title}BtnEl`]: button,
    ...Object.fromEntries(names.map(name => [name, makeControl('3')])),
    api: (url, options) => new Promise((resolve, reject) => requests.push({url, options, resolve, reject})),
    state: { features: { sexualActivity: true } },
    toDateTimeLocalValue: () => '2026-10-12T12:34', asIso: value => value,
    parseWeightInputValue: Number, normalizeSleepQuality: Number, normalizeSleepNotes: String,
    setActionBanner: (message, type) => banners.push({message, type}),
    [`refresh${title}Data`]: async () => {}
  });
  const helperStart = source.indexOf('function bindExclusiveLogSave(');
  vm.runInContext(source.slice(helperStart, source.indexOf('\n}', helperStart) + 2), context);
  const blockStart = source.indexOf(`if (save${title}BtnEl) {`, helperStart);
  vm.runInContext(source.slice(blockStart, source.indexOf('\n}', blockStart) + 2), context);
  return { button, controls: names.map(name => context[name]), requests, banners, context };
}

for (const kind of ['weight', 'sleep', 'health']) {
  test(`${kind} creation sends only one request while busy and preserves the draft after failure`, async () => {
    const { button, controls, requests, banners } = harness(kind);
    const values = controls.map(control => control.value);
    const first = button.click();
    await button.click();
    assert.equal(requests.length, 1);
    assert.equal(button.textContent, 'Saving…');
    assert.equal(button.attributes['aria-busy'], 'true');
    assert.ok([button, ...controls].every(control => control.disabled));
    requests[0].reject(new Error('Temporarily unavailable'));
    await first;
    assert.deepEqual(controls.map(control => control.value), values);
    assert.ok([button, ...controls].every(control => !control.disabled));
    assert.equal(button.textContent, 'Save');
    assert.equal(button.attributes['aria-busy'], undefined);
    assert.equal(banners.at(-1).message, 'Temporarily unavailable');
    const retry = button.click();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].options.body, requests[0].options.body);
    requests[1].resolve({});
    await retry;
    assert.equal(banners.at(-1).type, 'success');
    assert.ok([button, ...controls].every(control => !control.disabled));
  });
}

test('invalid sleep input releases the save guard without creating an entry', async () => {
  const { button, controls, requests, banners, context } = harness('sleep');
  context.sleepHoursEl.value = '';
  await button.click();
  assert.equal(requests.length, 0);
  assert.match(banners.at(-1).message, /valid number of hours/);
  assert.ok([button, ...controls].every(control => !control.disabled));
});

test('restoring a form after save preserves a pre-existing disabled field', async () => {
  const { button, controls, requests } = harness('weight');
  controls[1].disabled = true;
  const saving = button.click();
  requests[0].resolve({});
  await saving;
  assert.equal(controls[1].disabled, true);
  assert.equal(button.disabled, false);
});
