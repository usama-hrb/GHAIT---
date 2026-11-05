/// <reference lib="webworker" />
import { defaultCache } from '@serwist/turbopack/worker';
import { NetworkOnly, type PrecacheEntry, Serwist, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The app shell offline (ADR 0002): the build's static files and the shell pages are
 * precached; data never goes through this cache, it lives in IndexedDB.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    // Record pages take the record as ?id= (/purchases/view?id=…): one precached page serves
    // every record offline. The Home's links open a list already filtered (/inventory?filter=low,
    // /expenses?status=unpaid, ADR 0018): the same page serves them, and so the People page's
    // tabs (/settings/partners?tab=employees, ADR 0022). Only these are ignored, so Next's
    // ?_rsc= fetches still reach the network.
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^id$/, /^filter$/, /^status$/, /^tab$/],
    cleanupOutdatedCaches: true,
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // The API (auth, sync) is never cached: a stale pull or session would be worse than none.
    { matcher: ({ url }) => url.pathname.startsWith('/api/'), handler: new NetworkOnly() },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [{ url: '/~offline', matcher: ({ request }) => request.destination === 'document' }],
  },
});

serwist.addEventListeners();
