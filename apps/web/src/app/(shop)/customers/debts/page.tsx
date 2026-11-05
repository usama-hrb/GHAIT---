import type { Metadata } from 'next';
import { CustomersScreen } from '@/features/customers';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.customers.debtsTitle };

export default function DebtsPage() {
  return <CustomersScreen debts />;
}
