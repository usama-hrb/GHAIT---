'use client';

import type { SettlementLine } from '@fabric/contracts';
import { InfoIcon } from 'lucide-react';
import { useId } from 'react';
import { messages } from '@/i18n';
import { Money, type MoneyTone } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { type BreakdownGroup, groupedBreakdown } from './settlement-facts';

const t = messages.settlements;
const b = messages.settlements.breakdown;

/** A figure is red only when it takes from the profit; the sign and the label say the same. */
function toneOf(cents: number): MoneyTone | undefined {
  return cents < 0 ? 'loss' : undefined;
}

/** What a line means, one tap away: accounting words are explained where they are used. */
function LineHelp({ lineKey, label }: { lineKey: SettlementLine['key']; label: string }) {
  const help = t.lineHelp[lineKey];
  if (!help) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={b.explain(label)}
        >
          <InfoIcon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)]">
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">{help}</p>
      </PopoverContent>
    </Popover>
  );
}

function Line({ line }: { line: SettlementLine }) {
  const label = t.lines[line.key];
  return (
    <div className="flex min-h-9 items-center justify-between gap-2">
      <dt
        className={cn(
          'flex min-w-0 items-center gap-0.5',
          line.cents === 0 && 'text-muted-foreground',
        )}
      >
        <span className="min-w-0">{label}</span>
        <LineHelp lineKey={line.key} label={label} />
      </dt>
      <dd className={cn(line.cents === 0 && 'text-muted-foreground')}>
        <Money cents={line.cents} tone={toneOf(line.cents)} />
      </dd>
    </div>
  );
}

function Adjustment({ group }: { group: BreakdownGroup }) {
  return (
    <div className="grid gap-0.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <h5 className="text-xs font-medium tracking-wide text-muted-foreground">
          {b.groups[group.key]}
        </h5>
        <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
          {b.subtotal}
          <Money cents={group.subtotalCents} tone={toneOf(group.subtotalCents)} />
        </span>
      </div>
      <dl className="grid">
        {group.lines.map((line) => (
          <Line key={line.key} line={line} />
        ))}
      </dl>
    </div>
  );
}

/**
 * How the net profit is made (SPEC §8.1): the recognized profit, the adjustments by kind, the
 * result. The lines are the settlement's own, signed as computeSettlement gives them (a deduction
 * is negative), so what is shown adds up to the net profit; a line at zero stays, because
 * reconciling needs it. Grouping is presentation only.
 */
export function Breakdown({ lines }: { lines: readonly SettlementLine[] }) {
  const id = useId();
  const grouped = groupedBreakdown(lines);
  const [profit, ...adjustments] = grouped.groups;
  const net = grouped.netProfitCents;
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="grid gap-0.5">
        <h3 id={id} className="font-heading text-lg font-semibold">
          {b.title}
        </h3>
        <p className="text-sm text-muted-foreground">{b.description}</p>
      </div>

      <div className="grid divide-y">
        {profit && (
          <div className="grid gap-0.5 pb-2">
            <h4 className="text-sm font-semibold">{b.profit}</h4>
            <dl>
              {profit.lines.map((line) => (
                <Line key={line.key} line={line} />
              ))}
            </dl>
          </div>
        )}

        <div className="grid divide-y-0 py-2">
          <h4 className="text-sm font-semibold">{b.adjustments}</h4>
          <div className="grid divide-y">
            {adjustments.map((group) => (
              <Adjustment key={group.key} group={group} />
            ))}
          </div>
        </div>

        <div className="grid gap-0.5 pt-3">
          <h4 className="text-sm font-semibold">{b.result}</h4>
          <div className="flex flex-wrap items-center justify-between gap-x-3 rounded-lg bg-muted/60 px-3 py-3">
            <span className="flex items-center gap-0.5 font-heading text-lg font-semibold">
              {t.lines.net_profit}
              <LineHelp lineKey="net_profit" label={t.lines.net_profit} />
            </span>
            <span className="font-heading text-2xl font-semibold">
              <Money cents={net} tone={net < 0 ? 'loss' : 'profit'} />
            </span>
          </div>
        </div>
      </div>

      {!grouped.reconciles && (
        <Alert variant="destructive">
          <AlertDescription>{b.mismatch}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
