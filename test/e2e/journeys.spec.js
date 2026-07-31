const { test, expect } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

async function expectHealthyPage(page, run) {
  const pageErrors = [];
  const serverErrors = [];
  const onPageError = (error) => pageErrors.push(error.message);
  const onResponse = (response) => {
    const url = new URL(response.url());
    if (
      url.origin === baseURL &&
      response.status() >= 500 &&
      !url.pathname.startsWith('/api/diagnostics/')
    ) {
      serverErrors.push(`${response.status()} ${url.pathname}`);
    }
  };

  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  try {
    await run();
  } finally {
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
  }

  expect(pageErrors, 'uncaught browser errors').toEqual([]);
  expect(serverErrors, 'server errors observed by the browser').toEqual([]);
}

async function openMacros(page) {
  await page.getByRole('button', { name: 'Macros' }).click();
  await expect(page.getByRole('heading', { name: 'Macros', exact: true })).toBeVisible();
  await expect(page.locator('#entries-day-label')).not.toHaveText('');
}

async function browserDateTime(page, offsetDays) {
  return page.evaluate((days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const pad = (value) => String(value).padStart(2, '0');
    return [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    ].join('T');
  }, offsetDays);
}

test.describe.serial('critical web journeys', () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.delete('/api/account', {
      headers: { Origin: baseURL }
    });
    expect(response.ok()).toBeTruthy();
  });

  test('first login reaches an empty account and target setup persists', async ({ page }) => {
    await expectHealthyPage(page, async () => {
      await page.goto('/login');
      await expect(page).toHaveURL(/\/#today$/);
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      await expect(page.getByText('Build your first useful day')).toBeVisible();

      await openMacros(page);
      await page.locator('#edit-targets-link').click();
      await expect(page.getByRole('heading', { name: 'Edit Macro Targets' })).toBeVisible();
      await page.locator('#target-modal-calories').fill('2100');
      await page.locator('#target-modal-protein').fill('160');
      await page.locator('#target-modal-carbs').fill('220');
      await page.locator('#target-modal-fat').fill('70');
      await page.locator('#target-modal-save-btn').click();

      await expect(page.locator('#action-banner')).toContainText('Macro targets updated.');
      await expect(page.locator('#today-calories-target')).toContainText('2100');
      await expect(page.locator('#today-protein-target')).toContainText('160');
    });
  });

  test('meal parsing can save a reviewed meal for yesterday', async ({ page }) => {
    await page.route('**/api/parse-meal', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mealName: 'CI Breakfast',
          mealQuantity: 1,
          mealUnit: 'serving',
          notes: 'Deterministic CI parse',
          review: { source: 'ai_text' },
          items: [
            {
              itemName: 'CI Oatmeal',
              quantity: 1,
              unit: 'bowl',
              calories: 320,
              protein: 14,
              carbs: 48,
              fat: 8,
              source: 'ai_text',
              confidence: 0.99,
              needsReview: false
            }
          ]
        })
      });
    });

    await expectHealthyPage(page, async () => {
      await page.goto('/#macros');
      await openMacros(page);
      await page.locator('#consumed-at').fill(await browserDateTime(page, -1));
      await page.locator('#meal-text').fill('oatmeal with protein');
      await page.locator('#parse-btn').click();

      const parsedItems = page.locator('#parsed-items-container');
      await expect(parsedItems.getByText('CI Oatmeal', { exact: true })).toBeVisible();
      await parsedItems.locator('#parsed-meal-save-quickadd').check();
      await parsedItems.getByRole('button', { name: 'Save' }).click();

      await expect(page.locator('#action-banner')).toContainText('Saved parsed items.');
      await page.locator('#entries-prev-day-btn').click();
      await expect(page.locator('#entries-by-day')).toContainText('CI Oatmeal');
      await page.locator('#entries-next-day-btn').click();
    });
  });

  test('Quick Add logs the saved meal template for today', async ({ page }) => {
    await expectHealthyPage(page, async () => {
      await page.goto('/#macros');
      await openMacros(page);
      await page.locator('#consumed-at').fill(await browserDateTime(page, 0));

      const picker = page.locator('#quick-entry-select');
      await expect(picker).toBeEnabled();
      const option = picker.locator('option', { hasText: 'CI Oatmeal' });
      await expect(option).toHaveCount(1);
      await picker.selectOption(await option.getAttribute('value'));
      await page.locator('#quick-add-btn').click();

      await expect(page.locator('#action-banner')).toContainText('Quick add logged.');
      await expect(page.locator('#entries-by-day')).toContainText('CI Oatmeal');
    });
  });

  test('Copy Yesterday copies the prior meal into today', async ({ page }) => {
    await expectHealthyPage(page, async () => {
      await page.goto('/#macros');
      await openMacros(page);
      await page.locator('#copy-yesterday-btn').click();

      await expect(page.locator('#action-banner')).toContainText(/Copied \d+ item/);
      await expect(page.locator('#entries-by-day').getByText('CI Oatmeal', { exact: true }))
        .toHaveCount(2);
    });
  });

  test('account settings save timezone and expose setup controls', async ({ page }) => {
    await expectHealthyPage(page, async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      await page.locator('#profile-chip').click();
      await page.locator('#account-info-btn').click();

      const modal = page.locator('.account-privacy-modal');
      await expect(modal.getByRole('heading', { name: 'Account & Privacy' })).toBeVisible();
      await modal.locator('#account-timezone-select').selectOption('America/Chicago');
      await modal.locator('#account-save-timezone-btn').click();
      await expect(page.locator('#action-banner')).toContainText('Timezone saved.');

      await modal.locator('#account-starter-quick-adds-btn').click();
      await expect(page.locator('#action-banner')).toContainText(/Starter quick adds|Added \d+ starter/);
      await expect(modal.locator('#account-export-btn')).toBeVisible();
      await expect(modal.locator('#account-delete-btn')).toBeVisible();
    });
  });

  test('Oura connection requires explicit per-type data access and can be managed later', async ({ page }) => {
    let savedPayload = null;
    let saved = false;
    const sourcePayload = () => ({
      id: 'oura',
      displayName: 'Oura Ring',
      connected: true,
      available: true,
      configurationRequired: !saved,
      dataTypes: [
        {
          id: 'sleep',
          displayName: 'Sleep',
          detail: 'Import Oura sleep sessions and daily sleep scores.',
          read: { supported: true },
          write: {
            supported: false,
            disabledReason: 'DailyMacros does not write health data to Oura.'
          },
          ...(saved ? { selection: { readEnabled: true, writeEnabled: false } } : {})
        },
        {
          id: 'readiness',
          displayName: 'Readiness',
          detail: 'Import Oura readiness scores.',
          read: { supported: true },
          write: {
            supported: false,
            disabledReason: 'DailyMacros does not write health data to Oura.'
          },
          ...(saved ? { selection: { readEnabled: false, writeEnabled: false } } : {})
        }
      ]
    });

    await page.route('**/api/integrations/access', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sources: [sourcePayload()] })
      });
    });
    await page.route('**/api/integrations/oura/access', async (route) => {
      savedPayload = route.request().postDataJSON();
      saved = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sourcePayload())
      });
    });
    await page.route('**/api/oura/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          connected: true,
          state: 'connected',
          updateMode: 'reconciliation'
        })
      });
    });

    await expectHealthyPage(page, async () => {
      await page.goto('/?oura=connected&access=required');
      const accessDialog = page.getByRole('dialog', { name: 'Data Access' });
      await expect(accessDialog).toBeVisible();
      await expect(page.locator('#action-banner')).toContainText('Choose which data');
      await expect(accessDialog.getByRole('checkbox', { name: 'Write Sleep to Oura Ring' })).toBeDisabled();
      await accessDialog.getByRole('checkbox', { name: 'Read Sleep from Oura Ring' }).check();
      await accessDialog.getByRole('button', { name: 'Save Data Access' }).click();

      await expect(page.locator('#action-banner')).toContainText('Oura Ring data access saved.');
      expect(savedPayload).toEqual({
        dataTypes: [
          { id: 'sleep', readEnabled: true, writeEnabled: false },
          { id: 'readiness', readEnabled: false, writeEnabled: false }
        ]
      });

      await page.locator('#profile-chip').click();
      await page.locator('#account-info-btn').click();
      const accountModal = page.locator('.account-privacy-modal');
      const manageAccessButton = accountModal.locator('[data-manage-integration-access="oura"]');
      await expect(manageAccessButton).toHaveText('Manage Data Access');
      await manageAccessButton.click();
      await expect(accessDialog).toBeVisible();
      await expect(accessDialog.getByRole('checkbox', { name: 'Read Sleep from Oura Ring' })).toBeChecked();
    });
  });

  test('Today reports the current Oura connection status', async ({ page }) => {
    await expectHealthyPage(page, async () => {
      const todayResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/today'
      );
      await page.goto('/');
      const todayPayload = await (await todayResponse).json();
      const ouraStatus = todayPayload.summary.recovery.ouraStatus;
      expect(['unavailable', 'disconnected']).toContain(ouraStatus);
      await expect(page.locator('#today-freshness')).not.toHaveText('Loading today');
      await expect(page.locator('#today-recovery-source')).toContainText(
        ouraStatus === 'disconnected' ? 'Oura not connected' : 'No connected recovery source'
      );
    });
  });

  test('responsive navigation keeps all five primary destinations reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await expectHealthyPage(page, async () => {
      await page.goto('/');
      const navigation = page.getByRole('navigation', { name: 'App navigation' });
      await expect(navigation).toBeVisible();

      const labels = ['Today', 'Macros', 'Workouts', 'Health', 'Insights'];
      for (const label of labels) {
        await expect(navigation.getByRole('button', { name: label })).toBeVisible();
      }

      const navigationBox = await navigation.boundingBox();
      expect(navigationBox).not.toBeNull();
      expect(navigationBox.y).toBeGreaterThan(500);
      expect(navigationBox.y + navigationBox.height).toBeLessThanOrEqual(844);
      const layoutWidth = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(
        layoutWidth.scrollWidth,
        `mobile page overflowed horizontally: ${JSON.stringify(layoutWidth)}`
      ).toBeLessThanOrEqual(layoutWidth.clientWidth);

      await navigation.getByRole('button', { name: 'Health' }).click();
      await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
      const healthWidth = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(
        healthWidth.scrollWidth,
        `mobile Health page overflowed horizontally: ${JSON.stringify(healthWidth)}`
      ).toBeLessThanOrEqual(healthWidth.clientWidth);
      await navigation.getByRole('button', { name: 'Insights' }).click();
      await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible();
    });
  });
});
