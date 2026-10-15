const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/script.js'), 'utf8');
const fn = name => { const start = source.indexOf(`function ${name}(`); return source.slice(start, source.indexOf('\n}', start) + 2); };
function fixture(filter = 'all') {
  const buttons = ['all', 'saved', 'recent'].map(quickSource => ({ dataset: { quickSource }, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, classList: { toggle() {} } }));
  const context = vm.createContext({ state: { quickSourceFilter: filter, savedItems: [{ id: 1, name: 'Saved yogurt' }], historyQuickItems: [{ key: 'entry:rice', name: 'Recent rice' }], quickSelectedKey: 'saved:1' },
    document: { querySelectorAll: () => buttons }, formatSavedItemOption: item => item.name,
    quickAddBtnEl: {}, quickEditToggleBtnEl: {}, quickMultiplierEl: { value: '1' },
    renderQuickEntrySelect() {}, getSelectedQuickTemplate: () => context.state.quickSelectedKey || null,
    quickAddPortion: template => template });
  vm.runInContext(['quickEntryOptionGroups', 'flattenQuickPickerGroups', 'renderSavedItems', 'setQuickSourceFilter'].map(fn).join('\n'), context);
  return { context, buttons };
}
test('source filters retain ordering and only expose their matching picker options', () => {
  const { context } = fixture();
  const keys = () => Array.from(context.flattenQuickPickerGroups(context.quickEntryOptionGroups()), item => item.key);
  assert.deepEqual(keys(), ['saved:1', 'entry:rice']);
  context.setQuickSourceFilter('recent'); assert.deepEqual(keys(), ['entry:rice']);
  context.setQuickSourceFilter('saved'); assert.deepEqual(keys(), ['saved:1']);
});
test('switching sources replaces an excluded selection and updates its accessible pressed state', () => {
  const { context, buttons } = fixture();
  context.setQuickSourceFilter('recent');
  assert.equal(context.state.quickSelectedKey, 'entry:rice');
  assert.equal(buttons[2].attributes['aria-pressed'], 'true');
  assert.equal(buttons[0].attributes['aria-pressed'], 'false');
  context.setQuickSourceFilter('all');
  assert.equal(context.state.quickSelectedKey, 'entry:rice');
});
test('an empty source clears stale selection and disables Add and Edit', () => {
  const { context } = fixture(); context.state.historyQuickItems = [];
  context.setQuickSourceFilter('recent');
  assert.equal(context.state.quickSelectedKey, '');
  assert.equal(context.quickAddBtnEl.disabled, true);
  assert.equal(context.quickEditToggleBtnEl.disabled, true);
  assert.equal(context.state.savedItems.length, 1);
});
