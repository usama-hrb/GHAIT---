import type { Metadata } from 'next';
import { IntegrityScreen } from '@/features/integrity';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.integrity.title };

export default function IntegrityPage() {
  return <IntegrityScreen />;
}
