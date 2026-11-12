import type { Metadata } from 'next';
import { messages } from '@/i18n';
import { NotFoundScreen } from '@/shared/brand';

export const metadata: Metadata = { title: messages.notFound.title };

/** Next shows this, with status 404, for an address that matches no route. */
export default function NotFound() {
  return <NotFoundScreen />;
}
