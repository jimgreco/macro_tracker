const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');

for (const width of [320, 1280]) {
  test(`manual nutrition validates and safely retries totals at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = [], receipts = new Map(), errors = [];
    let failFirst = true;
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-29T16:00:00Z'));
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== 'manual.test') return route.fulfill({ body: '' });
      if (url.pathname.startsWith('/api/')) {
        let json = {};
        if (req.method() !== 'GET') {
          if (url.pathname === '/api/entries/bulk') {
            const write = { path: url.pathname, body: req.postDataJSON(), id: req.headers()['x-client-mutation-id'] };
            writes.push(write);
            if (receipts.has(write.id)) expect(write.body).toEqual(receipts.get(write.id));
            receipts.set(write.id, write.body);
            if (failFirst) {
              failFirst = false;
              await new Promise(resolve => setTimeout(resolve, 250));
              return route.fulfill({ status: 503, json: { error: 'Synthetic lost response after commit' } });
            }
          } else if (url.pathname !== '/api/diagnostics/client') throw new Error(`Unexpected write: ${url.pathname}`);
          return route.fulfill({ json: { ok: true } });
        }
        if (url.pathname === '/api/me') json = { user: { id: 'synthetic-manual', name: 'Preview', timezone: 'America/New_York', features: {} } };
        else if (url.pathname === '/api/saved-items') json = [];
        else if (url.pathname === '/api/dashboard') json = { currentDayTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, previousDays: [], entries: [], targets: { calories: 2100, protein: 150, carbs: 200, fat: 70 }, sevenDayAverage: { daysWithData: 0 } };
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
    await page.goto('https://manual.test/#macros');
    await expect(page.locator('#quick-entry-select')).toHaveText('No quick add history yet');
    const open = page.getByRole('button', { name: 'Enter nutrition', exact: true });
    await page.locator('#consumed-at').fill('2026-10-27T12:45');
    await open.click();
    await page.locator('#manual-name').fill('Canceled food');
    await page.locator('#manual-cancel').click();
    expect(writes).toHaveLength(0);
    await open.click();
    await expect(page.locator('#manual-name')).toHaveValue('');
    await page.locator('#manual-save').click();
    await expect(page.locator('#manual-entry-error')).toContainText('Item name');
    await page.locator('#manual-name').fill('Homemade toast');
    await page.locator('#manual-quantity').fill('2');
    await page.locator('#manual-unit').fill('slices');
    for (const [key, value] of Object.entries({ calories: '240', protein: '8', carbs: '38', fat: '6' })) await page.locator(`#manual-${key}`).fill(value);
    await page.locator('#manual-fiber').fill('-1');
    await page.locator('#manual-save').click();
    await expect(page.locator('#manual-entry-error')).toContainText('Fiber');
    expect(writes).toHaveLength(0);
    await page.locator('#manual-fiber').fill('');
    await page.locator('#manual-quick-add').check();
    await expect(page.locator('#manual-entry-error')).toHaveText('');
    const accessibility = await new AxeBuilder({ page }).include('#manual-entry-overlay').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.locator('#manual-save').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#manual-name')).toBeFocused();
    await expect(page.locator('#manual-calories')).toHaveValue('240');
    await expect(page.locator('#manual-time')).toHaveValue('2026-10-27T12:45');
    await page.locator('#manual-entry-overlay').screenshot({ path: info.outputPath(`manual-nutrition-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#manual-save').evaluate(button => { button.click(); button.click(); });
    await expect(page.locator('#manual-save')).toHaveText('Retry save');
    expect(writes).toHaveLength(1);
    const first = writes[0];
    expect(first.body.consumedAt).toBe('2026-10-27T16:45:00.000Z');
    expect(first.body.items[0]).toMatchObject({ itemName: 'Homemade toast', quantity: 2, calories: 240, fiber: null, source: 'manual', needsReview: false });
    expect(first.body.saveItems[0]).toMatchObject({ name: 'Homemade toast', quantity: 2, calories: 240, fiber: null });
    await expect(page.locator('#manual-calories')).toBeDisabled();
    await page.locator('#manual-entry-overlay').screenshot({ path: info.outputPath(`manual-retry-${width}.png`) });
    await page.locator('#manual-cancel').click();
    await open.click();
    await expect(page.locator('#manual-save')).toHaveText('Retry save');
    await page.locator('#manual-save').click();
    await expect(page.locator('#manual-entry-overlay')).toHaveCount(0);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(first);
    expect(receipts.size).toBe(1);
    await open.click();
    for (const [key, value] of Object.entries({ name: 'Water', calories: '0', protein: '0', carbs: '0', fat: '0', fiber: '0' })) await page.locator(`#manual-${key}`).fill(value);
    await page.locator('#manual-save').click();
    await expect(page.locator('#manual-entry-overlay')).toHaveCount(0);
    expect(writes[2].id).not.toBe(first.id);
    expect(writes[2].body.items[0].fiber).toBe(0);
    expect(writes[2].body.saveItems).toEqual([]);
    await open.click();
    await page.evaluate(() => { state.currentUser = { ...state.currentUser, id: 'different-account' }; });
    await page.locator('#manual-save').click();
    await expect(page.locator('#manual-entry-error')).toContainText('account or timezone changed');
    expect(writes).toHaveLength(3);
    expect(errors).toEqual([]);
  });
}
