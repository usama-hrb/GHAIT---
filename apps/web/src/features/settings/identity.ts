'use client';

import type { PhotoImage } from '@fabric/contracts';
import { useMemo } from 'react';
import { useLiveQuery, useRepositories } from '@/local-db';
import type { BrandIdentity } from '@/shared/brand';
import { shopToday } from '@/shared/lib/dates';

/** The logo as an `<img>` source: the JPEG a device keeps, as a `data:` URL. */
export function logoSrcOf(logo: PhotoImage | null): string | null {
  return logo === null ? null : `data:${logo.contentType};base64,${logo.data}`;
}

/**
 * The shop's name and logo (ADR 0017), read from this device's copy of the settings, so they show
 * offline too. The one place they are read for display: the sidebar, the header and the profile
 * preview all use it. Undefined while the device reads them.
 */
export function useShopIdentity(): BrandIdentity | undefined {
  const repositories = useRepositories();
  const identity = useLiveQuery(() => repositories.settings.identity(shopToday()), [repositories]);
  return useMemo(
    () => (identity ? { name: identity.name, logoSrc: logoSrcOf(identity.logo) } : undefined),
    [identity],
  );
}
