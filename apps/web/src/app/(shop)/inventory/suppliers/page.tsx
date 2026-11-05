import type { Metadata } from 'next';
import { SuppliersScreen } from '@/features/payables';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.payables.title };

/** The same supplier directory as /payables (this address is where the stock menu always led). */
export default function SuppliersPage() {
  return <SuppliersScreen />;
}
