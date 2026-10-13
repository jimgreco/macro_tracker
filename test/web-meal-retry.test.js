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
function handler(name, next) {
  return source.slice(source.indexOf(`${name}.addEventListener('click'`), source.indexOf(next));
}
function element(value = '') {
  return {
    value, disabled: false, textContent: '', innerHTML: '',
    listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }
  };
}
function harness() {
  const requests = [];
  const banners = [];
  const state = { currentUser: { id: 'account-a' }, parsedMeal: { items: [{ itemName: 'Oatmeal' }], review: { source: 'ai_text' } }, mealImageAttachments: [], quickSelectedKey: 'saved:1' };
  const item = { itemName: 'Oatmeal', quantity: 1, unit: 'bowl', calories: 320, protein: 14, carbs: 48, fat: 8 };
  const controls = {
    mealTextEl: element('oatmeal'), consumedAtEl: element('2026-10-12T12:00'),
    parseBtnEl: element(), saveParsedBtnEl: element(),
    quickAddBtnEl: element(), quickEditToggleBtnEl: element(),
    quickMultiplierEl: element('1'), quickSelectEl: element('saved:1'),
    visibleSave: element()
  };
  controls.visibleSave.textContent = 'Save';
  const attributes = {};
  const section = {
    querySelectorAll: () => [controls.mealTextEl, controls.consumedAtEl, controls.parseBtnEl, controls.saveParsedBtnEl, controls.visibleSave],
    setAttribute: (key, value) => { attributes[key] = value; },
    removeAttribute: (key) => { delete attributes[key]; }
  };
  let nextId = 0;
  const context = {
    ...controls, state,
    crypto: { randomUUID: () => `mutation-${++nextId}` },
    api: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    document: { getElementById: (id) => id === 'log-section' ? section : null },
    parsedItemsContainerEl: { innerHTML: 'draft', querySelector: () => controls.visibleSave },
    setActionBanner: (message, type) => banners.push({ message, type }),
    refreshDashboard: async () => {}, loadQuickEntries: async () => {},
    clearMealImageSelection() {}, renderParsedItems() {}, renderQuickAddPreview() {},
    appendBarcodeItemToParsedMeal(result) { state.parsedMeal.items.push(result.item); },
    collectParsedItemsFromUi: () => [item],
    savedItemComponents: (template) => template.components || [],
    getSelectedQuickTemplate: () => ({ type: 'saved', id: 1 }),
    findQuickPickerOption: (key) => ({ key }),
    toDateTimeLocalValue: () => '2026-10-12T12:34'
  };
  vm.createContext(context);
  vm.runInContext([
    ...['createReplaySafePost', 'lockMealEditor', 'refreshAfterMealSave', 'selectQuickEntry', 'quickAddPortion',
      'quickAddById', 'quickAddByTemplate', 'mealConsumedAt', 'asIso', 'lookupBarcode'].map(browserFunction),
    'const postParsedMeal = createReplaySafePost(); const postQuickAdd = createReplaySafePost();',
    handler('parseBtnEl', "saveParsedBtnEl.addEventListener('click'"),
    handler('saveParsedBtnEl', "quickAddBtnEl.addEventListener('click'"),
    handler('quickAddBtnEl', 'if (copyYesterdayBtnEl)')
  ].join('\n'), context);
  return { context, state, controls, requests, banners, attributes };
}
const mutationId = (request) => request.options.headers['X-Client-Mutation-Id'];

