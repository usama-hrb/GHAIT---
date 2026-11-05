import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductInventoryScreen } from '@/features/inventory';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.productStock.title };

/** /inventory: the products and what each can sell (ADR 0011); `?filter=low` opens a filtered list (ADR 0018). */
export default function InventoryPage() {
  return (
    <Suspense>
      <ProductInventoryScreen />
    </Suspense>
  );
}
