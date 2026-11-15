const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

function isoDay(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function emptySummary() {
  return {
    daysWithData: 0, avgSteps: null, avgActiveEnergyKcal: null, avgExerciseMinutes: null,
    avgRestingHeartRate: null, avgHrvMs: null, latestVo2Max: null
  };
}

test('Health > Activity shows the empty state from the real API, then mocked Apple Health metrics', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // Real server first: a fresh account has no Apple Health metrics.
  await page.goto('/#health/activity');
  const tab = page.getByRole('tab', { name: 'Activity' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#activity-page')).toBeVisible();
  await expect(page.locator('#activity-empty')).toBeVisible();
  await expect(page.locator('#activity-empty')).toContainText('Settings → Data Sources → Apple Health');
  await expect(page.locator('#activity-stats')).toBeHidden();

  const requests = [];
  let stepsAndEnergyOnly = false;
  await page.route('**/api/health-metrics?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.searchParams.get('scope'));
    if (stepsAndEnergyOnly) {
      // No Apple Watch: only steps and active energy ever have values.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: url.searchParams.get('scope'),
          enabled: true,
          days: [
            { day: isoDay(-1), steps: 7000, activeEnergyKcal: 400, exerciseMinutes: null, restingHeartRate: null, hrvMs: null, vo2max: null }
          ],
          summary: {
            current: { ...emptySummary(), daysWithData: 1, avgSteps: 7000, avgActiveEnergyKcal: 400 },
            previous: emptySummary()
          }
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        scope: url.searchParams.get('scope'),
        enabled: true,
        days: [
          { day: isoDay(-2), steps: 8000, activeEnergyKcal: 450, exerciseMinutes: 25, restingHeartRate: 56.5, hrvMs: 42.1, vo2max: null },
          { day: isoDay(-1), steps: 12000, activeEnergyKcal: 650, exerciseMinutes: 45, restingHeartRate: 55.5, hrvMs: 47.9, vo2max: 41.3 }
        ],
        summary: {
          current: { daysWithData: 2, avgSteps: 10000, avgActiveEnergyKcal: 550, avgExerciseMinutes: 35, avgRestingHeartRate: 56, avgHrvMs: 45, latestVo2Max: 41.3 },
          previous: { ...emptySummary(), daysWithData: 3, avgSteps: 9000, avgRestingHeartRate: 57.2 }
        }
      })
    });
  });

  await page.getByRole('tab', { name: 'Sleep' }).click();
  await expect(page).toHaveURL(/#health\/sleep$/);
  await tab.click();
  await expect(page).toHaveURL(/#health\/activity$/);
  await expect(page.locator('#activity-empty')).toBeHidden();
  await expect(page.locator('#activity-stat-steps')).toHaveText('10,000');
  await expect(page.locator('#activity-stat-steps-change')).toHaveText('+1,000 vs last week');
  await expect(page.locator('#activity-stat-rhr')).toHaveText('56.0 bpm');
  await expect(page.locator('#activity-stat-rhr-change')).toHaveText('−1.2 bpm vs last week');
  await expect(page.locator('#activity-stat-energy-change')).toHaveText('No previous data');
  await expect(page.locator('#activity-stat-vo2')).toHaveText('41.3');
  await expect(page.locator('#activity-steps-average')).not.toHaveText('none');

  await page.locator('#activity-period-toggle').getByRole('button', { name: 'Month' }).click();
  await expect(page.locator('#activity-snapshot-heading')).toHaveText('Monthly Snapshot');
  await expect(page.locator('#activity-stat-steps-change')).toHaveText('+1,000 vs previous 30 days');
  expect(requests).toEqual(['week', 'month']);
  for (const key of ['steps', 'energy', 'exercise', 'rhr', 'hrv', 'vo2']) {
    await expect(page.locator(`[data-activity-stat="${key}"]`)).toBeVisible();
  }
  for (const key of ['steps', 'energy', 'rhr', 'hrv']) {
    await expect(page.locator(`#activity-${key}-canvas`)).toBeVisible();
  }

  // Metrics with no data anywhere in the response are hidden, not shown as "—".
  stepsAndEnergyOnly = true;
  await page.locator('#activity-period-toggle').getByRole('button', { name: 'Year' }).click();
  await expect(page.locator('#activity-stat-steps')).toHaveText('7,000');
  await expect(page.locator('#activity-stat-steps-change')).toHaveText('No previous data');
  await expect(page.locator('#activity-empty')).toBeHidden();
  for (const key of ['steps', 'energy']) {
    await expect(page.locator(`[data-activity-stat="${key}"]`)).toBeVisible();
    await expect(page.locator(`#activity-${key}-canvas`)).toBeVisible();
  }
  for (const key of ['exercise', 'rhr', 'hrv', 'vo2']) {
    await expect(page.locator(`[data-activity-stat="${key}"]`)).toBeHidden();
  }
  for (const key of ['rhr', 'hrv']) {
    await expect(page.locator(`#activity-${key}-canvas`)).toBeHidden();
  }
  await expect(page.locator('#activity-stats > .card:visible')).toHaveCount(2);
  await expect(page.locator('#activity-charts-section .activity-chart:visible')).toHaveCount(2);
  expect(requests).toEqual(['week', 'month', 'year']);

  // Arrow keys move between Health sub-tabs.
  await tab.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Sleep' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include('#activity-page')
    .analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))
    .map((violation) => violation.id)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