test('parsed saves block overlap and preserve the draft and mutation ID after a lost response', async () => {
  const { controls, state, requests, attributes } = harness();
  const save = controls.saveParsedBtnEl.listeners.click;
  const first = save();
  assert.equal(controls.visibleSave.disabled, true);
  assert.equal(controls.visibleSave.textContent, 'Saving…');
  assert.equal(controls.mealTextEl.disabled, true);
  assert.equal(attributes['aria-busy'], 'true');
  await save();
  await controls.parseBtnEl.listeners.click();
  assert.equal(requests.length, 1);
  requests[0].reject(new Error('Connection lost'));
  await first;
  assert.ok(state.parsedMeal);
  assert.equal(controls.mealTextEl.value, 'oatmeal');
  assert.equal(controls.visibleSave.disabled, false);
  assert.equal(controls.visibleSave.textContent, 'Save');
  assert.equal(controls.parseBtnEl.disabled, false);
  assert.equal(attributes['aria-busy'], undefined);
  const retry = save();
  assert.equal(mutationId(requests[0]), mutationId(requests[1]));
  assert.equal(requests[0].options.body, requests[1].options.body);
  requests[1].resolve({ ok: true });
  await retry;
  assert.equal(state.parsedMeal, null);
  assert.equal(controls.saveParsedBtnEl.disabled, true);
});

test('a committed parsed meal stays saved when reloading the dashboard fails', async () => {
  const { controls, context, state, requests, banners } = harness();
  context.refreshDashboard = async () => { throw new Error('Refresh unavailable'); };
  const save = controls.saveParsedBtnEl.listeners.click();
  requests[0].resolve({ ok: true });
  await save;
  assert.equal(state.parsedMeal, null);
  assert.equal(controls.mealTextEl.value, '');
  assert.equal(context.parsedItemsContainerEl.innerHTML, '');
  assert.equal(banners.at(-1).type, 'info');
  assert.match(banners.at(-1).message, /^Saved parsed items\..*could not refresh/);
});

test('Quick Add ignores overlapping clicks, including picker rerenders', async () => {
  const { controls, context, requests, state } = harness();
  const add = controls.quickAddBtnEl.listeners.click;
  const pending = add();
  context.selectQuickEntry('saved:1');
  assert.equal(controls.quickAddBtnEl.disabled, true);
  assert.equal(controls.quickEditToggleBtnEl.disabled, true);
  assert.equal(controls.quickAddBtnEl.textContent, 'Adding…');
  await add();
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true });
  await pending;
  assert.equal(state.quickAddBusy, false);
  assert.equal(controls.quickAddBtnEl.disabled, false);
  assert.equal(controls.quickEditToggleBtnEl.disabled, false);
  assert.equal(controls.quickAddBtnEl.textContent, 'Add');
});

test('Quick Add retries reuse an ID while a later intentional addition gets a new ID', async () => {
  const { controls, requests } = harness();
  const add = controls.quickAddBtnEl.listeners.click;
  const first = add();
  requests[0].reject(new Error('Response lost after commit'));
  await first;
  const retry = add();
  assert.equal(mutationId(requests[0]), mutationId(requests[1]));
  requests[1].resolve({ ok: true });
  await retry;
  const another = add();
  assert.notEqual(mutationId(requests[1]), mutationId(requests[2]));
  requests[2].resolve({ ok: true });
  await another;
});

test('a failed Quick Add refresh reports success and allows a new intentional addition', async () => {
  const { controls, context, requests, banners } = harness();
  context.refreshDashboard = async () => { throw new Error('Refresh unavailable'); };
  const add = controls.quickAddBtnEl.listeners.click;
  const first = add();
  requests[0].resolve({ ok: true });
  await first;
  assert.match(banners.at(-1).message, /^Quick add logged\..*could not refresh/);
  assert.equal(banners.at(-1).type, 'info');
  const another = add();
  assert.notEqual(mutationId(requests[0]), mutationId(requests[1]));
  requests[1].resolve({ ok: true });
  await another;
});

test('changed quantities and account changes do not reuse failed mutation IDs', async () => {
  const { controls, requests, state } = harness();
  const add = controls.quickAddBtnEl.listeners.click;
  for (const change of [() => {}, () => { controls.quickMultiplierEl.value = '2'; }, () => { state.currentUser.id = 'account-b'; }]) {
    change();
    const pending = add();
    requests.at(-1).reject(new Error('Network unavailable'));
    await pending;
  }
  assert.equal(new Set(requests.map(mutationId)).size, 3);
});

