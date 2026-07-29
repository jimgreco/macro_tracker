const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

module.exports = defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  outputDir: 'output/playwright/test-results',
  reporter: [
    ['line'],
    ['junit', { outputFile: 'output/playwright/results.xml' }],
    ['html', { outputFolder: 'output/playwright/report', open: 'never' }]
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? undefined
    : {
        command: 'npm start',
        url: `${baseURL}/healthz`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          APP_BASE_URL: baseURL,
          DATABASE_URL:
            process.env.PLAYWRIGHT_DATABASE_URL ||
            'postgres://postgres:postgres@127.0.0.1:5432/macro_tracker',
          LOCAL_AUTH_BYPASS: 'true',
          LOCAL_DEV_USER_ID: 'playwright-ci-user',
          LOCAL_DEV_USER_EMAIL: 'playwright-ci@example.com',
          LOCAL_DEV_USER_NAME: 'Playwright CI',
          NODE_ENV: 'test',
          SESSION_SECRET: 'playwright-ci-session-secret',
          PORT: new URL(baseURL).port || '3000'
        }
      }
});
