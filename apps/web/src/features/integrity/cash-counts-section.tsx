'use client';

import { isLockedOn, LockedBadge, useLockedThrough } from '@/features/settlements';
import { CoinsIcon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useGuardedQuery, useRepositories } from '@/local-db';
import { EmptyState, ErrorState, LoadingState, VoidDialog } from '@/shared/brand';
import { DateText, formatDate, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { CashCountDialog } from './cash-count-dialog';

/** What the history shows of a count. A voided count stays in it, marked, never removed. */
export interface CountRow {
  id: string;
  /** The day the count is accounted on. */
  date: string;
  /** What the records said the money was when it was counted. */
  expectedCents: number;
  /** What was really there. */
  countedCents: number;
  /** counted − recorded: a surplus when positive, a shortage when negative. */
  diffCents: number;
  note: string | null;
  voidedAt: string | null;
}

export interface CashCountsData {
  /** The shop's money according to the records now: what the next count is compared with. */
  expectedCents: number;
  /** Of that, what customers paid by bank transfer (a count takes the bank account too). */
  bankCents: number;
  /** Newest first. */
  counts: readonly CountRow[];
}

/** A count's result in words and money: matches, a surplus, or a shortage. */
function Outcome({ diffCents }: { diffCents: number }) {
  const t = messages.integrity;
  if (diffCents === 0) return <>{t.matches}</>;
  return (
    <>
      {diffCents > 0 ? t.over : t.short}{' '}
      <Money cents={Math.abs(diffCents)} tone={diffCents < 0 ? 'loss' : 'profit'} />
    </>
  );
}

function Figure({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="grid content-start gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-heading text-lg font-semibold">{children}</dd>
      {note !== undefined && <dd className="text-sm text-muted-foreground">{note}</dd>}
    </div>
  );
}

/**
 * The cash counts (SPEC §9): the money the records say the shop has, the last count of what is
 * really there, and the history of every count with what the records said, what was counted and
 * the difference. A count is never edited; one made by mistake is voided with a reason and stays
 * in the history. The person who made it is in the audit log, not on the count.
 *
 * The button that starts a count is in the header, except while there is no count yet: then the
 * empty state carries it, so the screen never offers two of the same action.
 */
export function CashCountsView({
  data,
  fallback,
  lockedThrough,
  canCount,
  onCount,
  onVoid,
}: {
  /** Null while the counts are loading or could not be read; `fallback` is shown instead. */
  data: CashCountsData | null;
  fallback?: ReactNode;
  lockedThrough: string | null | undefined;
  /** False until this device has the shop's records: a count would be set against nothing. */
  canCount: boolean;
  onCount: () => void;
  onVoid: (id: string) => void;
}) {
  const t = messages.integrity;
  const last = data?.counts.find((count) => count.voidedAt === null);
  const countButton = (
    <Button variant="accent" disabled={!canCount || data === null} onClick={onCount}>
      {t.count}
    </Button>
  );
  const noCounts = data !== null && data.counts.length === 0;

  return (
    <section aria-label={t.countsTitle} className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <h2 className="font-heading text-lg font-semibold">{t.countsTitle}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{t.countsDescription}</p>
        </div>
        {!noCounts && countButton}
      </div>

      {data === null ? (
        fallback
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-3">
              <dl className="grid gap-2 @xl:grid-cols-3">
                <Figure
                  label={t.expected}
                  note={
                    <>
                      {t.bank} <Money cents={data.bankCents} />
                    </>
                  }
                >
                  <Money cents={data.expectedCents} />
                </Figure>
                <Figure label={t.lastCount}>
                  {last === undefined ? (
                    <span className="text-base font-normal text-muted-foreground">
                      {t.noCountYet}
                    </span>
                  ) : (
                    <>
                      <Money cents={last.countedCents} />
                      <span className="block text-sm font-normal text-muted-foreground">
                        <DateText value={last.date} />
                      </span>
                    </>
                  )}
                </Figure>
                <Figure label={t.difference}>
                  {last === undefined ? (
                    <span className="text-base font-normal text-muted-foreground">—</span>
                  ) : (
                    <Outcome diffCents={last.diffCents} />
                  )}
                </Figure>
              </dl>
              <p className="text-sm text-muted-foreground">{t.countHint}</p>
              {!canCount && <p className="text-sm font-medium">{t.countWaiting}</p>}
            </CardContent>
          </Card>

          {noCounts ? (
            <EmptyState
              icon={CoinsIcon}
              titleAs="h3"
              title={t.noCountsTitle}
              description={t.noCountsDescription}
              action={countButton}
            />
          ) : (
            <div className="rounded-lg border bg-card">
              <Table stack>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.date}</TableHead>
                    <TableHead className="text-end">{t.recordsSaid}</TableHead>
                    <TableHead className="text-end">{t.countedColumn}</TableHead>
                    <TableHead className="text-end">{t.difference}</TableHead>
                    <TableHead>{t.reason}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t.voidAction}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.counts.map((count) => (
                    <TableRow
                      key={count.id}
                      className={count.voidedAt ? 'text-muted-foreground' : undefined}
                    >
                      <TableCell label={t.date}>
                        <DateText value={count.date} />
                      </TableCell>
                      <TableCell
                        className={count.voidedAt ? 'text-end line-through' : 'text-end'}
                        label={t.recordsSaid}
                      >
                        <Money cents={count.expectedCents} />
                      </TableCell>
                      <TableCell
                        className={count.voidedAt ? 'text-end line-through' : 'text-end'}
                        label={t.countedColumn}
                      >
                        <Money cents={count.countedCents} />
                      </TableCell>
                      <TableCell className="text-end" label={t.difference}>
                        <span className={count.voidedAt ? 'line-through' : undefined}>
                          <Outcome diffCents={count.diffCents} />
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal" label={t.reason}>
                        {count.note}
                      </TableCell>
                      <TableCell className="text-end">
                        {count.voidedAt !== null ? (
                          <Badge variant="outline">{t.voided}</Badge>
                        ) : isLockedOn(count.date, lockedThrough) ? (
                          <LockedBadge lockedThrough={lockedThrough} />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t.voidAction} ${formatDate(count.date)}`}
                            onClick={() => {
                              onVoid(count.id);
                            }}
                          >
                            {t.voidAction}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {t.countedBy}{' '}
            <Link
              href="/audit"
              className="inline-flex min-h-6 items-center text-primary underline underline-offset-4 pointer-coarse:min-h-11"
            >
              {t.viewAudit}
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The cash counts on this device, with the dialogs that make and void one. It reads its own data,
 * and says so when it cannot instead of taking the page down with it.
 */
export function CashCountsSection({ canCount }: { canCount: boolean }) {
  const t = messages.integrity;
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const [counting, setCounting] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const { result, retry } = useGuardedQuery(async () => {
    const [expectedCents, bankCents, counts] = await Promise.all([
      repositories.integrity.expectedCashCents(),
      repositories.integrity.bankPaymentsCents(),
      repositories.integrity.countHistory(),
    ]);
    return { expectedCents, bankCents, counts } satisfies CashCountsData;
  }, [repositories]);

  const data = result?.ok ? result.value : null;
  return (
    <>
      <CashCountsView
        data={data}
        fallback={
          result === undefined ? (
            <LoadingState rows={2} />
          ) : (
            <ErrorState titleAs="h3" onRetry={retry} />
          )
        }
        lockedThrough={lockedThrough}
        canCount={canCount}
        onCount={() => {
          setCounting(true);
        }}
        onVoid={setVoiding}
      />
      <CashCountDialog
        key={counting ? 'open' : 'closed'}
        open={counting}
        onOpenChange={setCounting}
      />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={t.voidTitle}
        description={t.voidDescription}
        onConfirm={async (reason) => {
          if (voiding) await repositories.integrity.voidCount(voiding, reason);
          setVoiding(null);
          toast.success(t.voidedDone, { description: messages.forms.saved });
        }}
      />
    </>
  );
}
