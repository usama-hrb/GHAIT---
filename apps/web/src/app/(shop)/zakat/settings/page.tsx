import type { Metadata } from 'next';
import { ZakatSettingsScreen } from '@/features/zakat';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.zakat.title };

/** /zakat/settings: the zakat methodology, apart from the overview. */
export default function ZakatSettingsPage() {
  return <ZakatSettingsScreen />;
}
