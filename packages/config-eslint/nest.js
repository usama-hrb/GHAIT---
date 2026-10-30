import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { APP_EXTERNAL_POLICIES, boundaryRules, typescript } from './shared.js';

const moduleIndex = { element: { type: 'module', fileInternalPath: 'index.ts' } };

/**
 * ESLint config for apps/api (NestJS).
 *
 * - modules/<name> → another module's index.ts, common, config, database
 * - common → config (never modules)
 * - config → nothing local; database → config
 * - main.ts / app.module.ts → module index files, common, config, database
 * - tests may import anything local
 * Files inside one element may always import each other.
 */
export function nest({ rootDir }) {
  return defineConfig(
    typescript(rootDir),
    {
      languageOptions: { globals: globals.node },
      rules: {
        // Nest modules are empty classes carrying a decorator.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    {
      // Request input is validated with the zod contracts: ZodBody / ZodQuery / ZodParam
      // (src/common/zod.ts) validate and document it; the bare decorators do neither.
      files: ['src/modules/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@nestjs/common',
                importNames: ['Body', 'Query', 'Param'],
                message:
                  'Use ZodBody, ZodQuery or ZodParam from common (validated with @fabric/contracts).',
              },
            ],
          },
        ],
      },
    },
    boundaryRules({
      rootDir,
      include: ['src/**', 'test/**'],
      elements: [
        { type: 'common', pattern: 'src/common', partialMatch: false },
        { type: 'config', pattern: 'src/config', partialMatch: false },
        { type: 'database', pattern: 'src/database', partialMatch: false },
        { type: 'module', pattern: 'src/modules/*', partialMatch: false, capture: ['name'] },
      ],
      files: [
        { category: 'bootstrap', pattern: 'src/*.ts' },
        { category: 'test', pattern: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**'] },
      ],
      policies: [
        ...APP_EXTERNAL_POLICIES,
        {
          from: { file: { categories: 'bootstrap' } },
          allow: {
            to: [
              moduleIndex,
              { element: { type: ['common', 'config', 'database'] } },
              { file: { categories: 'bootstrap' } },
            ],
          },
        },
        {
          from: { element: { type: 'module' } },
          allow: { to: [moduleIndex, { element: { type: ['common', 'config', 'database'] } }] },
        },
        {
          from: { element: { type: 'common' } },
          allow: { to: { element: { type: 'config' } } },
        },
        {
          from: { element: { type: 'database' } },
          allow: { to: { element: { type: 'config' } } },
        },
        {
          from: { file: { categories: 'test' } },
          allow: { to: { module: { origin: 'local' } } },
        },
      ],
    }),
  );
}
