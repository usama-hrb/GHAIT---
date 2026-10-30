import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/stack';

/**
 * End-to-end tests against the real stack (e2e/global-setup.ts): Postgres in a container, the
 * built API, and a production build of the web app proxying /api to it. `make e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: E2E.webUrl,
    locale: 'ar-MA',
    timezoneId: 'Africa/Casablanca',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
