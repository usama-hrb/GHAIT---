import { join } from 'node:path';
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Workspace packages that apps may import (BUILD_PROMPTS §1.3). */
export const WORKSPACE_LIBS = ['@fabric/core', '@fabric/contracts'];

/** Strict, type-aware TypeScript rules shared by every package. */
export function typescript(rootDir) {
  return defineConfig(
    globalIgnores(['**/dist/**', '**/.next/**', '**/coverage/**', '**/next-env.d.ts']),
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: rootDir },
      },
      rules: {
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  );
}

/**
 * Policies for third-party and workspace imports, shared by the apps:
 * any npm package or Node builtin, but from the workspace only @fabric/core and @fabric/contracts.
 * The last matching policy wins.
 */
export const APP_EXTERNAL_POLICIES = [
  { allow: { to: { module: { origin: ['external', 'core'] } } } },
  { disallow: { to: { module: { source: '@fabric/*' } } } },
  { allow: { to: { module: { source: WORKSPACE_LIBS } } } },
];

/**
 * eslint-plugin-boundaries setup. Everything not allowed by a policy is an error,
 * including npm packages, Node builtins and local files outside any element.
 * Imports between files of the same element are always allowed.
 * Paths in `elements`, `files` and `include` are relative to `rootDir` (the package root).
 * Relative imports that escape the package (../../other-package) are caught by dependency-cruiser.
 */
export function boundaryRules({ rootDir, elements, files = [], include = ['src/**'], policies }) {
  return {
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': rootDir,
      'boundaries/include': include,
      'boundaries/elements': elements,
      'boundaries/files': files,
      'boundaries/legacy-templates': false,
      'boundaries/flag-as-external': {
        unresolvableAlias: true,
        inNodeModules: true,
        outsideRootPath: false,
        // pnpm links workspace packages outside node_modules; classify them by package name.
        customSourcePatterns: ['@fabric/*'],
      },
      'import/resolver': {
        typescript: { project: join(rootDir, 'tsconfig.json'), alwaysTryTypes: true },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        { default: 'disallow', checkAllOrigins: true, checkUnknownLocals: true, policies },
      ],
    },
  };
}
