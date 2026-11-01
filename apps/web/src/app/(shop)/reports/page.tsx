import type { Metadata } from 'next';
import { ReportsScreen } from '@/features/reports';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.reports.title };

export default function ReportsPage() {
  return <ReportsScreen />;
}
