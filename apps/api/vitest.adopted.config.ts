import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The API e2e suite on a multi-shop server with the live shop adopted (ADR 0029, Step 4):
 * `pnpm test:e2e:adopted`. It is the same project as `e2e` in vitest.config.ts and the same spec
 * files, none of them changed. `TEST_SHOPS=adopted` makes `createTestApp` (test/support/app.ts)
 * adopt its database as the one shop of a control database and serve it at the address supertest
 * uses; the specs go on calling `createTestApp()` as before. The tests that assert what only a
 * one-shop server does are skipped, each with its reason (test/support/one-shop-only.ts).
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'e2e-adopted',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/one-shop-only.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    env: { TEST_SHOPS: 'adopted' },
  },
});
