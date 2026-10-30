'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

/** Offline, to another page: Next cannot fetch that page's data; a page load can (precache). */
function needsPageLoad(href: string): boolean {
  return (
    !navigator.onLine && new URL(href, window.location.href).pathname !== window.location.pathname
  );
}

/**
 * Navigation after a save that also works offline. Online, and offline within the same page
 * (?id= changes), it is Next's client navigation. Offline to another page it is a plain page
 * load, which the service worker answers from its precache (shell pages; record ids are ?id=).
 */
export function useAppNavigation(): {
  push: (href: string) => void;
  replace: (href: string) => void;
} {
  const router = useRouter();
  return useMemo(
    () => ({
      push: (href) => {
        if (needsPageLoad(href)) window.location.assign(href);
        else router.push(href);
      },
      replace: (href) => {
        if (needsPageLoad(href)) window.location.replace(href);
        else router.replace(href);
      },
    }),
    [router],
  );
}
