import type { Metadata } from 'next';
import { PayablesScreen } from '@/features/payables';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.payables.title };

export default function PayablesPage() {
  return <PayablesScreen />;
}
