'use client';

import { RulerIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { messages } from '@/i18n';
import { useCanSeeCosts, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText, Meters, Money } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { EstimatedBadge, ReviewBadge, RollStateBadge } from './roll-badges';
import { type StockAction, StockMoveDialog } from './stock-move-dialog';

const t = messages.inventory;

/** A signed length: "+0.5 م" / "-0.3 م" (the minus is part of the number). */
function SignedMeters({ cm }: { cm: number }) {
  return (
    <span className="whitespace-nowrap">
      {cm > 0 && <bdi>+</bdi>}
      <Meters cm={cm} />
    </span>
  );
}

/** One roll (/inventory/roll?id=…): its state, costs, history, and the stock actions. */
export function RollScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  // A cashier sees the length left, never what the roll cost (SPEC §11); the stock actions are the owner's.
  const seesCosts = useCanSeeCosts();
  const view = useLiveQuery(
    async () => (await repositories.inventory.roll(id)) ?? null,
    [repositories, id],
  );
  const [action, setAction] = useState<StockAction | null>(null);

  if (view === undefined) return <LoadingState />;
  if (view === null) {
    return (
      <EmptyState
        title={t.rollNotFound}
        action={
          <Button asChild variant="outline">
            <Link href="/inventory">{t.backToInventory}</Link>
          </Button>
        }
      />
    );
  }
  const { roll, variant, fabric, purchase, moves, ledger, state } = view;
  const costOf = new Map(ledger.costs.map((entry) => [entry.id, entry.costCents]));
  const field = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href={`/inventory/color?id=${roll.variantId}`}>
          {fabric?.name} · {variant?.colorName}
        </Link>
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">
          <bdi dir="ltr" data-num>
            {roll.shortCode}
          </bdi>
        </h2>
        <RollStateBadge state={state} />
        {ledger.lengthEstimated && <EstimatedBadge />}
        {(ledger.remainingCm < 0 || ledger.oversoldCm > 0) && <ReviewBadge />}
      </div>

      {ledger.lengthEstimated && (
        <Alert>
          <RulerIcon aria-hidden />
          <AlertDescription>{t.estimatedHint}</AlertDescription>
        </Alert>
      )}
      {ledger.oversoldCm > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription>{t.oversold}</AlertDescription>
        </Alert>
      )}

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 sm:grid-cols-2">
        {field(
          t.rollFields.remaining,
          <Meters cm={ledger.remainingCm} className="font-semibold" />,
        )}
        {field(t.rollFields.initial, <Meters cm={roll.lengthCmInitial} />)}
        {ledger.basisLengthCm !== roll.lengthCmInitial &&
          field(t.rollFields.basis, <Meters cm={ledger.basisLengthCm} />)}
        {seesCosts && field(t.rollFields.cost, <Money cents={roll.costTotalCents} />)}
        {seesCosts && field(t.rollFields.costPerMeter, <Money cents={ledger.costPerMeterCents} />)}
        {seesCosts && field(t.rollFields.stockValue, <Money cents={ledger.unallocatedCostCents} />)}
        {seesCosts &&
          purchase &&
          field(
            t.rollFields.purchase,
            <Link
              href={`/purchases/view?id=${purchase.id}`}
              className="underline-offset-4 hover:underline"
            >
              <DateText value={purchase.date} />
            </Link>,
          )}
      </dl>

      {seesCosts && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={ledger.lengthEstimated ? 'accent' : 'outline'}
            onClick={() => {
              setAction('length_correction');
            }}
          >
            <RulerIcon data-icon="inline-start" aria-hidden />
            {t.actions.measure}
          </Button>
          <Button
            variant="outline"
            disabled={ledger.remainingCm <= 0}
            onClick={() => {
              setAction('loss');
            }}
          >
            {t.actions.loss}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAction('adjustment');
            }}
          >
            {t.actions.adjustment}
          </Button>
          <Button
            variant="ghost"
            disabled={state === 'empty'}
            onClick={() =>
              void repositories.inventory.setRemnant(roll.id, roll.status !== 'remnant')
            }
          >
            {roll.status === 'remnant' ? t.actions.unmarkRemnant : t.actions.markRemnant}
          </Button>
        </div>
      )}

      <section className="grid gap-2" aria-labelledby="history">
        <h3 id="history" className="font-heading font-semibold">
          {t.history}
        </h3>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.historyColumns.date}</TableHead>
                <TableHead>{t.historyColumns.move}</TableHead>
                <TableHead className="text-end">{t.historyColumns.length}</TableHead>
                {seesCosts && <TableHead className="text-end">{t.historyColumns.cost}</TableHead>}
                <TableHead className="max-sm:hidden">{t.historyColumns.note}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {moves.map((move) => (
                <TableRow key={move.id} className="h-12">
                  <TableCell>
                    <DateText value={move.date} />
                  </TableCell>
                  <TableCell>{t.moveTypes[move.type]}</TableCell>
                  <TableCell className="text-end">
                    <SignedMeters cm={move.deltaCm} />
                  </TableCell>
                  {seesCosts && (
                    <TableCell className="text-end">
                      {costOf.has(move.id) && <Money cents={costOf.get(move.id) ?? 0} />}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground max-sm:hidden">
                    {move.note}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {action && (
        <StockMoveDialog
          view={view}
          action={action}
          onClose={() => {
            setAction(null);
          }}
        />
      )}
    </div>
  );
}
