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
    avgRestingHeartRate: null, avgHrvMs: null, latestVo2Max: null,
    avgWalkingRunningDistanceM: null, avgFlightsClimbed: null, avgWalkingSpeedMps: null,
    avgWalkingStepLengthM: null, avgHeartRateAvgBpm: null, avgHeartRateMinBpm: null,
    lowestHeartRateMinBpm: null, avgRespiratoryRateBrpm: null, avgOxygenSaturationPct: null
  };
}

function emptyDay(day) {
  return {
    day, steps: null, activeEnergyKcal: null, exerciseMinutes: null, restingHeartRate: null, hrvMs: null, vo2max: null,
    walkingRunningDistanceM: null, flightsClimbed: null, walkingSpeedMps: null, walkingStepLengthM: null,
    heartRateAvgBpm: null, heartRateMinBpm: null, respiratoryRateBrpm: null, oxygenSaturationPct: null
  };
}

const ALL_STATS = ['steps', 'distance', 'flights', 'energy', 'exercise', 'speed', 'stride',
  'hr', 'hrmin', 'rhr', 'hrv', 'resp', 'spo2', 'vo2'];
const ALL_CHARTS = ['steps', 'distance', 'energy', 'hr', 'rhr', 'hrv'];

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
  let iphoneAndOuraOnly = false;
  let legacyServer = false;
  await page.route('**/api/health-metrics?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.searchParams.get('scope'));
    if (legacyServer) {
      // An older server: only the original six fields exist.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: url.searchParams.get('scope'),
          enabled: true,
          days: [{ day: isoDay(-1), steps: 7000, activeEnergyKcal: 400, exerciseMinutes: null, restingHeartRate: null, hrvMs: null, vo2max: null }],
          summary: {
            current: { daysWithData: 1, avgSteps: 7000, avgActiveEnergyKcal: 400, avgExerciseMinutes: null,
              avgRestingHeartRate: null, avgHrvMs: null, latestVo2Max: null },
            previous: { daysWithData: 0, avgSteps: null, avgActiveEnergyKcal: null, avgExerciseMinutes: null,
              avgRestingHeartRate: null, avgHrvMs: null, latestVo2Max: null }
          }
        })
      });
      return;
    }
    if (iphoneAndOuraOnly) {
      // No Apple Watch: iPhone motion metrics plus heart rate, respiratory rate
      // and blood oxygen that the Oura app writes to Apple Health.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: url.searchParams.get('scope'),
          enabled: true,
          days: [{
            ...emptyDay(isoDay(-1)), steps: 7000, activeEnergyKcal: 400, walkingRunningDistanceM: 5150,
            flightsClimbed: 8, walkingSpeedMps: 1.3, walkingStepLengthM: 0.7, heartRateAvgBpm: 66,
            heartRateMinBpm: 49, respiratoryRateBrpm: 14, oxygenSaturationPct: 97
          }],
          summary: {
            current: {
              ...emptySummary(), daysWithData: 1, avgSteps: 7000, avgActiveEnergyKcal: 400,
              avgWalkingRunningDistanceM: 5150, avgFlightsClimbed: 8, avgWalkingSpeedMps: 1.3,
              avgWalkingStepLengthM: 0.7, avgHeartRateAvgBpm: 66, avgHeartRateMinBpm: 49, lowestHeartRateMinBpm: 49,
              avgRespiratoryRateBrpm: 14, avgOxygenSaturationPct: 97
            },
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
          {
            ...emptyDay(isoDay(-2)), steps: 8000, activeEnergyKcal: 450, exerciseMinutes: 25, restingHeartRate: 56.5, hrvMs: 42.1,
            walkingRunningDistanceM: 5633, flightsClimbed: 10, walkingSpeedMps: 1.38, walkingStepLengthM: 0.73,
            heartRateAvgBpm: 69.1, heartRateMinBpm: 48, respiratoryRateBrpm: 14.4, oxygenSaturationPct: 96.2
          },
          {
            ...emptyDay(isoDay(-1)), steps: 12000, activeEnergyKcal: 650, exerciseMinutes: 45, restingHeartRate: 55.5, hrvMs: 47.9, vo2max: 41.3,
            walkingRunningDistanceM: 7241, flightsClimbed: 14, walkingSpeedMps: 1.4, walkingStepLengthM: 0.75,
            heartRateAvgBpm: 67.7, heartRateMinBpm: 46, respiratoryRateBrpm: 14, oxygenSaturationPct: 96.8
          }
        ],
        summary: {
          current: {
            daysWithData: 2, avgSteps: 10000, avgActiveEnergyKcal: 550, avgExerciseMinutes: 35, avgRestingHeartRate: 56,
            avgHrvMs: 45, latestVo2Max: 41.3, avgWalkingRunningDistanceM: 6437, avgFlightsClimbed: 12,
            avgWalkingSpeedMps: 1.39, avgWalkingStepLengthM: 0.74, avgHeartRateAvgBpm: 68.4, avgHeartRateMinBpm: 47,
            lowestHeartRateMinBpm: 46, avgRespiratoryRateBrpm: 14.2, avgOxygenSaturationPct: 96.5
          },
          previous: {
            ...emptySummary(), daysWithData: 3, avgSteps: 9000, avgRestingHeartRate: 57.2,
            avgWalkingRunningDistanceM: 4828, avgHeartRateAvgBpm: 70.4
          }
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
  // US units: miles, mph and inches from the stored meters and m/s.
  await expect(page.locator('#activity-stat-distance')).toHaveText('4.0 mi');
  await expect(page.locator('#activity-stat-distance-change')).toHaveText('+1.0 mi vs last week');
  await expect(page.locator('#activity-stat-flights')).toHaveText('12');
  await expect(page.locator('#activity-stat-speed')).toHaveText('3.1 mph');
  await expect(page.locator('#activity-stat-stride')).toHaveText('29 in');
  await expect(page.locator('#activity-stat-hr')).toHaveText('68 bpm');
  await expect(page.locator('#activity-stat-hr-change')).toHaveText('−2 bpm vs last week');
  await expect(page.locator('#activity-stat-hrmin')).toHaveText('47 bpm');
  await expect(page.locator('#activity-stat-resp')).toHaveText('14.2 br/min');
  await expect(page.locator('#activity-stat-spo2')).toHaveText('96.5%');
  await expect(page.locator('#activity-steps-average')).not.toHaveText('none');
  await expect(page.locator('#activity-distance-average')).toHaveText('4');
  await expect(page.locator('#activity-hr-average')).not.toHaveText('none');

  await page.locator('#activity-period-toggle').getByRole('button', { name: 'Month' }).click();
  await expect(page.locator('#activity-snapshot-heading')).toHaveText('Monthly Snapshot');
  await expect(page.locator('#activity-stat-steps-change')).toHaveText('+1,000 vs previous 30 days');
  expect(requests).toEqual(['week', 'month']);
  for (const key of ALL_STATS) {
    await expect(page.locator(`[data-activity-stat="${key}"]`)).toBeVisible();
  }
  for (const key of ALL_CHARTS) {
    await expect(page.locator(`#activity-${key}-canvas`)).toBeVisible();
  }

  // Metrics with no data anywhere in the response are hidden, not shown as "—".
  iphoneAndOuraOnly = true;
  await page.locator('#activity-period-toggle').getByRole('button', { name: 'Year' }).click();
  await expect(page.locator('#activity-stat-steps')).toHaveText('7,000');
  await expect(page.locator('#activity-stat-steps-change')).toHaveText('No previous data');
  await expect(page.locator('#activity-stat-distance')).toHaveText('3.2 mi');
  await expect(page.locator('#activity-stat-spo2')).toHaveText('97.0%');
  await expect(page.locator('#activity-empty')).toBeHidden();
  const shown = ['steps', 'distance', 'flights', 'energy', 'speed', 'stride', 'hr', 'hrmin', 'resp', 'spo2'];
  for (const key of shown) {
    await expect(page.locator(`[data-activity-stat="${key}"]`)).toBeVisible();
  }
  for (const key of ALL_STATS.filter((stat) => !shown.includes(stat))) {
    await expect(page.locator(`[data-activity-stat="${key}"]`)).toBeHidden();
  }
  for (const key of ['steps', 'distance', 'energy', 'hr']) {
    await expect(page.locator(`#activity-${key}-canvas`)).toBeVisible();
  }
  for (const key of ['rhr', 'hrv']) {
    await expect(page.locator(`#activity-${key}-canvas`)).toBeHidden();
  }
  await expect(page.locator('#activity-stats > .card:visible')).toHaveCount(shown.length);
  await expect(page.locator('#activity-charts-section .activity-chart:visible')).toHaveCount(4);
  expect(requests).toEqual(['week', 'month', 'year']);

  // An older server without the new fields: only its metrics show.
  legacyServer = true;
  await page.locator('#activity-period-toggle').getByRole('button', { name: 'Week' }).click();
  await expect(page.locator('#activity-stat-steps')).toHaveText('7,000');
  await expect(page.locator('#activity-stats > .card:visible')).toHaveCount(2);
  await expect(page.locator('#activity-charts-section .activity-chart:visible')).toHaveCount(2);
  for (const key of ['distance', 'hr']) {
    await expect(page.locator(`#activity-${key}-canvas`)).toBeHidden();
  }

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
