'use client';

import { HistoryIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import type { SettlementHistoryRow } from '@/local-db';
import { EmptyState } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { useAppNavigation } from '@/shared/lib/navigation';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { periodLabel } from './period-label';

const t = messages.settlements;

/** The table needs room for its columns; below this the settlements are cards. */
const WIDE = '(min-width: 1024px)';

const hrefOf = (settlement: SettlementHistoryRow) => `/settlements/view?id=${settlement.id}`;

function StatusBadge({ settlement }: { settlement: SettlementHistoryRow }) {
  return settlement.voidedAt ? (
    <Badge variant="outline">{t.status.unlocked}</Badge>
  ) : (
    <Badge variant="secondary">{t.status.settled}</Badge>
  );
}

/** The net profit: a deficit says so in words as well as in its sign. */
function Net({ settlement }: { settlement: SettlementHistoryRow }) {
  return (
    <Money
      cents={settlement.netProfitCents}
      tone={
        settlement.netProfitCents < 0
          ? 'loss'
          : settlement.netProfitCents > 0
            ? 'profit'
            : undefined
      }
    />
  );
}

/** A share, or a dash for a period that shared nothing. */
function Share({ cents }: { cents: number }) {
  return cents === 0 ? <span className="text-muted-foreground">—</span> : <Money cents={cents} />;
}

/**
 * What each partner was allocated, name beside amount. A period that shared nothing shows a dash;
 * one whose shares have not reached this device yet shows the partners' total.
 */
function PartnerShares({ settlement }: { settlement: SettlementHistoryRow }) {
  if (settlement.partnerShares.length === 0) return <Share cents={settlement.partnerShareCents} />;
  return (
    <ul className="grid gap-0.5">
      {settlement.partnerShares.map((share) => (
        <li key={share.partnerId} className="flex items-baseline justify-end gap-2">
          <span className="max-w-32 truncate text-xs text-muted-foreground">
            <bdi>{share.name ?? t.distribution.unknownPartner}</bdi>
          </span>
          <Money cents={share.amountCents} />
        </li>
      ))}
    </ul>
  );
}

function HistoryTable({ rows }: { rows: readonly SettlementHistoryRow[] }) {
  const navigation = useAppNavigation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.columns.period}</TableHead>
          <TableHead className="text-end">{t.columns.net}</TableHead>
          <TableHead className="text-end">{t.columns.owner}</TableHead>
          <TableHead className="text-end">{t.columns.partners}</TableHead>
          <TableHead className="text-end">{t.columns.shop}</TableHead>
          <TableHead className="max-xl:hidden">{t.columns.settledOn}</TableHead>
          <TableHead>{t.columns.status}</TableHead>
          <TableHead className="w-24">
            <span className="sr-only">{t.view}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((settlement) => {
          const label = periodLabel(settlement.periodStart, settlement.periodEnd);
          return (
            <TableRow
              key={settlement.id}
              className={cn('h-14 cursor-pointer', settlement.voidedAt && 'text-muted-foreground')}
              onClick={() => {
                navigation.push(hrefOf(settlement));
              }}
            >
              <TableCell>
                <Link
                  href={hrefOf(settlement)}
                  aria-label={t.open(label)}
                  className="font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {label}
                </Link>
              </TableCell>
              <TableCell className="text-end">
                <Net settlement={settlement} />
              </TableCell>
              <TableCell className="text-end">
                <Share cents={settlement.ownerShareCents} />
              </TableCell>
              <TableCell className="text-end">
                <PartnerShares settlement={settlement} />
              </TableCell>
              <TableCell className="text-end">
                <Share cents={settlement.shopShareCents} />
              </TableCell>
              <TableCell className="max-xl:hidden">
                <DateText value={settlement.lockedAt} />
              </TableCell>
              <TableCell>
                <StatusBadge settlement={settlement} />
              </TableCell>
              <TableCell className="text-end">
                <Button asChild size="sm" variant="ghost">
                  <Link
                    href={hrefOf(settlement)}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    {t.view}
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function HistoryCards({ rows }: { rows: readonly SettlementHistoryRow[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-2 p-2">
      {rows.map((settlement) => {
        const label = periodLabel(settlement.periodStart, settlement.periodEnd);
        return (
          <li key={settlement.id}>
            <Link
              href={hrefOf(settlement)}
              aria-label={t.open(label)}
              className={cn(
                'grid min-h-14 gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                settlement.voidedAt && 'text-muted-foreground',
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium">{label}</span>
                  <span className="text-sm text-muted-foreground">
                    {t.columns.settledOn} <DateText value={settlement.lockedAt} />
                  </span>
                </span>
                <StatusBadge settlement={settlement} />
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t.columns.net}</span>
                <span className="font-heading text-lg font-semibold">
                  <Net settlement={settlement} />
                </span>
              </span>
              <span className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 text-sm">
                <span className="grid content-start">
                  <span className="text-xs text-muted-foreground">{t.columns.owner}</span>
                  <Share cents={settlement.ownerShareCents} />
                </span>
                {settlement.partnerShares.length === 0 ? (
                  <span className="grid content-start">
                    <span className="text-xs text-muted-foreground">{t.columns.partners}</span>
                    <Share cents={settlement.partnerShareCents} />
                  </span>
                ) : (
                  settlement.partnerShares.map((share) => (
                    <span key={share.partnerId} className="grid content-start">
                      <span className="truncate text-xs text-muted-foreground">
                        <bdi>{share.name ?? t.distribution.unknownPartner}</bdi>
                      </span>
                      <Money cents={share.amountCents} />
                    </span>
                  ))
                )}
                <span className="grid content-start">
                  <span className="text-xs text-muted-foreground">{t.columns.shop}</span>
                  <Share cents={settlement.shopShareCents} />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Every settlement, the latest period first: its figures as approved (they never move), who got
 * what, when it was locked and whether it still is. A row opens the settlement's details. A
 * table on a wide screen, cards below.
 */
export function SettlementHistory({ rows }: { rows: readonly SettlementHistoryRow[] }) {
  const wide = useMediaQuery(WIDE);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title={t.historyEmptyTitle}
        description={t.historyEmptyDescription}
        titleAs="p"
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {wide ? <HistoryTable rows={rows} /> : <HistoryCards rows={rows} />}
    </div>
  );
}
