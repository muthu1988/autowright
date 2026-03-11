// @ts-check
'use strict';

require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  testMatch: ['**/*.spec.js', '**/*.spec.ts'],
  globalSetup: 'setup/global-setup.ts',
  timeout: 120_000,         // per-test timeout (SSO redirect chain can consume 30-60s)
  retries: 0,
  expect: {
    // SPAs need time to hydrate after load — increase from default 5s
    timeout: 20_000,
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL || 'https://beta.rocket.com',
    storageState: 'data/storage-state.json',  // inject saved auth into every test
    headless: false,         // set true to run silently
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // domcontentloaded so goto() doesn't wait for background API polling
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
