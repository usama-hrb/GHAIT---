'use client';

import { periodLockIssues } from '@fabric/contracts';
import { LockIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { DateAr } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';

const t = messages.periodLock;

/** The last settled day on this device (null: nothing settled; undefined while loading). */
export function useLockedThrough(): string | null | undefined {
  const repositories = useRepositories();
  return useLiveQuery(() => repositories.settlements.lockedThrough(), [repositories]);
}

/** A record accounted on `date` is inside a settled period (BUILD_PROMPTS 4.3). */
export function isLockedOn(
  date: string | null | undefined,
  lockedThrough: string | null | undefined,
): boolean {
  return (
    date !== undefined &&
    lockedThrough !== undefined &&
    periodLockIssues([date], lockedThrough).length > 0
  );
}

/**
 * Why a record cannot be added or changed (SPEC §8.3): its date is in a settled period. Says
 * until when, and where to unlock it. Nothing when the date is open.
 */
export function PeriodLockHint({
  date,
  lockedThrough,
}: {
  date: string | null | undefined;
  lockedThrough: string | null | undefined;
}) {
  if (!isLockedOn(date, lockedThrough) || !lockedThrough) return null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground" role="note">
      <LockIcon aria-hidden className="size-3.5" />
      {t.settledThrough} <DateAr value={lockedThrough} />.{' '}
      <Link href="/settlements" className="text-primary underline-offset-4 hover:underline">
        {t.unlockThere}
      </Link>
    </p>
  );
}

/** In a list: this record is in a settled period, so its actions are gone (and why). */
export function LockedBadge({ lockedThrough }: { lockedThrough: string | null | undefined }) {
  return (
    <Badge variant="outline" title={t.why}>
      <LockIcon aria-hidden />
      {t.locked}
      <span className="sr-only">
        {': '}
        {t.why} {lockedThrough}
      </span>
    </Badge>
  );
}
