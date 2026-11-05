import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmployeeDetailScreen } from '@/features/partners';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.partners.employees.detail.title };

/** /settings/partners/employee?id=<uuid>: one cached page for every employee (offline). */
export default function EmployeePage() {
  return (
    <Suspense>
      <EmployeeDetailScreen />
    </Suspense>
  );
}
