import type { Metadata } from 'next';
import { AuditScreen } from '@/features/audit';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.audit.title };

export default function AuditPage() {
  return <AuditScreen />;
}
