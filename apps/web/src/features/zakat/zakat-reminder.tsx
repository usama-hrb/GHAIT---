'use client';

import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { DateText } from '@/shared/format';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';

const t = messages.zakat;

/** SPEC §10 "تذكير قبل الحول بأسبوعين": on the home screen, before the hawl and until its report. */
export function ZakatReminder() {
  const repositories = useRepositories();
  const reminder = useLiveQuery(() => repositories.zakat.reminder(), [repositories]);
  if (!reminder) return null;
  return (
    <Alert role="region" aria-label={t.reminderTitle}>
      <AlertTitle>{t.reminderTitle}</AlertTitle>
      <AlertDescription>
        {reminder.kind === 'upcoming' ? t.reminderUpcoming(reminder.days) : t.reminderDue} (
        <DateText value={reminder.hawlDate} format="hijri" />
        ).{' '}
        <Link href="/zakat" className="text-primary underline-offset-4 hover:underline">
          {t.reminderLink}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
