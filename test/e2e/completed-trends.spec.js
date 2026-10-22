const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs/promises');
const path = require('node:path');

// Serve the real client with an entirely synthetic, in-memory API. No database or user account is touched.
async function fixture(page, { empty = false } = {}) {
  const today = '2026-06-17';
  const targets = { calories: 2100, protein: 150, carbs: 200, fat: 70 };
  const row = (day, state, calories) => ({ day, calories, protein: calories / 20, carbs: calories / 10, fat: calories / 40,
    completeness: { day, state, explicit: state !== 'unknown', eligibleForNutritionAnalysis: state === 'complete', timezone: 'America/New_York' } });
  const rows = empty ? [] : [row('2025-06-18', 'complete', 6000), row('2026-05-19', 'complete', 4000),
    row('2026-06-10', 'complete', 9000), row('2026-06-13', 'partial', 300), row('2026-06-14', 'complete', 0),
    row('2026-06-15', 'unknown', 100), row('2026-06-16', 'complete', 2000), row(today, 'partial', 400)];
  const failures = [];
  const mutations = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== 'macro-trends.test') return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
    let response;
    if (url.pathname.startsWith('/api/')) {
      if (request.method() !== 'GET') {
        mutations.push({ path: url.pathname, method: request.method() });
        if (url.pathname !== `/api/day-completeness/${today}` || request.method() !== 'PUT') {
          failures.push(`Unexpected mutation: ${request.method()} ${url.pathname}`);
          return route.fulfill({ status: 400, json: { error: 'Unexpected synthetic request' } });
        }
        const status = request.postDataJSON().state;
        let current = rows.find(item => item.day === today);
        if (!current) { current = row(today, status, 0); rows.push(current); }
        current.completeness = row(today, status, 0).completeness;
        response = { ok: true, completeness: current.completeness };
      } else if (url.pathname === '/api/me') {
        response = { user: { id: 'completed-trend-fixture', name: 'Trend Preview', timezone: 'America/New_York', features: {}, optionalDiagnosticsEnabled: false } };
      } else if (url.pathname === '/api/dashboard') {
        response = { currentDayTotals: rows.find(item => item.day === today) || row(today, 'unknown', 0),
          previousDays: rows.filter(item => item.day !== today), entries: [], targets,
          sevenDayAverage: { daysWithData: 0, calories: 0, protein: 0, carbs: 0, fat: 0 }, pagination: { limit: 50, offset: 0, returned: 0 } };
      } else if (url.pathname === '/api/daily-totals') {
        response = { dailyTotals: rows, targets, targetHistory: [] };
      } else if (url.pathname === '/api/saved-items') response = { items: [] };
      else if (url.pathname === '/api/coach/dismissals') response = { dismissals: [] };
      else if (url.pathname === '/api/coach/weekly-recap') response = { recap: null };
      else if (url.pathname === '/api/integrations/access') response = { sources: [] };
      else if (url.pathname === '/api/version') response = { appBuild: 'synthetic-trends' };
      else { failures.push(`Unmocked request: ${url.pathname}`); response = {}; }
      return route.fulfill({ json: response });
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const publicRoot = path.resolve(__dirname, '../../public');
    const filename = path.resolve(publicRoot, relative);
    if (!filename.startsWith(`${publicRoot}/`)) return route.abort();
    try {
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
      return route.fulfill({ contentType: type, body: await fs.readFile(filename) });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('http://macro-trends.test/#macros');
  await expect(page.locator('#macros-page')).toBeVisible();
  await expect(page.locator('#avg-calories')).toHaveText(empty ? '—' : '1000');
  return { failures, mutations };
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`completed-day trends and status changes at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { failures, mutations } = await fixture(page);
    for (const [period, avg, complete, days] of [['Week', 1000, 2, 7], ['Month', 3750, 4, 30], ['Year', 4200, 5, 365]]) {
      await page.locator('#macro-period-toggle').getByRole('button', { name: period, exact: true }).click();
      await expect(page.locator('#avg-calories')).toHaveText(String(avg));
      await expect(page.locator('#trend-coverage-count')).toHaveText(`${complete} of ${days} days complete`);
      await expect(page.locator('#trend-coverage-detail')).toHaveText(`2 partial · ${days - complete - 2} unmarked`);
      await expect(page.getByRole('progressbar', { name: `${complete} of ${days} days complete` })).toHaveAttribute('aria-valuetext', `${complete} of ${days} days complete`);
      expect(await page.locator('#trend-coverage-progress').evaluate(el => [el.value, el.max])).toEqual([complete, days]);
      for (const [macro, value] of [['calories', avg], ['protein', avg / 20], ['carbs', avg / 10], ['fat', avg / 40]]) {
        await page.locator(`[data-trend-macro=${macro}]`).click();
        await expect(page.locator('#trend-average-value')).toHaveText(`${Number(value.toFixed(1))} ${macro === 'calories' ? 'cal' : 'g'}`);
        await expect(page.locator('#trend-canvas')).toHaveAttribute('aria-label', /completed days only/);
      }
      await page.locator('[data-trend-macro=calories]').click();
      await page.locator('#today-section').screenshot({ path: testInfo.outputPath(`trends-${period.toLowerCase()}.png`) });
    }
    await page.locator('#macro-period-toggle').getByRole('button', { name: 'Week', exact: true }).click();
    await page.locator('#entries-completeness-btn').click();
    await expect(page.locator('#trend-average-value')).toHaveText('800 cal');
    await expect(page.locator('#trend-coverage-count')).toHaveText('3 of 7 days complete');
    await expect(page.locator('#trend-coverage-detail')).toHaveText('1 partial · 3 unmarked');
    await page.reload();
    await expect(page.locator('#trend-coverage-count')).toHaveText('3 of 7 days complete');
    await expect(page.locator('#entries-completeness-btn')).toHaveText('Reopen day');
    await page.locator('#entries-completeness-btn').click();
    await expect(page.locator('#trend-average-value')).toHaveText('1000 cal');
    await expect(page.locator('#trend-coverage-count')).toHaveText('2 of 7 days complete');
    await expect(page.locator('#trend-coverage-detail')).toHaveText('2 partial · 3 unmarked');
    await expect(page.locator('#trend-target-value')).toHaveText('2100 cal');
    expect(await page.evaluate(() => trendPointCoords.map(point => point.value))).toEqual([0, 2000]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('#today-section').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact))).toEqual([]);
    expect(failures).toEqual([]);
    expect(mutations).toEqual(Array(2).fill({ path: '/api/day-completeness/2026-06-17', method: 'PUT' }));
  });
}

test('no completed days shows an empty state; completing an untracked day plots a genuine zero', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { failures } = await fixture(page, { empty: true });
  for (const [period, days] of [['Week', 7], ['Month', 30], ['Year', 365]]) {
    await page.locator('#macro-period-toggle').getByRole('button', { name: period, exact: true }).click();
    await expect(page.locator('#trend-empty-state')).toBeVisible();
    await expect(page.locator('#trend-coverage-count')).toHaveText(`0 of ${days} days complete`);
    await expect(page.locator('#trend-coverage-detail')).toHaveText(`0 partial · ${days} unmarked`);
    await expect(page.locator('#trend-canvas')).toBeHidden();
    await expect(page.locator('#trend-average-value')).toHaveText('—');
    await expect(page.locator('#avg-protein')).toHaveText('—');
  }
  await page.locator('#today-section').screenshot({ path: testInfo.outputPath('trends-empty.png') });
  await page.locator('#entries-completeness-btn').click();
  await expect(page.locator('#trend-canvas')).toBeVisible();
  await expect(page.locator('#trend-average-value')).toHaveText('0 cal');
  await expect(page.locator('#avg-calories')).toHaveText('0');
  await expect(page.locator('#trend-coverage-count')).toHaveText('1 of 365 days complete');
  await expect(page.locator('#trend-coverage-detail')).toHaveText('0 partial · 364 unmarked');
  await expect(page.locator('#trend-empty-state')).toBeHidden();
  await expect(page.locator('#trend-target-value')).toHaveText('2100 cal');
  expect(await page.locator('#trend-canvas').evaluate(el => el.width)).toBeGreaterThan(250);
  await page.locator('#today-section').screenshot({ path: testInfo.outputPath('trends-zero.png') });
  await page.locator('#entries-completeness-btn').click();
  await expect(page.locator('#trend-empty-state')).toBeVisible();
  await expect(page.locator('#avg-calories')).toHaveText('—');
  await expect(page.locator('#trend-coverage-count')).toHaveText('0 of 365 days complete');
  await expect(page.locator('#trend-coverage-detail')).toHaveText('1 partial · 364 unmarked');
  expect(failures).toEqual([]);
});
