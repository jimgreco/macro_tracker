const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs/promises');
const path = require('node:path');

async function fixture(page) {
  const today = '2026-06-17';
  const targets = { calories: 2100, protein: 150, carbs: 200, fat: 70 };
  const row = (day, state, calories = 0) => ({ day, calories, protein: 20, carbs: 30, fat: 10,
    completeness: { day, state, explicit: state !== 'unknown', timezone: 'America/New_York' } });
  const rows = [row(today, 'partial', 400), row('2026-06-16', 'complete', 2000),
    row('2026-06-15', 'unknown', 300), row('2026-06-13', 'partial', 1010), row('2026-05-20', 'complete', 0)];
  const oldEntries = Array.from({ length: 101 }, (_, index) => ({ id: index + 1,
    itemName: `Review item ${index + 1}`, quantity: 1, unit: 'portion', calories: 10,
    protein: 1, carbs: 1, fat: 1, consumedAt: '2026-06-13T12:00:00Z',
    mealGroup: index >= 99 ? 'review-meal' : null, mealName: index >= 99 ? 'Whole review meal' : null,
    mealQuantity: 1, mealUnit: 'meal' }));
  const control = { rows, failReview: false, failSecondPage: false, holdDay: null, held: null,
    mutations: [], requests: [], failures: [] };
  page.on('pageerror', error => control.failures.push(error.message));
  await page.clock.setFixedTime(new Date('2026-06-17T16:00:00Z'));
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.hostname !== 'nutrition-review.test') return route.fulfill({ status: 200, body: '' });
    if (url.pathname.startsWith('/api/')) {
      control.requests.push(url.pathname + url.search);
      let response = {};
      if (req.method() !== 'GET') {
        control.mutations.push({ path: url.pathname, method: req.method() });
        if (!url.pathname.startsWith('/api/day-completeness/') || req.method() !== 'PUT') {
          control.failures.push(`Unexpected mutation: ${req.method()} ${url.pathname}`);
          return route.fulfill({ status: 400, json: { error: 'Unexpected mutation' } });
        }
        const day = url.pathname.split('/').at(-1);
        let current = rows.find(item => item.day === day);
        if (!current) { current = row(day, 'unknown'); rows.push(current); }
        current.completeness = row(day, req.postDataJSON().state).completeness;
        response = { ok: true, completeness: current.completeness };
      } else if (url.pathname === '/api/me') response = { user: { id: 'review-fixture', name: 'Review Preview', timezone: 'America/New_York', features: {}, optionalDiagnosticsEnabled: false } };
      else if (url.pathname === '/api/dashboard') {
        const day = url.searchParams.get('entriesDay');
        const date = url.searchParams.get('date') || today;
        const offset = Number(url.searchParams.get('offset') || 0);
        if (control.holdDay && day === control.holdDay) await new Promise(resolve => { control.held = resolve; });
        if (offset === 100 && control.failSecondPage) {
          control.failSecondPage = false;
          return route.fulfill({ status: 503, json: { error: 'Synthetic interrupted connection' } });
        }
        const entries = day === '2026-06-13' ? oldEntries.slice(offset, offset + 100) : [];
        response = { currentDayTotals: rows.find(item => item.day === date) || row(date, 'unknown'),
          previousDays: rows.filter(item => item.day !== date), entries, targets,
          sevenDayAverage: { daysWithData: 0 }, pagination: { limit: 100, offset, returned: entries.length } };
      } else if (url.pathname === '/api/daily-totals') {
        if (control.failReview) {
          control.failReview = false;
          return route.fulfill({ status: 503, json: { error: 'Synthetic offline request' } });
        }
        response = { dailyTotals: rows, targets, targetHistory: [] };
      } else if (url.pathname === '/api/saved-items') response = { items: [] };
      else if (url.pathname === '/api/coach/dismissals') response = { dismissals: [] };
      else if (url.pathname === '/api/coach/weekly-recap') response = { recap: null };
      else if (url.pathname === '/api/integrations/access') response = { sources: [] };
      else if (url.pathname === '/api/version') response = { appBuild: 'synthetic-review' };
      else { control.failures.push(`Unmocked GET: ${url.pathname}`); }
      return route.fulfill({ json: response });
    }
    const root = path.resolve(__dirname, '../../public');
    const file = path.resolve(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (!file.startsWith(`${root}/`)) return route.abort();
    try {
      return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream', body: await fs.readFile(file) });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('http://nutrition-review.test/#macros');
  await expect(page.locator('#trend-coverage-count')).toHaveText('1 of 7 days complete');
  return control;
}

for (const { width, wideFont } of [{ width: 320 }, { width: 390 }, { width: 1280 }, { width: 320, wideFont: true }]) {
  test(`review filters, old log, completion and repeated navigation at ${width}px${wideFont ? ' with wide fallback font' : ''}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const control = await fixture(page);
    // Exercise wider glyph metrics even when the local OS fallback font fits.
    if (wideFont) await page.addStyleTag({ content: 'body { font-family: Verdana, sans-serif; letter-spacing: 0.3px; }' });
    await page.getByRole('button', { name: 'Review days', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Review nutrition days' });
    await expect(dialog.locator('[data-review-day]')).toHaveCount(6);
    await expect(dialog.locator('[data-review-day="2026-06-14"]')).toContainText('Unmarked');
    await dialog.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(dialog.locator('[data-review-day]')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'All', exact: true }).click();
    await expect(dialog.locator('[data-review-day]')).toHaveCount(7);
    await dialog.locator('[data-review-day="2026-06-16"]').hover();
    await expect(dialog.locator('[data-review-day="2026-06-16"]')).toHaveCSS('background-color', 'rgb(37, 51, 72)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await dialog.locator('[data-review-day]').evaluateAll(rows => rows.every(row => {
      const label = row.querySelector('strong');
      const action = row.querySelector('.nutrition-day-open');
      return label.scrollWidth <= label.clientWidth && label.getBoundingClientRect().right <= action.getBoundingClientRect().left;
    }))).toBe(true);
    await dialog.screenshot({ path: info.outputPath(`review-all-${width}.png`) });
    const axe = await new AxeBuilder({ page }).include('#nutrition-day-review').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
    await dialog.locator('[data-review-day="2026-06-13"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#entries-day-label')).toContainText('Jun 13');
    await expect(page.locator('#entries-by-day')).toContainText('Whole review meal');
    await expect(page.locator('#entries-by-day .macro-card')).toHaveCount(100);
    expect(await page.locator('#consumed-at').evaluate(element => {
      const input = element.getBoundingClientRect();
      const panel = element.closest('.panel').getBoundingClientRect();
      return input.left >= panel.left && input.right <= panel.right;
    })).toBe(true);
    await expect(page.locator('#today-calories')).toHaveText('1010');
    expect(control.requests.some(url => url.includes('entriesDay=2026-06-13') && url.includes('offset=100'))).toBe(true);
    await page.locator('#entries-completeness-btn').click();
    await expect(page.locator('#entries-completeness-btn')).toHaveText('Reopen day');
    await page.getByRole('button', { name: 'Review days', exact: true }).click();
    await expect(dialog.locator('[data-review-day="2026-06-13"]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(dialog.locator('[data-review-day]')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#entries-completeness-btn').click();
    await expect(page.locator('#entries-completeness-btn')).toHaveText('Mark complete');
    await page.locator('#entries-today-btn').click();
    await expect(page.locator('#entries-day-label')).toContainText('Jun 17');
    await expect(page.locator('#entries-by-day')).toHaveText('No entries for this day.');
    await page.getByRole('button', { name: 'Review days', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Needs review', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review days', exact: true })).toBeFocused();
    expect(control.mutations).toEqual(Array(2).fill({ path: '/api/day-completeness/2026-06-13', method: 'PUT' }));
    expect(control.failures).toEqual([]);
  });
}

test('review network retry and second-page retry never expose a partial meal', async ({ page }) => {
  const control = await fixture(page);
  control.failReview = true;
  await page.getByRole('button', { name: 'Review days', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review nutrition days' });
  await expect(dialog.getByText('Days could not be loaded.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.locator('[data-review-day]')).toHaveCount(6);
  control.failSecondPage = true;
  await dialog.locator('[data-review-day="2026-06-13"]').click();
  await expect(page.getByRole('button', { name: 'Retry loading day' })).toBeVisible();
  await expect(page.locator('#entries-by-day .macro-card')).toHaveCount(0);
  await expect(page.locator('#entries-completeness-btn')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry loading day' }).click();
  await expect(page.locator('#entries-by-day .macro-card')).toHaveCount(100);
  await expect(page.locator('#entries-completeness-btn')).toBeEnabled();
  expect(control.mutations).toEqual([]);
  expect(control.failures).toEqual([]);
});

test('changing dates during a pending request prevents old entries reappearing', async ({ page }) => {
  const control = await fixture(page);
  control.holdDay = '2026-06-13';
  await page.getByRole('button', { name: 'Review days', exact: true }).click();
  await page.locator('[data-review-day="2026-06-13"]').click();
  await expect(page.locator('#entries-by-day')).toContainText('Loading this day');
  await page.locator('#entries-today-btn').click();
  await expect(page.locator('#entries-day-label')).toContainText('Jun 17');
  await expect(page.locator('#entries-by-day')).toHaveText('No entries for this day.');
  const oldResponse = page.waitForResponse(response => response.url().includes('entriesDay=2026-06-13'));
  control.held();
  await oldResponse;
  await expect(page.locator('#entries-day-label')).toContainText('Jun 17');
  await expect(page.locator('#entries-by-day .macro-card')).toHaveCount(0);
  expect(control.requests.some(url => url.includes('entriesDay=2026-06-13') && url.includes('offset=100'))).toBe(false);
  expect(control.mutations).toEqual([]);
});

test('month and year review include exact ranges', async ({ page }) => {
  await fixture(page);
  for (const [name, count] of [['Month', 30], ['Year', 365]]) {
    await page.locator('#macro-period-toggle').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#trend-coverage-count')).toContainText(`of ${count} days complete`);
    await page.getByRole('button', { name: 'Review days', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Review nutrition days' });
    await dialog.getByRole('button', { name: 'All', exact: true }).click();
    await expect(dialog.locator('[data-review-day]')).toHaveCount(count);
    await dialog.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(dialog.locator('[data-review-day="2026-05-20"]')).toContainText('Complete');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
});

test('empty completion filters are clear and do not change nutrition records', async ({ page }, info) => {
  const control = await fixture(page);
  control.rows.forEach(row => { row.completeness.state = 'unknown'; });
  await page.getByRole('button', { name: 'Review days', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review nutrition days' });
  await dialog.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(dialog.getByText('No completed days in this period.')).toBeVisible();
  await expect(dialog.locator('[data-review-day]')).toHaveCount(0);
  await dialog.screenshot({ path: info.outputPath('review-empty-complete.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date('2026-06-17T12:00:00Z'); date.setUTCDate(date.getUTCDate() - offset);
    return { day: date.toISOString().slice(0, 10), completeness: { state: 'complete' } };
  });
  control.rows.splice(0, control.rows.length, ...days);
  await page.getByRole('button', { name: 'Review days', exact: true }).click();
  await expect(dialog.getByText('Every day in this period is complete.')).toBeVisible();
  expect(control.mutations).toEqual([]);
});
