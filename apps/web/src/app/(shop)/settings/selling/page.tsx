import type { Metadata } from 'next';
import { SellingPreferencesScreen } from '@/features/settings';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settings.sections.selling.title };

export default function SellingSettingsPage() {
  return <SellingPreferencesScreen />;
}
