import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RollScreen } from '@/features/inventory';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.inventory.title };

/** /inventory/roll?id=<roll>: one cached page for every roll (offline). */
export default function RollPage() {
  return (
    <Suspense>
      <RollScreen />
    </Suspense>
  );
}
