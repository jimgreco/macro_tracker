const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/script.js'), 'utf8');
const today = '2026-10-20';
function shift(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function row(offset, state, calories) {
  return { day: shift(today, offset), calories, protein: calories / 20,
    carbs: calories / 10, fat: calories / 40,
    completeness: state ? { state, eligibleForNutritionAnalysis: true, suggestedState: 'complete' } : undefined };
}
function context(period = 'weekly', macro = 'calories') {
  const labels = {};
  const arcs = [];
  const drawing = new Proxy({ measureText: text => ({ width: text.length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }), arc: (...args) => arcs.push(args)
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 320, height: 120, hidden: false,
    get clientWidth() { return this.hidden ? 0 : 320; }, getContext: () => drawing, setAttribute() {} };
  const ctx = vm.createContext({
    state: { macroSnapshotPeriod: period, selectedTrendMacro: macro },
    trendCanvasEl: canvas, trendEmptyStateEl: {}, trendAverageValueEl: {}, trendTargetValueEl: {},
    avgCaloriesEl: {}, avgProteinEl: {}, avgCarbsEl: {}, avgFatEl: {}, weeklyAvgNoteEl: {},
    getLocalIsoDay: () => today, shiftIsoDay: shift, getTimezone: () => 'America/New_York',
    fromIsoDayLocal: day => new Date(`${day}T12:00:00Z`),
    targetsForDay: () => ({ calories: 2100, protein: 150, carbs: 200, fat: 70 }),
    getTrendMacroConfig: () => ({ label: macro, unit: macro === 'calories' ? 'cal' : 'g' }),
    averageTargetsForRows: (_rows, targets) => targets,
    renderWeeklyTargets: (averages, targets, hasAverage) => { labels.cards = { averages, targets, hasAverage }; },
    setText: (el, text) => { el.textContent = text; }, hideTrendTooltip() {}, bindTrendInteractions() {}
  });
  const names = ['fmtNumber', 'spacedAxisLabels', 'macroTrendDays', 'macroTrendWindowRows',
    'completedMacroTrendRows', 'normalizeDayCompleteness', 'updateCompletenessAcrossState', 'buildTrendPoints', 'drawTrend', 'updateTrendLegend', 'renderSnapshotStats'];
  const functions = names.map(name => {
    const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
    assert.notEqual(start, -1, `Missing ${name}`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  });
  vm.runInContext(['let trendPointCoords = [];', ...functions].join('\n'), ctx);
  return { ctx, canvas, labels, arcs, points: () => vm.runInContext('trendPointCoords', ctx) };
}

for (const period of ['weekly', 'monthly', 'annual']) {
  test(`${period}: all four plotted series, averages and cards exclude partial and unmarked days`, () => {
    const rows = [row(0, 'partial', 400), row(-1, 'complete', 2000), row(-2, 'unknown', 9000),
      row(-3, 'complete', 0), row(-4, undefined, 9000)];
    const before = JSON.stringify(rows);
    for (const [macro, expected] of Object.entries({ calories: 1000, protein: 50, carbs: 100, fat: 25 })) {
      const { ctx, points, labels } = context(period, macro);
      ctx.drawTrend(rows);
      ctx.renderSnapshotStats(rows, { calories: 2100 });
      assert.equal(ctx.trendAverageValueEl.textContent, `${expected} ${macro === 'calories' ? 'cal' : 'g'}`);
      assert.equal(labels.cards.averages[macro], expected);
      assert.ok(points().every(p => p.hasData));
      assert.equal(points().length, period === 'annual' ? 1 : 2);
      assert.equal(ctx.completedMacroTrendRows(rows, period).length, 2);
      if (period !== 'annual') assert.equal(points().map(p => p.value).join(','), `0,${expected * 2}`);
    }
    assert.equal(JSON.stringify(rows), before, 'display filtering must preserve raw history');
  });
  test(`${period}: includes today only when complete, and redraws correctly after reopening`, () => {
    const { ctx, points } = context(period);
    const current = row(0, 'partial', 400);
    const rows = [row(-1, 'complete', 2000), current];
    for (const [state, average, count] of [['partial', '2000 cal', 1], ['complete', '1200 cal', 2], ['partial', '2000 cal', 1]]) {
      current.completeness.state = state;
      ctx.drawTrend(rows);
      assert.equal(ctx.trendAverageValueEl.textContent, average);
      assert.equal(ctx.completedMacroTrendRows(rows, period).length, count);
      if (period !== 'annual') assert.equal(points().length, count);
      assert.equal(ctx.trendTargetValueEl.textContent, '2100 cal', 'configured target must stay unchanged');
    }
  });
  test(`${period}: no completed days is distinct from a completed empty day`, () => {
    const { ctx, points, canvas, labels } = context(period);
    for (const state of ['partial', 'complete', 'partial']) {
      const rows = [row(0, state, 0), row(-1, 'unknown', 9000)];
      ctx.drawTrend(rows);
      ctx.renderSnapshotStats(rows, { calories: 2100 });
      const complete = state === 'complete';
      assert.equal(canvas.hidden, !complete);
      assert.equal(ctx.trendEmptyStateEl.hidden, complete);
      assert.equal(ctx.avgCaloriesEl.textContent, complete ? '0' : '—');
      assert.equal(ctx.avgProteinEl.textContent, complete ? '0g' : '—');
      assert.equal(ctx.trendAverageValueEl.textContent, complete ? '0 cal' : '—');
      assert.equal(points().length, complete ? 1 : 0);
      assert.equal(labels.cards.hasAverage, complete);
      assert.equal(labels.cards.targets.calories, 2100);
      if (complete) assert.equal(canvas.width, 320, 'show canvas before measuring it after an empty state');
    }
  });
  test(`${period}: exact calendar window excludes extra API boundary rows and future days`, () => {
    const { ctx } = context(period);
    const days = { weekly: 7, monthly: 30, annual: 365 }[period];
    const rows = [row(-days, 'complete', 9000), row(1 - days, 'complete', 1000), row(0, 'complete', 2000), row(1, 'complete', 9000)];
    assert.equal(ctx.completedMacroTrendRows(rows, period).map(r => r.day).join(','), `${shift(today, 1 - days)},${today}`);
    ctx.drawTrend(rows);
    assert.equal(ctx.trendAverageValueEl.textContent, '1500 cal');
  });
}

test('annual average gives each completed day equal weight across unequal weekly samples', () => {
  const { ctx, points, labels } = context('annual');
  const rows = [row(-8, 'complete', 1000), row(-1, 'complete', 2000), row(0, 'complete', 2000)];
  ctx.drawTrend(rows);
  ctx.renderSnapshotStats(rows, {});
  assert.equal(points().map(p => p.value).join(','), '1000,2000');
  assert.equal(ctx.trendAverageValueEl.textContent, '1666.7 cal');
  assert.equal(ctx.avgCaloriesEl.textContent, '1666.7');
  assert.equal(labels.cards.averages.calories, 5000 / 3);
});


test('completing a previously untracked empty day updates the current sample before refresh', () => {
  const { ctx } = context();
  const previous = row(-1, 'partial', 1000);
  ctx.state.dayCompletenessByDay = new Map();
  ctx.state.dashboardData = { currentDayTotals: row(0, undefined, 0), previousDays: [previous] };
  ctx.state.macroDailyTotals = [previous];
  ctx.updateCompletenessAcrossState(today, { state: 'complete' });
  ctx.drawTrend(ctx.state.macroDailyTotals);
  assert.equal(ctx.trendAverageValueEl.textContent, '0 cal');
  assert.equal(ctx.state.macroDailyTotals.length, 2);
  assert.equal(ctx.state.macroDailyTotals[0], previous);
  ctx.updateCompletenessAcrossState(today, { state: 'partial' });
  ctx.drawTrend(ctx.state.macroDailyTotals);
  assert.equal(ctx.trendAverageValueEl.textContent, '—');
  assert.equal(ctx.state.macroDailyTotals.length, 2, 'reopening retains raw totals');
});
