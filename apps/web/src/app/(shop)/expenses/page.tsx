import type { Metadata } from 'next';
import { ExpensesScreen } from '@/features/expenses';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.expenses.title };

export default function ExpensesPage() {
  return <ExpensesScreen />;
}
