const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function criticalViolations(page, include) {
  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) {
    builder = builder.include(include);
  }
  const results = await builder.analyze();
  return results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious'
  );
}

function formatViolations(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      summary: node.failureSummary
    }))
  }));
}

test('primary navigation and active pages have no critical accessibility violations', async ({
  page
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

  const destinations = [
    ['Today', '#today-page'],
    ['Macros', '#macros-page'],
    ['Workouts', '#workout-page'],
    ['Health', '#health-page'],
    ['Insights', '#analysis-page']
  ];
  const allViolations = [];

  for (const [label, selector] of destinations) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.locator(selector)).toBeVisible();
    const violations = await criticalViolations(page, selector);
    allViolations.push(...violations.map((violation) => ({
      page: label,
      ...violation
    })));
  }

  await testInfo.attach('axe-primary-pages.json', {
    body: JSON.stringify(formatViolations(allViolations), null, 2),
    contentType: 'application/json'
  });
  expect(formatViolations(allViolations)).toEqual([]);
});

test('Account & Privacy modal has no critical accessibility violations', async ({
  page
}, testInfo) => {
  await page.goto('/');
  await page.locator('#profile-chip').click();
  const accountButton = page.locator('#account-info-btn');
  await accountButton.click();

  const modal = page.getByRole('dialog', { name: 'Account & Privacy' });
  const heading = modal.getByRole('heading', { name: 'Account & Privacy' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  const violations = await criticalViolations(page, '.account-privacy-modal');
  await testInfo.attach('axe-account-settings.json', {
    body: JSON.stringify(formatViolations(violations), null, 2),
    contentType: 'application/json'
  });
  expect(formatViolations(violations)).toEqual([]);

  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#profile-chip')).toBeFocused();
});

test('Integration Data Access matrix has no critical accessibility violations', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/integrations/access', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sources: [
          {
            id: 'healthkit',
            displayName: 'Apple Health',
            connected: true,
            available: true,
            configurationRequired: false,
            dataTypes: [{
              id: 'sleep',
              displayName: 'Sleep',
              read: { supported: true },
              write: { supported: true },
              selection: { readEnabled: true, writeEnabled: false }
            }]
          },
          {
            id: 'oura',
            displayName: 'Oura Ring',
            connected: true,
            available: true,
            configurationRequired: false,
            dataTypes: [{
              id: 'sleep',
              displayName: 'Sleep',
              detail: 'Import Oura sleep sessions and daily sleep scores.',
              read: { supported: true },
              write: {
                supported: false,
                disabledReason: 'DailyMacros does not write health data to Oura.'
              },
              selection: { readEnabled: true, writeEnabled: false }
            }]
          },
          {
            id: 'workout_planner',
            displayName: 'Workout Planner',
            connected: false,
            available: false,
            unavailableReason: 'Workout Planner requires a linked Google account.',
            configurationRequired: false,
            dataTypes: [{
              id: 'workouts',
              displayName: 'Workouts',
              read: { supported: true },
              write: { supported: false, disabledReason: 'Write is not supported.' }
            }]
          }
        ]
      })
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

  await page.goto('/');
  await page.locator('#profile-chip').click();
  await page.locator('#account-info-btn').click();
  const matrix = page.locator('.integration-access-matrix');
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole('columnheader', { name: /Apple Health/ })).toContainText('Manage on iPhone');
  const matrixScroller = page.locator('.integration-access-matrix-scroll');
  const geometry = await matrixScroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    modalRight: element.closest('.account-privacy-modal')?.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    rowHeaderPosition: getComputedStyle(
      element.querySelector('tbody th[scope="row"]')
    ).position,
    columnHeaderPosition: getComputedStyle(
      element.querySelector('thead th[scope="col"]')
    ).position
  }));
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
  expect(geometry.modalRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.rowHeaderPosition).toBe('sticky');
  expect(geometry.columnHeaderPosition).toBe('sticky');
  await matrixScroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(() => matrixScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const violations = await criticalViolations(page, '#account-integration-access-list');
  await testInfo.attach('axe-integration-data-access.json', {
    body: JSON.stringify(formatViolations(violations), null, 2),
    contentType: 'application/json'
  });
  expect(formatViolations(violations)).toEqual([]);
});

test('mobile navigation retains visible labels and 44 point tap targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const navigation = page.getByRole('navigation', { name: 'App navigation' });
  const labels = ['Today', 'Macros', 'Workouts', 'Health', 'Insights'];
  for (const label of labels) {
    const button = navigation.getByRole('button', { name: label });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height, `${label} tap target height`).toBeGreaterThanOrEqual(44);
  }
});
