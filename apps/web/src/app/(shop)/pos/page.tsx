import type { Metadata } from 'next';
import { PosScreen } from '@/features/pos';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.pos.title };

export default function PosPage() {
  return <PosScreen />;
}
