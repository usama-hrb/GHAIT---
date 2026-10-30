import type { Metadata } from 'next';
import { SyncIssuesScreen } from '@/features/sync';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.syncIssues.title };

export default function SyncIssuesPage() {
  return <SyncIssuesScreen />;
}
