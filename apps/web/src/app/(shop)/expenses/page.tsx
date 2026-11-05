import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExpensesScreen } from '@/features/expenses';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.expenses.title };

/** /expenses: the month's expenses; `?status=unpaid` opens the unpaid ones (ADR 0018). */
export default function ExpensesPage() {
  return (
    <Suspense>
      <ExpensesScreen />
    </Suspense>
  );
}
