import type { Metadata } from 'next';
import { FabricListScreen } from '@/features/catalog';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.catalog.fabricsTitle };

export default function InventoryPage() {
  return <FabricListScreen />;
}
