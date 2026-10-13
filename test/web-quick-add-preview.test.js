const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
function browserFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function fixture(template, multiplier = '1') {
  const requests = [];
  const context = vm.createContext({
    state: { quickAddBusy: false }, quickAddBtnEl: { disabled: false },
    getSelectedQuickTemplate: () => template,
    quickAddPreviewEl: { hidden: false, textContent: '', innerHTML: '' },
    quickMultiplierEl: { value: multiplier },
    escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    mealConsumedAt: () => '2026-10-13T12:00:00.000Z',
    postQuickAdd: (url, body) => requests.push({ url, body })
  });
  vm.runInContext(['quickAddPortion', 'renderQuickAddPreview', 'fmtNumber', 'formatMacros', 'savedItemComponents', 'quickAddByTemplate'].map(browserFunction).join('\n'), context);
  return { context, requests };
}
const item = { name: 'Yogurt', quantity: 170, unit: 'g', calories: 120, protein: 18, carbs: 9, fat: 1 };

test('a half portion previews the same quantity and macros sent by recent-item logging', () => {
  const { context, requests } = fixture(item, '0.5');
  const portion = context.quickAddPortion(item, '0.5');
  context.quickAddByTemplate(item);
  for (const field of ['quantity', 'calories', 'protein', 'carbs', 'fat']) {
    assert.equal(portion[field], requests[0].body.items[0][field]);
  }
  assert.equal(portion.quantity, 85);
  assert.equal(portion.protein, 9);
});

test('saved multi-item meal totals scale once, matching the logged meal amount', () => {
  const meal = { name: 'Breakfast', quantity: 2, unit: 'serving', calories: 400, protein: 30, carbs: 40, fat: 14,
    components: [{ calories: 120, protein: 10, carbs: 15, fat: 5 }, { calories: 80, protein: 5, carbs: 5, fat: 2 }] };
  const { context, requests } = fixture(meal, '1.5');
  const portion = context.quickAddPortion(meal, '1.5');
  context.quickAddByTemplate(meal);
  assert.equal(portion.quantity, 3);
  for (const field of ['calories', 'protein', 'carbs', 'fat']) {
    const body = requests[0].body;
    assert.equal(portion[field], body.items.reduce((sum, entry) => sum + entry[field], 0) * body.mealQuantity);
  }
});

test('editing the multiplier updates the live portion without changing the template', () => {
  const { context } = fixture(item);
  context.renderQuickAddPreview();
  assert.match(context.quickAddPreviewEl.innerHTML, /170 g/);
  context.quickMultiplierEl.value = '2';
  context.renderQuickAddPreview();
  assert.match(context.quickAddPreviewEl.innerHTML, /340 g/);
  assert.match(context.quickAddPreviewEl.innerHTML, /240 cal \| 36g protein/);
  assert.equal(item.quantity, 170);
});

test('missing selections hide the preview and invalid portions never display numeric totals', () => {
  const missing = fixture(null).context;
  missing.renderQuickAddPreview();
  assert.equal(missing.quickAddPreviewEl.hidden, true);
  for (const invalid of ['0', '-1', 'oops', 'Infinity']) {
    const { context } = fixture(item, invalid);
    context.renderQuickAddPreview();
    assert.equal(context.quickAddPreviewEl.hidden, false);
    assert.match(context.quickAddPreviewEl.textContent, /multiplier greater than 0/);
    assert.equal(context.quickAddPreviewEl.innerHTML, '');
    assert.equal(context.quickAddBtnEl.disabled, true);
  }
});

test('empty multiplier previews the same default single portion as logging', () => {
  const { context } = fixture(item, '');
  assert.equal(context.quickAddPortion(item, '').calories, item.calories);
});

test('preview names and units are escaped before rendering', () => {
  const { context } = fixture({ ...item, name: '<img src=x>', unit: '<b>' });
  context.renderQuickAddPreview();
  assert.match(context.quickAddPreviewEl.innerHTML, /&lt;img src=x&gt;/);
  assert.match(context.quickAddPreviewEl.innerHTML, /&lt;b&gt;/);
});


test('a valid preview never re-enables Add during an in-flight save', () => {
  const { context } = fixture(item, '2');
  context.state.quickAddBusy = true;
  context.renderQuickAddPreview();
  assert.equal(context.quickAddBtnEl.disabled, true);
  context.state.quickAddBusy = false;
  context.renderQuickAddPreview();
  assert.equal(context.quickAddBtnEl.disabled, false);
});
