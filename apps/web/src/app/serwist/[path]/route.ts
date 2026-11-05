import { randomUUID } from 'node:crypto';
import { createSerwistRoute } from '@serwist/turbopack';

// A new revision on every build, so the precached pages are fetched again after each deploy.
const revision = randomUUID();

/**
 * The app's shell pages: precached, so the PWA opens and navigates with no network. The pages
 * that no longer exist as screens (the purchase form and list, the fabric, colour and roll pages)
 * stay in the list on purpose: each is a small page that redirects to the Inventory, so an old
 * bookmark works offline too (ADR 0012).
 */
const SHELL_PAGES = [
  '/',
  '/login',
  '/signup',
  '/change-password',
  '/home',
  '/expenses',
  '/inventory',
  '/inventory/catalog',
  '/inventory/fabric',
  '/inventory/suppliers',
  '/inventory/color',
  '/inventory/product',
  '/inventory/roll',
  '/purchases',
  '/purchases/new',
  '/purchases/view',
  '/payables',
  '/payables/view',
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
  '/zakat',
  '/zakat/view',
  '/reports',
  '/settings',
  '/settings/selling',
  '/settings/regional',
  '/settings/partners',
  '/settings/partners/view',
  '/settings/partners/employee',
  '/settings/accounts',
  '/settings/sync',
  '/settings/data',
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
