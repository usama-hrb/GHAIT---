import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SaleDetailScreen } from '@/features/pos';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.sales.detailTitle };

/** /pos/view?id=<uuid>: one cached page for every sale (offline). */
export default function SalePage() {
  return (
    <Suspense>
      <SaleDetailScreen />
    </Suspense>
  );
}
