import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/stack';

/**
 * End-to-end tests against the real stack (e2e/global-setup.ts): Postgres in a container, the
 * built API, and a production build of the web app proxying /api to it. `make e2e`.
 */
/**
 * `E2E_SHOPS=adopted` (e2e/global-setup.ts) runs the same specs on a multi-shop server with the shop
 * adopted (ADR 0029, Step 4). One test asserts the exact JSON `{ open: false }` of the sign-up
 * status, which a multi-shop server also gives a `shopId`; the spec is left as it is and skipped
 * here. The same case is tested in apps/api/test/shop-adopt.e2e-spec.ts.
 */
const adopted = process.env.E2E_SHOPS === 'adopted';

export default defineConfig({
  testDir: './e2e',
  grepInvert: adopted ? /sign-up is closed once the shop has an owner/ : undefined,
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
