import type { Metadata } from 'next';
import { designMessages as t } from '@/i18n/ar.design';
import { Gallery } from './_gallery/gallery';

export const metadata: Metadata = {
  title: t.title,
  robots: { index: false, follow: false },
};

/** Dev-only (page.dev.tsx): see next.config.ts pageExtensions. */
export default function DesignPage() {
  return <Gallery />;
}
