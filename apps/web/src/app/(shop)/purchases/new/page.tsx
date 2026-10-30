import type { Metadata } from 'next';
import { NewPurchaseScreen } from '@/features/purchasing';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.purchasing.newPurchase };

export default function NewPurchasePage() {
  return <NewPurchaseScreen />;
}
