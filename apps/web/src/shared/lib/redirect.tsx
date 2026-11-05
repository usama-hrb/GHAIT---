'use client';

import { useEffect } from 'react';
import { LoadingState } from '@/shared/brand';
import { useAppNavigation } from './navigation';

/**
 * A page that is gone, kept as a route so an old link or bookmark lands on its replacement, offline
 * too: the service worker precaches this shell page and it sends the visitor on. It redirects on
 * the client rather than the server on purpose: a server redirect would be what the service worker
 * precached for the old address, and the page it serves offline would not move.
 */
export function RedirectTo({ href, keepSearch = false }: { href: string; keepSearch?: boolean }) {
  const navigation = useAppNavigation();
  useEffect(() => {
    // A record page takes its record as ?id= (the service worker ignores it): carry it over.
    navigation.replace(keepSearch ? `${href}${window.location.search}` : href);
  }, [navigation, href, keepSearch]);
  return <LoadingState />;
}
