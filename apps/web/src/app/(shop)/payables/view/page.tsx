import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SupplierStatementScreen } from '@/features/payables';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.payables.title };

/** /payables/view?id=<uuid>: one cached page for every supplier (offline). */
export default function SupplierStatementPage() {
  return (
    <Suspense>
      <SupplierStatementScreen />
    </Suspense>
  );
}
