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
const context = vm.createContext({});
vm.runInContext(browserFunction('spacedAxisLabels'), context);

function assertSeparated(labels, gap = 8) {
  for (let index = 1; index < labels.length; index++) {
    assert.ok(labels[index].left >= labels[index - 1].right + gap,
      `${labels[index - 1].text} overlaps ${labels[index].text}`);
  }
}

function monthLabels(width) {
  return ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']
    .map((text, index, labels) => ({ text, x: index * width / (labels.length - 1),
      align: index === 0 ? 'left' : index === labels.length - 1 ? 'right' : 'center' }));
}

test('narrow annual axes thin labels without changing date anchors or endpoint months', () => {
  const labels = monthLabels(250);
  const original = JSON.stringify(labels);
  const selected = context.spacedAxisLabels(labels, text => text.length * 6);
  assert.ok(selected.length < labels.length);
  assert.ok(selected.length >= 5);
  assert.equal(selected[0].x, labels[0].x);
  assert.equal(selected.at(-1).x, labels.at(-1).x);
  assertSeparated(selected);
  assert.equal(JSON.stringify(labels), original);
  for (const label of selected) assert.ok(labels.some(candidate => candidate.text === label.text && candidate.x === label.x));
});

test('wide annual axes retain every month when the measured labels fit', () => {
  const labels = monthLabels(700);
  const selected = context.spacedAxisLabels(labels, text => text.length * 6);
  assert.equal(selected.length, labels.length);
  assertSeparated(selected);
});

test('label spacing respects wider localized month names and the final date', () => {
  const labels = monthLabels(250).map(label => ({ ...label, text: `${label.text}.long` }));
  const selected = context.spacedAxisLabels(labels, text => text.length * 7);
  assertSeparated(selected);
  assert.equal(selected.at(-1).x, 250);
  assert.ok(selected.length < 5);
});

test('the axis label selector handles empty and single-date series', () => {
  assert.equal(context.spacedAxisLabels([], () => 20).length, 0);
  const selected = context.spacedAxisLabels([{ text: 'Oct', x: 20, align: 'left' }], () => 20);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].left, 20);
  assert.equal(selected[0].right, 40);
});

function drawAnnual(width, calories = 1800) {
  const text = [];
  const arcs = [];
  const attributes = {};
  const drawing = new Proxy({
    fillText(value, x, y) { text.push({ text: String(value), x, y, align: this.textAlign }); },
    measureText(value) { return { width: value.length * 6 }; },
    arc(...args) { arcs.push(args); },
    createLinearGradient() { return { addColorStop() {} }; }
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { clientWidth: width, width, height: 120,
    getContext: () => drawing, setAttribute: (key, value) => { attributes[key] = value; } };
  const data = vm.createContext({
    state: { macroSnapshotPeriod: 'annual', selectedTrendMacro: 'calories' },
    trendCanvasEl: canvas,
    getTrendMacroConfig: () => ({ label: 'Calories', unit: 'cal' }),
    targetsForDay: () => ({ calories: 2100 }),
    fromIsoDayLocal: day => new Date(`${day}T12:00:00Z`),
    shiftIsoDay(day, offset) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); },
    updateTrendLegend() {}, bindTrendInteractions() {}
  });
  vm.runInContext(['let trendPointCoords = [];', ...['fmtNumber', 'spacedAxisLabels', 'buildTrendPoints', 'drawTrend'].map(browserFunction)].join('\n'), data);
  data.drawTrend([{ day: '2026-10-10', calories }], '2026-10-11');
  return { text: text.filter(label => label.y === 118), yLabels: text.filter(label => label.y !== 118), arcs, attributes, points: vm.runInContext('trendPointCoords', data) };
}

test('rendering a mobile annual chart preserves all 52 plotted points and tooltip dates', () => {
  const mobile = drawAnnual(320);
  const desktop = drawAnnual(760);
  assert.ok(mobile.text.length < desktop.text.length);
  assert.equal(desktop.text.length, 13);
  assert.equal(mobile.points.length, 52);
  assert.equal(mobile.arcs.length, 52);
  assert.equal(mobile.points[0].x, 34);
  assert.equal(mobile.points.at(-1).x, 286);
  assert.equal(mobile.points.map(point => point.day).join(','), desktop.points.map(point => point.day).join(','));
  assert.equal(mobile.points.map(point => point.label).join(','), desktop.points.map(point => point.label).join(','));
  assert.equal(mobile.points.map(point => point.value).join(','), desktop.points.map(point => point.value).join(','));
  assert.equal(mobile.attributes['aria-label'], '52-week calories trend');
  const selected = context.spacedAxisLabels(mobile.text, text => text.length * 6);
  assert.equal(selected.length, mobile.text.length, 'rendered month labels should already fit');
  assertSeparated(selected);
});


test('narrow charts reserve measured space for complete y-axis numbers', () => {
  for (const width of [260, 320, 760]) {
    const chart = drawAnnual(width, 2169.1);
    assert.equal(chart.yLabels.length, 5);
    assert.ok(chart.yLabels.some(label => label.text === '1626.8'));
    assert.ok(chart.yLabels.some(label => label.text === '1084.5'));
    for (const label of chart.yLabels) {
      assert.equal(label.align, 'right');
      assert.ok(label.x - label.text.length * 6 >= 4, `${label.text} clips at canvas width ${width}`);
    }
    assert.equal(chart.points[0].x, 46);
    assert.equal(chart.points.at(-1).x, width - 34);
    assert.equal(chart.points.length, 52);
    assert.equal(chart.points.at(-1).value, 2169.1, 'layout must not round the plotted or tooltip values');
    assertSeparated(context.spacedAxisLabels(chart.text, text => text.length * 6));
  }
});
