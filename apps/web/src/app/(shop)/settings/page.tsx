import type { Metadata } from 'next';
import { SettingsScreen } from '@/features/settings';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settings.title };

export default function SettingsPage() {
  return <SettingsScreen />;
}
