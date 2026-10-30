import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FabricEditorScreen } from '@/features/catalog';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.catalog.editFabric };

/** /inventory/fabric?id=<uuid>: one page for every fabric, so it is cached once for offline. */
export default function FabricPage() {
  return (
    <Suspense>
      <FabricEditorScreen />
    </Suspense>
  );
}
