import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ZakatReportScreen } from '@/features/zakat';
import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.zakat.title };

/** /zakat/view?id=<uuid>: one cached page for every report (offline). */
export default function ZakatReportPage() {
  return (
    <Suspense>
      <ZakatReportScreen />
    </Suspense>
  );
}
