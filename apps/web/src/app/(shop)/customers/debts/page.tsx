import type { Metadata } from 'next';
import { DebtsScreen } from '@/features/customers';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.customers.debtsTitle };

export default function DebtsPage() {
  return <DebtsScreen />;
}
