import type { Metadata } from 'next';
import { RegionalScreen } from '@/features/settings';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settings.sections.regional.title };

export default function RegionalSettingsPage() {
  return <RegionalScreen />;
}
