import type { Metadata } from 'next';
import { ZakatScreen } from '@/features/zakat';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.zakat.title };

export default function ZakatPage() {
  return <ZakatScreen />;
}
