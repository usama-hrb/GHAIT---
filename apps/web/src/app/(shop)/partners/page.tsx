import type { Metadata } from 'next';
import { PartnersScreen } from '@/features/partners';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.partners.title };

export default function PartnersPage() {
  return <PartnersScreen />;
}
