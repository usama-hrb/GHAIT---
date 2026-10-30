import type { Metadata } from 'next';
import { PurchaseListScreen } from '@/features/purchasing';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.purchasing.listTitle };

export default function PurchasesPage() {
  return <PurchaseListScreen />;
}
