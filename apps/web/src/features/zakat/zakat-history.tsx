import { zakatPaymentStateOf } from '@fabric/contracts';
import { FileTextIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import type { ZakatHistoryRow } from '@/local-db';
import { EmptyState } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { ZAKAT_HISTORY_ID } from './status-card';
import { DualDate, PaymentStateBadge } from './zakat-ui';

const t = messages.zakat;

/**
 * Every saved zakat report, the latest hawl first: the hawl, when it was calculated, the base, the
 * nisab it was measured against, what was due, what was paid and what is left, and where it
 * stands. A saved report is shown as it was saved and never worked out again; a voided one stays,
 * struck through, so the history is whole.
 */
export function ZakatHistory({ rows }: { rows: readonly ZakatHistoryRow[] }) {
  const columns = t.history.columns;
  return (
    <section
      id={ZAKAT_HISTORY_ID}
      aria-labelledby={`${ZAKAT_HISTORY_ID}-title`}
      className="grid scroll-mt-20 gap-3"
    >
      <div className="grid gap-1">
        <h2 id={`${ZAKAT_HISTORY_ID}-title`} className="font-heading text-lg font-semibold">
          {t.history.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.history.description}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title={t.history.emptyTitle}
          description={t.history.emptyDescription}
          titleAs="h3"
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>{columns.hawl}</TableHead>
                <TableHead className="text-end">{columns.base}</TableHead>
                <TableHead className="text-end">{columns.due}</TableHead>
                <TableHead className="text-end">{columns.paid}</TableHead>
                <TableHead>{columns.status}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.history.details}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((report) => {
                const voided = report.voidedAt !== null;
                const payment = zakatPaymentStateOf({
                  dueCents: report.zakatDueCents,
                  paidCents: report.paidCents,
                  voided,
                });
                return (
                  <TableRow key={report.id} className={cn(voided && 'text-muted-foreground')}>
                    <TableCell className="whitespace-normal">
                      <DualDate value={report.hawlDate} className={cn(voided && 'line-through')} />
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {t.history.calculated} <DateText value={report.createdAt} />
                      </span>
                    </TableCell>
                    <TableCell className="text-end" label={columns.base}>
                      <Money cents={report.baseCents} />
                      <span className="block text-xs whitespace-normal text-muted-foreground">
                        {columns.nisab}: <Money cents={report.nisabCents} />
                      </span>
                    </TableCell>
                    <TableCell className="text-end" label={columns.due}>
                      <Money cents={report.zakatDueCents} />
                    </TableCell>
                    <TableCell className="text-end" label={columns.paid}>
                      <Money cents={payment.paidCents} />
                      <span className="block text-xs whitespace-normal text-muted-foreground">
                        {columns.remaining}: <Money cents={payment.remainingCents} />
                      </span>
                    </TableCell>
                    <TableCell label={columns.status}>
                      <PaymentStateBadge state={payment.state} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Button asChild size="sm" variant="link" className="px-1">
                        <Link href={`/zakat/view?id=${report.id}`}>{t.history.details}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
