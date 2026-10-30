import type { Metadata } from 'next';
import { InventoryScreen } from '@/features/inventory';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.inventory.title };

export default function InventoryPage() {
  return <InventoryScreen />;
}
