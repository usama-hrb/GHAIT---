import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettlementDetailScreen } from '@/features/settlements';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settlements.title };

/** /settlements/view?id=<uuid>: one cached page for every settlement (offline). */
export default function SettlementPage() {
  return (
    <Suspense>
      <SettlementDetailScreen />
    </Suspense>
  );
}
