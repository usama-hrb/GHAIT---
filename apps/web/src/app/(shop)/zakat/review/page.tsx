import type { Metadata } from 'next';
import { ZakatReviewScreen } from '@/features/zakat';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.zakat.title };

/** /zakat/review: the guided review of the zakat calculation. It records nothing until it ends. */
export default function ZakatReviewPage() {
  return <ZakatReviewScreen />;
}
