import type { Metadata } from 'next';
import { BusinessProfileScreen } from '@/features/settings';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settings.sections.profile.title };

export default function SettingsPage() {
  return <BusinessProfileScreen />;
}
