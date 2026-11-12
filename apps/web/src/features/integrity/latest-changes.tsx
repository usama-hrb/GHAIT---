'use client';

import { HistoryIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { type RecentEvent, useGuardedQuery, useRepositories } from '@/local-db';
import { EmptyState, ErrorState, LoadingState } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { amountOf, describeEvent } from './events';
import { LATEST_CHANGES_ID } from './integrity-status';

/** How many of the newest changes the screen lists; the audit log has the rest. */
const LATEST_COUNT = 12;

/**
 * The newest records on this device, the first place to look when the check does not balance.
 * Each says when it was recorded and which day it counts for (the two differ when an entry is made
 * late or for another day), what it is, and what it did to the shop's money. Where the record has
 * a page of its own, its name opens it. The full history, with who did what, is the audit log.
 */
export function LatestChangesView({
  events,
  fallback,
}: {
  /** Null while loading or when the changes could not be read; `fallback` is shown instead. */
  events: readonly RecentEvent[] | null;
  fallback?: ReactNode;
}) {
  const t = messages.integrity;
  return (
    <section id={LATEST_CHANGES_ID} aria-label={t.recentTitle} className="grid scroll-mt-20 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <h2 className="font-heading text-lg font-semibold">{t.recentTitle}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{t.recentDescription}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/audit">{t.viewAudit}</Link>
        </Button>
      </div>

      {events === null ? (
        fallback
      ) : events.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          titleAs="h3"
          title={t.noRecentTitle}
          description={t.noRecentDescription}
        />
      ) : (
        <>
          <div className="rounded-lg border bg-card">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.recordedAt}</TableHead>
                  <TableHead>{t.what}</TableHead>
                  <TableHead>{t.transactionDate}</TableHead>
                  <TableHead className="text-end">{t.amount}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const { label, hint } = describeEvent(event);
                  const amount = amountOf(event);
                  return (
                    <TableRow key={`${event.entity}-${event.id}`}>
                      <TableCell className="whitespace-normal" label={t.recordedAt}>
                        <DateText value={event.at} format="dateTime" />
                      </TableCell>
                      <TableCell className="whitespace-normal" label={t.what}>
                        <div className="grid gap-0.5">
                          <span className="font-medium">
                            {event.href ? (
                              <Link
                                href={event.href}
                                className="inline-flex min-h-6 min-w-6 items-center text-primary underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                              >
                                {label}
                              </Link>
                            ) : (
                              label
                            )}
                            {event.voided && (
                              <Badge variant="outline" className="ms-2">
                                {t.voided}
                              </Badge>
                            )}
                          </span>
                          {hint !== null && (
                            <span className="text-sm font-normal text-muted-foreground">
                              {hint}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal" label={t.transactionDate}>
                        <DateText value={event.date} />
                      </TableCell>
                      <TableCell className="text-end" label={t.amount}>
                        {amount === null ? (
                          '—'
                        ) : (
                          <span
                            className={
                              event.voided ? 'text-muted-foreground line-through' : undefined
                            }
                          >
                            <Money cents={amount.cents} />
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">{t.datesHelp}</p>
        </>
      )}
    </section>
  );
}

/** The latest changes on this device; it says so when they cannot be read, and the page lives on. */
export function LatestChanges() {
  const repositories = useRepositories();
  const { result, retry } = useGuardedQuery(
    () => repositories.integrity.recent(LATEST_COUNT),
    [repositories],
  );
  return (
    <LatestChangesView
      events={result?.ok ? result.value : null}
      fallback={
        result === undefined ? (
          <LoadingState rows={3} />
        ) : (
          <ErrorState titleAs="h3" onRetry={retry} />
        )
      }
    />
  );
}
