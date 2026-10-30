import eslintReact from '@eslint-react/eslint-plugin';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { designSystemPlugin } from './design-system.js';
import { APP_EXTERNAL_POLICIES, boundaryRules, typescript } from './shared.js';

const featureIndex = { element: { type: 'feature', fileInternalPath: 'index.{ts,tsx}' } };

/**
 * ESLint config for apps/web (Next.js App Router).
 *
 * - app (routing only) → feature index files, shared, local-db, i18n
 * - features/<name> → another feature's index, shared, local-db, i18n
 * - shared → i18n (never features)
 * - local-db → shared
 * - i18n → nothing local
 * Files inside one element may always import each other.
 */
export function next({ rootDir }) {
  return defineConfig(
    typescript(rootDir),
    {
      files: ['**/*.{ts,tsx}'],
      extends: [eslintReact.configs['recommended-type-checked']],
    },
    reactHooks.configs.flat['recommended-latest'],
    nextPlugin.configs['core-web-vitals'],
    {
      languageOptions: { globals: { ...globals.browser, ...globals.node } },
      settings: { next: { rootDir } },
    },
    {
      // src/shared/ui is vendored shadcn/ui: kept close to upstream so `shadcn add --diff`
      // stays readable. tsc strict, boundaries and the design-system rules still apply.
      files: ['src/shared/ui/**/*.tsx'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/restrict-template-expressions': 'off',
        '@typescript-eslint/no-unnecessary-condition': 'off',
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        '@typescript-eslint/no-confusing-void-expression': 'off',
        '@typescript-eslint/no-misused-spread': 'off',
        '@eslint-react/no-nested-component-definitions': 'off',
        '@eslint-react/no-leaked-conditional-rendering': 'off',
        '@eslint-react/no-array-index-key': 'off',
        '@eslint-react/no-use-context': 'off',
        '@eslint-react/no-context-provider': 'off',
        '@eslint-react/use-state': 'off',
        '@eslint-react/dom-no-dangerously-set-innerhtml': 'off',
      },
    },
    {
      // Design-system rules (docs/design-usage.md): logical direction classes, tokens only.
      files: ['src/features/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
      plugins: { 'design-system': designSystemPlugin },
      rules: {
        'design-system/no-physical-direction-classes': 'error',
        'design-system/no-raw-colors': 'error',
      },
    },
    {
      // ADR 0002: screens read and write through local-db repositories, never IndexedDB or the
      // network directly, so every operation goes to the local database and the outbox first.
      files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
      ignores: ['src/app/sw.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'dexie', message: 'Use the local-db repositories.' },
              { name: 'dexie-react-hooks', message: 'Use useLiveQuery from local-db.' },
            ],
          },
        ],
        'no-restricted-globals': [
          'error',
          { name: 'fetch', message: 'Only local-db talks to the API (offline first).' },
          { name: 'indexedDB', message: 'Use the local-db repositories.' },
        ],
      },
    },
    boundaryRules({
      rootDir,
      elements: [
        { type: 'app', pattern: 'src/app', partialMatch: false },
        { type: 'feature', pattern: 'src/features/*', partialMatch: false, capture: ['name'] },
        { type: 'shared', pattern: 'src/shared', partialMatch: false },
        { type: 'local-db', pattern: 'src/local-db', partialMatch: false },
        { type: 'i18n', pattern: 'src/i18n', partialMatch: false },
      ],
      policies: [
        ...APP_EXTERNAL_POLICIES,
        {
          from: { element: { type: 'app' } },
          allow: {
            to: [featureIndex, { element: { type: ['shared', 'local-db', 'i18n'] } }],
          },
        },
        {
          from: { element: { type: 'feature' } },
          allow: { to: [featureIndex, { element: { type: ['shared', 'local-db', 'i18n'] } }] },
        },
        {
          from: { element: { type: 'shared' } },
          allow: { to: { element: { type: 'i18n' } } },
        },
        {
          from: { element: { type: 'local-db' } },
          allow: { to: { element: { type: 'shared' } } },
        },
      ],
    }),
  );
}
