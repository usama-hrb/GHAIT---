import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PurchaseDetailScreen } from '@/features/purchasing';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.purchasing.detailTitle };

/** /purchases/view?id=<uuid>: one cached page for every purchase (offline). */
export default function PurchasePage() {
  return (
    <Suspense>
      <PurchaseDetailScreen />
    </Suspense>
  );
}
