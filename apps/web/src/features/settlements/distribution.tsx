'use client';

import { CheckIcon, InfoIcon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';
import { messages } from '@/i18n';
import { Money } from '@/shared/format';
import { formatPermille } from '@/shared/lib/percent';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { type Allocation, type Distribution as DistributionFigures } from './settlement-facts';

const d = messages.settlements.distribution;

const roleOf = (kind: Allocation['kind']): string => d[kind];

/** The segments of the bar, one per owner or partner; the shop's is the capital colour. */
const SEGMENTS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const;

/**
 * Each share's part of the weights, as one bar. Only a picture of the rows below it (each carries
 * its own percentage), so it is hidden from assistive technology.
 */
function ShareBar({ allocations }: { allocations: readonly Allocation[] }) {
  const parts = allocations.filter((allocation) => allocation.weight > 0);
  if (parts.length < 2) return null;
  return (
    <div aria-hidden className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
      {parts.map((allocation, at) => (
        <span
          key={allocation.id}
          className={cn(
            'h-full min-w-1 rounded-full',
            allocation.kind === 'shop' ? 'bg-capital' : SEGMENTS[at % SEGMENTS.length],
          )}
          style={{ flexGrow: allocation.weight, flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

function AllocationRow({ allocation }: { allocation: Allocation }) {
  const { kind, participant } = allocation;
  return (
    <li className="grid gap-1 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            <span className="min-w-0 break-words">
              {kind === 'shop' ? d.shop : <bdi>{participant?.name ?? d.unknownPartner}</bdi>}
            </span>
            {kind !== 'shop' && <Badge variant="secondary">{roleOf(kind)}</Badge>}
            {kind === 'shop' && <Badge variant="outline">{d.shopHint}</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">
            <span data-num>{formatPermille(allocation.permille)}</span>
            {' · '}
            {d.weight(allocation.weight)}
          </p>
        </div>
        <span className="font-heading text-lg font-semibold">
          <Money cents={allocation.amountCents} tone={kind === 'shop' ? 'capital' : 'profit'} />
        </span>
      </div>
      {kind === 'shop' && allocation.capital.length > 0 && (
        <ul className="grid gap-0.5 ps-3 text-sm text-muted-foreground">
          {allocation.capital.map((move) => (
            <li key={move.partnerId} className="flex justify-between gap-2">
              <span className="min-w-0 break-words">
                {d.capitalTo}: <bdi>{move.participant?.name ?? d.unknownPartner}</bdi>
              </span>
              <Money cents={move.amountCents} tone="capital" />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Who receives the net profit: the owner's, the partner's and the shop's share, each with its
 * weight and percentage, then the shop's share by partner (capital). The amounts are the
 * settlement's own; this adds them up to show they equal the net profit. An allocation is not a
 * payment: nothing leaves the shop until a draw is recorded in Partners.
 */
export function Distribution({
  distribution,
  netProfitCents,
  carryDeficitOutCents,
  rule,
}: {
  distribution: DistributionFigures;
  netProfitCents: number;
  carryDeficitOutCents: number;
  /** Which rule these weights come from (a rule's date, or the weights a settlement kept). */
  rule: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid content-start gap-3">
      <div className="grid gap-0.5">
        <h3 id={id} className="font-heading text-lg font-semibold">
          {d.title}
        </h3>
        <p className="text-sm text-muted-foreground">{d.description}</p>
      </div>

      {distribution.distributes ? (
        <>
          <ul className="grid divide-y">
            {distribution.allocations.map((allocation) => (
              <AllocationRow key={allocation.id} allocation={allocation} />
            ))}
          </ul>
          <ShareBar allocations={distribution.allocations} />
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {distribution.reconciles && <CheckIcon className="size-4 text-success" aria-hidden />}
              {d.total}
            </span>
            <span className="font-heading text-lg font-semibold">
              <Money cents={netProfitCents} />
            </span>
          </div>
          {!distribution.reconciles && (
            <Alert variant="destructive">
              <AlertDescription>{d.mismatch}</AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">{d.oddCents}</p>
        </>
      ) : (
        <div className="grid gap-2 rounded-lg bg-muted/60 px-3 py-3">
          <p>{d.none}</p>
          {carryDeficitOutCents > 0 && (
            <p className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{d.deficitOut}</span>
              <Money cents={carryDeficitOutCents} tone="debt" />
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 border-t pt-3 text-sm">
        <p>
          <span className="font-medium">{d.ruleLabel}: </span>
          <span className="text-muted-foreground">{rule}</span>
        </p>
        <div className="flex gap-2 rounded-lg bg-muted/60 p-3">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">{d.allocationNote}</p>
        </div>
        <Button asChild variant="link" className="h-auto w-fit justify-start p-0">
          <Link href="/settings/partners">{d.manage}</Link>
        </Button>
      </div>
    </section>
  );
}
