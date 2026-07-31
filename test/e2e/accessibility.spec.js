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
  await page.locator('#account-info-btn').click();

  const modal = page.locator('.account-privacy-modal');
  await expect(modal.getByRole('heading', { name: 'Account & Privacy' })).toBeVisible();
  const violations = await criticalViolations(page, '.account-privacy-modal');
  await testInfo.attach('axe-account-settings.json', {
    body: JSON.stringify(formatViolations(violations), null, 2),
    contentType: 'application/json'
  });
  expect(formatViolations(violations)).toEqual([]);
});

test('Integration Data Access modal has no critical accessibility violations', async ({
  page
}, testInfo) => {
  await page.route('**/api/integrations/access', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sources: [{
          id: 'oura',
          displayName: 'Oura Ring',
          connected: true,
          available: true,
          configurationRequired: true,
          dataTypes: [{
            id: 'sleep',
            displayName: 'Sleep',
            detail: 'Import Oura sleep sessions and daily sleep scores.',
            read: { supported: true },
            write: {
              supported: false,
              disabledReason: 'DailyMacros does not write health data to Oura.'
            }
          }]
        }]
      })
    });
  });

  await page.goto('/?oura=connected&access=required');
  const modal = page.getByRole('dialog', { name: 'Data Access' });
  await expect(modal).toBeVisible();
  const violations = await criticalViolations(page, '#integration-access-modal-overlay');
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
