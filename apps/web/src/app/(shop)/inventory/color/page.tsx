import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ColorScreen } from '@/features/inventory';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.inventory.title };

/** /inventory/color?id=<variant>: one cached page for every colour (offline). */
export default function ColorPage() {
  return (
    <Suspense>
      <ColorScreen />
    </Suspense>
  );
}
