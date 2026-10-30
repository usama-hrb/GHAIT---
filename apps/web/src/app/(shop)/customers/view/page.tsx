import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CustomerScreen } from '@/features/customers';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.customers.listTitle };

/** /customers/view?id=<uuid>: one cached page for every customer (offline). */
export default function CustomerPage() {
  return (
    <Suspense>
      <CustomerScreen />
    </Suspense>
  );
}
