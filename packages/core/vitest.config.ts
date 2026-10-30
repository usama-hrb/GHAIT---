import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Pure re-export barrels only; modules may keep logic in their index.ts.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/numeric/index.ts',
        'src/costing/index.ts',
        'src/payments/index.ts',
        'src/settlement/index.ts',
        'src/integrity/index.ts',
      ],
      // BUILD_PROMPTS 1.5: core must stay at >= 95% line coverage.
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
