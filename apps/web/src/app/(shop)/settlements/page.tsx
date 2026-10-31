import type { Metadata } from 'next';
import { SettlementsScreen } from '@/features/settlements';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.settlements.title };

export default function SettlementsPage() {
  return <SettlementsScreen />;
}
