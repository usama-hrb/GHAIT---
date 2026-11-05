import type { Metadata } from 'next';
import { SyncSettingsScreen } from '@/features/sync';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settings.sections.sync.title };

export default function SyncSettingsPage() {
  return <SyncSettingsScreen />;
}
