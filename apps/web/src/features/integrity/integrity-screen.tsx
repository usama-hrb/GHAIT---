'use client';

import { isLockedOn, LockedBadge, useLockedThrough } from '@/features/settlements';
import { CheckCircle2Icon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { CashCountDialog } from './cash-count-dialog';

const t = messages.integrity;
const entityName = (entity: string) => messages.settings.entities[entity] ?? entity;

/**
 * The integrity check and cash counts (SPEC §9, §14.11, BUILD_PROMPTS 4.4): what the shop holds
 * against whose it is, to the cent, from this device's records (offline too); the latest changes
 * that may explain a difference; and the counts of the shop's money.
 */
export function IntegrityScreen() {
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const [counting, setCounting] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const [report, recent, expected, bank, counts] = await Promise.all([
      repositories.integrity.report(),
      repositories.integrity.recent(),
      repositories.integrity.expectedCashCents(),
      repositories.integrity.bankPaymentsCents(),
      repositories.integrity.countHistory(),
    ]);
    return { report, recent, expected, bank, counts };
  }, [repositories]);

  if (data === undefined) return <LoadingState />;
  const { report } = data;
  const side = (which: 'holdings' | 'claims') =>
    report.breakdown.filter((line) => line.side === which);

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <OfflineNotice />
      <h2 className="font-heading text-xl font-semibold">{t.title}</h2>

      {report.ok ? (
        <Alert>
          <CheckCircle2Icon aria-hidden />
          <AlertTitle>{t.okTitle}</AlertTitle>
          <AlertDescription>{t.okDescription}</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>
            {t.diffTitle} <Money cents={report.diffCents} />
          </AlertTitle>
          <AlertDescription>{t.diffDescription}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ['holdings', t.holdings, report.holdingsCents],
            ['claims', t.claims, report.claimsCents],
          ] as const
        ).map(([which, title, total]) => (
          <section
            key={which}
            aria-label={title}
            className="grid content-start gap-2 rounded-xl border bg-card p-4"
          >
            <h3 className="font-heading font-semibold">{title}</h3>
            <dl className="grid gap-1">
              {side(which).map((line) => (
                <div key={line.key} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t.lines[line.key]}</dt>
                  <dd>
                    <Money cents={line.cents} />
                  </dd>
                </div>
              ))}
              <div className="mt-1 flex justify-between gap-2 border-t pt-2 font-semibold">
                <dt>{t.total}</dt>
                <dd>
                  <Money cents={total} />
                </dd>
              </div>
            </dl>
          </section>
        ))}
      </div>

      <section aria-label={t.countsTitle} className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading font-semibold">{t.countsTitle}</h3>
          <Button
            variant="accent"
            onClick={() => {
              setCounting(true);
            }}
          >
            {t.count}
          </Button>
        </div>
        <dl className="grid gap-1 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:gap-x-6">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.expected}</dt>
            <dd className="font-semibold">
              <Money cents={data.expected} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.bank}</dt>
            <dd>
              <Money cents={data.bank} />
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">{t.countHint}</p>
        {data.counts.length === 0 ? (
          <p className="text-muted-foreground">{t.noCounts}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.date}</TableHead>
                  <TableHead className="text-end">{t.countedLabel}</TableHead>
                  <TableHead className="text-end">{t.difference}</TableHead>
                  <TableHead className="max-sm:hidden">{t.reason}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.voidAction}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.counts.map((count) => (
                  <TableRow
                    key={count.id}
                    className={count.voidedAt ? 'text-muted-foreground line-through' : undefined}
                  >
                    <TableCell>
                      <DateText value={count.date} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={count.countedCents} />
                    </TableCell>
                    <TableCell className="text-end">
                      {count.diffCents === 0 ? (
                        t.matches
                      ) : (
                        <>
                          {count.diffCents > 0 ? t.over : t.short}{' '}
                          <Money
                            cents={Math.abs(count.diffCents)}
                            tone={count.diffCents < 0 ? 'loss' : 'profit'}
                          />
                        </>
                      )}
                    </TableCell>
                    <TableCell className="max-sm:hidden">{count.note}</TableCell>
                    <TableCell className="text-end">
                      {count.voidedAt === null &&
                        (isLockedOn(count.date, lockedThrough) ? (
                          <LockedBadge lockedThrough={lockedThrough} />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setVoiding(count.id);
                            }}
                          >
                            {t.voidAction}
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-label={t.recentTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.recentTitle}</h3>
        <p className="text-sm text-muted-foreground">{t.recentDescription}</p>
        {data.recent.length === 0 ? (
          <p className="text-muted-foreground">{t.noRecent}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.when}</TableHead>
                  <TableHead>{t.what}</TableHead>
                  <TableHead className="max-sm:hidden">{t.date}</TableHead>
                  <TableHead className="text-end">{t.amount}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((event) => (
                  <TableRow key={`${event.entity}-${event.id}`}>
                    <TableCell>
                      <DateText value={event.at} format="dateTime" />
                    </TableCell>
                    <TableCell>
                      {event.href ? (
                        <Link
                          href={event.href}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {entityName(event.entity)}
                        </Link>
                      ) : (
                        entityName(event.entity)
                      )}
                      {event.voided && (
                        <Badge variant="outline" className="ms-2">
                          {t.voided}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      <DateText value={event.date} />
                    </TableCell>
                    <TableCell className="text-end">
                      {event.amountCents === null ? '—' : <Money cents={event.amountCents} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

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
    </div>
  );
}
