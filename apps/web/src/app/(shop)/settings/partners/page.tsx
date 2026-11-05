import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PartnersScreen } from '@/features/partners';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.partners.title };

/**
 * People and partners live in Settings since ADR 0017; /partners redirects here. The tab is in the
 * address (?tab=employees), which the service worker ignores like ?id=.
 */
export default function PartnersSettingsPage() {
  return (
    <Suspense>
      <PartnersScreen />
    </Suspense>
  );
}
