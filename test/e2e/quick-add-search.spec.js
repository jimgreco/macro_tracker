const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

for (const width of [320, 1280]) {
  test(`Quick Add search keeps full names, source selection and safe actions at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    const saved = [
      { id: 1, name: 'Long homemade breakfast with blueberry yogurt', quantity: 1, unit: 'bowl', calories: 300, protein: 25, carbs: 30, fat: 10, fiber: 4 },
      { id: 2, name: 'Chicken rice dinner', quantity: 1, unit: 'plate', calories: 500, protein: 40, carbs: 50, fat: 12 },
    ];
    await page.clock.setFixedTime(new Date('2026-10-26T16:00:00Z'));
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== 'quick-search.test') return route.fulfill({ body: '' });
      if (url.pathname.startsWith('/api/')) {
        let json = {};
        if (req.method() !== 'GET') {
          writes.push({ path: url.pathname, body: req.postDataJSON() });
          json = { ok: true };
        } else if (url.pathname === '/api/me') json = { user: { id: 'synthetic-search', name: 'Preview', timezone: 'America/New_York', features: {} } };
        else if (url.pathname === '/api/saved-items') json = saved;
        else if (url.pathname === '/api/dashboard') json = {
          currentDayTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, previousDays: [],
          entries: [{ id: 8, itemName: 'Recent apple snack', quantity: 1, unit: 'apple', calories: 90, protein: 0, carbs: 25, fat: 0, consumedAt: '2026-10-25T12:00:00Z' }],
          targets: { calories: 2100, protein: 150, carbs: 200, fat: 70 }, sevenDayAverage: { daysWithData: 0 },
        };
        else if (url.pathname === '/api/daily-totals') json = { dailyTotals: [] };
        else if (url.pathname === '/api/coach/dismissals') json = { dismissals: [] };
        else if (url.pathname === '/api/coach/weekly-recap') json = { recap: null };
        else if (url.pathname === '/api/integrations/access') json = { sources: [] };
        return route.fulfill({ json });
      }
      const root = path.resolve(__dirname, '../../public');
      const file = path.resolve(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      if (!file.startsWith(root + '/')) return route.abort();
      try { return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream', body: await fs.readFile(file) }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('https://quick-search.test/#macros');
    const search = page.getByRole('searchbox', { name: 'Search Quick Add entries' });
    const picker = page.locator('#quick-entry-select'), add = page.locator('#quick-add-btn'), edit = page.locator('#quick-edit-toggle-btn');
    await expect(picker).toBeEnabled();
    await search.fill('  BLUEBERRY breakfast ');
    await expect(picker).toHaveValue('saved:1');
    await expect(picker.locator('option')).toHaveCount(1);
    await expect(add).toBeEnabled();
    await page.locator('#quick-section').screenshot({ path: info.outputPath(`quick-add-search-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-quick-source="recent"]').click();
    await expect(picker).toBeDisabled();
    await expect(picker).toHaveText('No matching quick entries');
    await expect(add).toBeDisabled(); await expect(edit).toBeDisabled();
    await search.fill('APPLE');
    await expect(picker).toBeEnabled();
    await expect(picker.locator('option')).toHaveCount(1);
    await page.locator('#quick-search-clear').click();
    await expect(search).toBeFocused();
    await expect(page.locator('[data-quick-source="recent"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-quick-source="all"]').click();
    await search.fill('rice');
    await expect(picker).toHaveValue('saved:2');
    expect(writes).toEqual([]);
    await add.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toBe('/api/quick-add');
    expect(writes[0].body.savedItemId).toBe(2);
    expect(errors).toEqual([]);
  });
}
