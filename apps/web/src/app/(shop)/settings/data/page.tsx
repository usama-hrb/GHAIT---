import type { Metadata } from 'next';
import { DataScreen } from '@/features/settings';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settings.sections.data.title };

export default function DataSettingsPage() {
  return <DataScreen />;
}