test('recent item and meal Quick Adds receive stable IDs and preserve component scaling', async () => {
  for (const components of [[], [{ itemName: 'Oatmeal', quantity: 1, calories: 320 }]]) {
    const { context, requests, controls } = harness();
    controls.quickMultiplierEl.value = '2';
    const template = { name: 'Breakfast', quantity: 1, calories: 320, components };
    const first = context.quickAddByTemplate(template);
    requests[0].reject(new Error('Response lost'));
    await assert.rejects(first);
    const retry = context.quickAddByTemplate(template);
    assert.equal(requests[0].url, '/api/entries/bulk');
    assert.equal(mutationId(requests[0]), mutationId(requests[1]));
    const body = JSON.parse(requests[1].options.body);
    assert.equal(components.length ? body.mealQuantity : body.items[0].quantity, 2);
    requests[1].resolve({ ok: true });
    await retry;
  }
});

test('an empty meal time becomes a visible stable timestamp before retrying', async () => {
  const { controls, requests } = harness();
  controls.consumedAtEl.value = '';
  const add = controls.quickAddBtnEl.listeners.click;
  const first = add();
  assert.equal(controls.consumedAtEl.value, '2026-10-12T12:34');
  requests[0].reject(new Error('Response lost'));
  await first;
  const retry = add();
  assert.equal(requests[0].options.body, requests[1].options.body);
  assert.equal(mutationId(requests[0]), mutationId(requests[1]));
  requests[1].resolve({ ok: true });
  await retry;
});

test('parsing disables duplicate requests and blocks saving a previous draft until complete', async () => {
  const { controls, requests, state } = harness();
  const parse = controls.parseBtnEl.listeners.click;
  const first = parse();
  await parse();
  await controls.saveParsedBtnEl.listeners.click();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/parse-meal');
  requests[0].resolve({ items: [{ itemName: 'New meal' }] });
  await first;
  assert.equal(state.parsedMeal.items[0].itemName, 'New meal');
  assert.equal(controls.parseBtnEl.disabled, false);
  assert.equal(controls.saveParsedBtnEl.disabled, false);
});


test('barcode lookup finishes before a draft can be parsed or saved', async () => {
  const { controls, context, requests, state } = harness();
  const lookup = context.lookupBarcode('123456789012');
  assert.equal(controls.parseBtnEl.disabled, true);
  assert.equal(controls.visibleSave.disabled, true);
  await controls.saveParsedBtnEl.listeners.click();
  await controls.parseBtnEl.listeners.click();
  await context.lookupBarcode('123456789012');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/barcode/123456789012');
  requests[0].resolve({ item: { itemName: 'Scanned yogurt' } });
  await lookup;
  assert.equal(state.parsedMeal.items[1].itemName, 'Scanned yogurt');
  assert.equal(controls.parseBtnEl.disabled, false);
  assert.equal(controls.visibleSave.disabled, false);
});

test('a failed barcode lookup restores the editor and preserves the existing draft', async () => {
  const { controls, context, requests, state } = harness();
  const lookup = context.lookupBarcode('123456789012');
  requests[0].reject(new Error('Lookup unavailable'));
  await lookup;
  assert.equal(state.parsedMeal.items.length, 1);
  assert.equal(state.parsedMeal.items[0].itemName, 'Oatmeal');
  assert.equal(controls.mealTextEl.value, 'oatmeal');
  assert.equal(state.mealEditorBusy, false);
  assert.equal(controls.parseBtnEl.disabled, false);
  assert.equal(controls.visibleSave.disabled, false);
});


test('Quick Add cannot submit an invalid portion even through a direct handler call', async () => {
  const { controls, requests } = harness();
  for (const value of ['0', '-1', 'Infinity']) {
    controls.quickMultiplierEl.value = value;
    await controls.quickAddBtnEl.listeners.click();
  }
  assert.equal(requests.length, 0);
});
