import { randomUUID } from 'node:crypto';
import { createSerwistRoute } from '@serwist/turbopack';

// A new revision on every build, so the precached pages are fetched again after each deploy.
const revision = randomUUID();

/** The app's shell pages: precached, so the PWA opens and navigates with no network. */
const SHELL_PAGES = [
  '/',
  '/login',
  '/home',
  '/expenses',
  '/inventory',
  '/inventory/fabric',
  '/inventory/suppliers',
  '/inventory/color',
  '/inventory/roll',
  '/purchases',
  '/purchases/new',
  '/purchases/view',
  '/pos',
  '/pos/history',
  '/pos/view',
  '/customers',
  '/customers/debts',
  '/customers/view',
  '/partners',
  '/partners/view',
  '/settlements',
  '/settlements/view',
  '/integrity',
  '/audit',
  '/settings',
  '/settings/sync',
  '/~offline',
];

/** Builds and serves /serwist/sw.js from src/app/sw.ts (Serwist for Turbopack). */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: 'src/app/sw.ts',
    additionalPrecacheEntries: SHELL_PAGES.map((url) => ({ url, revision })),
    useNativeEsbuild: true,
  },
);
