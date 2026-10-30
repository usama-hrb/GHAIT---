// Dependency directions from BUILD_PROMPTS §1.3, checked across the whole repo (`make deps`).
// ESLint (eslint-plugin-boundaries) enforces the same rules per package while editing.

const path = require('node:path');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-imports-nothing',
      comment: 'packages/core is pure: only its own files. Tests may use test tooling.',
      severity: 'error',
      from: { path: '^packages/core/src/', pathNot: '\\.test\\.ts$' },
      to: { pathNot: '^packages/core/src/' },
    },
    {
      name: 'contracts-imports-core-and-zod-only',
      severity: 'error',
      from: { path: '^packages/contracts/src/', pathNot: '\\.test\\.ts$' },
      to: {
        pathNot: [
          '^packages/contracts/src/',
          '^packages/core/',
          // pnpm real path: node_modules/.pnpm/zod@x/node_modules/zod/...
          'node_modules/zod/',
        ],
      },
    },
    {
      name: 'no-reaching-into-another-package',
      comment:
        'Import a workspace package by name (@fabric/x), never through a relative path into its files.',
      severity: 'error',
      from: { path: '^(apps|packages)/([^/]+)/' },
      to: { path: '^(apps|packages)/[^/]+/(src|test)/', pathNot: '^$1/$2/' },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-only-import-core-and-contracts',
      severity: 'error',
      from: { path: '^apps/[^/]+/(src|test)/' },
      to: { path: '^packages/', pathNot: '^packages/(core|contracts)/' },
    },
    {
      name: 'apps-are-independent',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'api-common-never-imports-modules',
      severity: 'error',
      from: { path: '^apps/api/src/common/' },
      to: { path: '^apps/api/src/modules/' },
    },
    {
      name: 'api-other-module-only-via-index',
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/api/src/modules/',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'api-layers-never-import-bootstrap',
      severity: 'error',
      from: { path: '^apps/api/src/[^/]+/' },
      to: { path: '^apps/api/src/[^/]+\\.ts$' },
    },
    {
      name: 'web-shared-never-imports-features',
      severity: 'error',
      from: { path: '^apps/web/src/shared/' },
      to: { path: '^apps/web/src/(features|local-db|app)/' },
    },
    {
      name: 'web-other-feature-only-via-index',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/features/',
        pathNot: ['^apps/web/src/features/$1/', '^apps/web/src/features/[^/]+/index\\.tsx?$'],
      },
    },
    {
      name: 'web-local-db-never-imports-features',
      severity: 'error',
      from: { path: '^apps/web/src/local-db/' },
      to: { path: '^apps/web/src/features/' },
    },
    {
      name: 'web-nothing-imports-app-routes',
      comment: 'app/ is routing only.',
      severity: 'error',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/app/' },
      to: { path: '^apps/web/src/app/' },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', '(^|/)dist/'] },
    exclude: { path: ['(^|/)\\.next/', '(^|/)coverage/', '(^|/)\\.turbo/'] },
    // Count `import type` too: a type-only import still couples two layers.
    tsPreCompilationDeps: true,
    // Resolves the web `@/*` alias from the repo root (apps/web/tsconfig.json resolves it relative
    // to apps/web, which tsconfig-paths gets wrong when cruising from the root).
    // Absolute on purpose: TypeScript 6 finds no inputs when given a relative config path.
    tsConfig: { fileName: path.join(__dirname, 'tsconfig.depcruise.json') },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
