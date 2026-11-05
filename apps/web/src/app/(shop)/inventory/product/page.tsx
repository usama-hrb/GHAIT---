import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductDetailScreen } from '@/features/inventory';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.productStock.title };

/** /inventory/product?id=<product>: one cached page for every product (offline). */
export default function ProductPage() {
  return (
    <Suspense>
      <ProductDetailScreen />
    </Suspense>
  );
}
