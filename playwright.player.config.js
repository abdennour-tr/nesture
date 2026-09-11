const { defineConfig, devices } = require('@playwright/test');
const base = require('./playwright.config');

// Focused dashboard checks using full Chromium, including tablet/touch layouts.
module.exports = defineConfig({
  ...base,
  testMatch: 'player-dashboard.spec.js',
  retries: 0,
  timeout: 120000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: 'list',
  webServer: { ...base.webServer, command: 'node node_modules/react-scripts/scripts/start.js', env: { BROWSER: 'none' }, timeout: 240000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1366, height: 768 } } },
    { name: 'tablet', use: { ...devices['iPad Pro 11'], browserName: 'chromium', channel: 'chromium' } },
    { name: 'mobile', use: { ...devices['Pixel 5'], channel: 'chromium' } },
  ],
});
