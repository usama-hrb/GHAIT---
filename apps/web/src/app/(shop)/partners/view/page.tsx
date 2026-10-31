import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PartnerAccountScreen } from '@/features/partners';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.partners.account };

/** /partners/view?id=<uuid>: one cached page for both partners (offline). */
export default function PartnerAccountPage() {
  return (
    <Suspense>
      <PartnerAccountScreen />
    </Suspense>
  );
}
