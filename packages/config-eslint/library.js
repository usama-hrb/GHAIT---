import { defineConfig } from 'eslint/config';
import { boundaryRules, typescript } from './shared.js';

const TEST_ONLY_DEPENDENCIES = ['vitest', 'fast-check'];

/**
 * ESLint config for packages/core and packages/contracts.
 *
 * Source may import only its own files plus `runtimeDependencies`
 * (core: none; contracts: zod and @fabric/core). Node builtins are never allowed.
 * Tests may also import the test tooling.
 */
export function library({ rootDir, runtimeDependencies = [] }) {
  const policies = [
    {
      from: { file: { categories: 'test' } },
      allow: { to: { module: { origin: 'external', source: TEST_ONLY_DEPENDENCIES } } },
    },
  ];
  if (runtimeDependencies.length > 0) {
    policies.push({
      allow: { to: { module: { origin: 'external', source: runtimeDependencies } } },
    });
  }

  return defineConfig(
    typescript(rootDir),
    boundaryRules({
      rootDir,
      elements: [{ type: 'source', pattern: 'src', partialMatch: false }],
      files: [{ category: 'test', pattern: 'src/**/*.test.ts' }],
      policies,
    }),
  );
}
