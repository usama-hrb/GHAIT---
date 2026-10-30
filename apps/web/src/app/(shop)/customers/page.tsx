import type { Metadata } from 'next';
import { CustomersScreen } from '@/features/customers';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.customers.listTitle };

export default function CustomersPage() {
  return <CustomersScreen />;
}
