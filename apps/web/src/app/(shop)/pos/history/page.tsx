import type { Metadata } from 'next';
import { SalesListScreen } from '@/features/pos';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.sales.listTitle };

export default function SalesHistoryPage() {
  return <SalesListScreen />;
}
