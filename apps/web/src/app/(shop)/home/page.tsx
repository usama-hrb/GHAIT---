import type { Metadata } from 'next';
import { HomeScreen } from '@/features/home';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.home.title };

export default function HomePage() {
  return <HomeScreen />;
}
