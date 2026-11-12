'use client';

import Link from 'next/link';
import { useState } from 'react';
import { messages } from '@/i18n';
import { useCanSeeCosts } from '@/local-db';
import { LoadingState } from '@/shared/brand';
import { DateText, Money, Quantity } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { useDirection } from '@/shared/ui/direction';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { SaleActionBar, type SaleAction } from './sale-actions';
import { useSale } from './use-sale';

const t = messages.sales;
const h = messages.sales.history;
const d = messages.sales.history.drawer;

/**
 * A whole sale, beside the list (a full-screen sheet on a tablet held upright or a phone): who
 * bought what and from which batch, the totals, the payments and returns, and at the foot what can
 * be done about it (share, take a payment, return goods, void). The cost and the profit show to
 * those who may see them (the owner and a partner), never to a cashier.
 */
export function SaleDrawer({
  saleId,
  onClose,
  onAction,
}: {
  saleId: string | null;
  onClose: () => void;
  /** An action that needs a dialog: the list owns the dialogs, so the drawer stays under them. */
  onAction: (saleId: string, action: SaleAction) => void;
}) {
  // The last sale opened stays in the sheet while it slides out.
  const [shown, setShown] = useState(saleId);
  // Opens from the end of the line: beside the list, away from the sidebar (which is at the start).
  const side = useDirection() === 'rtl' ? 'left' : 'right';
  if (saleId !== null && saleId !== shown) setShown(saleId);
  return (
    <Sheet
      open={saleId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side={side}
        className="gap-0 data-[side=left]:w-full data-[side=left]:sm:max-w-none data-[side=left]:lg:w-[34rem] data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:lg:w-[34rem]"
      >
        <SheetHeader className="border-b pe-14">
          <SheetTitle>{d.title}</SheetTitle>
          <SheetDescription>{d.description}</SheetDescription>
        </SheetHeader>
        {shown !== null && (
          <DrawerBody
            id={shown}
            onAction={(action) => {
              onAction(shown, action);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold' : undefined}>{children}</dd>
    </div>
  );
}

function DrawerBody({ id, onAction }: { id: string; onAction: (action: SaleAction) => void }) {
  // The partner sees the same numbers as the owner (SPEC §11); a cashier sees no cost or profit.
  const seesCosts = useCanSeeCosts();
  const data = useSale(id);

  if (data === undefined) {
    return (
      <div className="p-4" aria-label={d.loading}>
        <LoadingState />
      </div>
    );
  }
  if (data === null) {
    return <p className="p-4 text-muted-foreground">{d.notFound}</p>;
  }
  const { view } = data;
  const { sale, figures } = view;
  const voided = sale.voidedAt !== null;

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="grid gap-5 p-4">
          <section className="grid gap-1" aria-label={d.customer}>
            <div className="flex flex-wrap items-center gap-2">
              <DateText value={sale.date} format="long" className="font-medium" />
              {voided && <Badge variant="destructive">{t.voided}</Badge>}
              {view.writeOff && <Badge variant="secondary">{t.writtenOff}</Badge>}
            </div>
            {view.customer ? (
              <div className="grid">
                <Link
                  href={`/customers/view?id=${view.customer.id}`}
                  className="inline-flex min-h-6 w-fit items-center font-medium underline-offset-4 hover:underline pointer-coarse:min-h-11"
                >
                  {view.customer.name}
                </Link>
                {view.customer.phone && (
                  <bdi dir="ltr" data-num className="w-fit text-sm text-muted-foreground">
                    {view.customer.phone}
                  </bdi>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">{t.walkIn}</p>
            )}
          </section>

          <section aria-label={d.items} className="grid gap-1">
            <h3 className="font-heading font-semibold">{d.items}</h3>
            <ul className="divide-y rounded-lg border bg-card">
              {view.lines.map(({ line, product, batch, figures: lineFigures }) => (
                <li key={line.id} className="grid gap-0.5 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {product?.name ?? '—'}
                      {line.wholePiece && (
                        <Badge variant="secondary" className="ms-1.5">
                          {t.invoice.wholePiece}
                        </Badge>
                      )}
                    </span>
                    <Money cents={line.lineTotalCents} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                    <span className="sr-only">{d.quantity}:</span>
                    <Quantity unit={line.unit} amount={line.quantity} />
                    {!line.wholePiece && (
                      <>
                        <span aria-hidden>×</span>
                        <span className="sr-only">{d.unitPrice}:</span>
                        <Money cents={line.actualPriceCents} />
                      </>
                    )}
                    {batch && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="sr-only">{messages.pos.columns.batch}:</span>
                        <bdi dir="ltr" data-num>
                          {batch.code}
                        </bdi>
                      </>
                    )}
                  </div>
                  {line.minOverrideBy !== null && (
                    // Sold under the product's minimum price: who confirmed it and the price it went at.
                    <span className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                      <Badge variant="warning" className="w-fit">
                        {messages.pos.bill.overrideBy(line.minOverrideBy)}
                      </Badge>
                      <span>
                        {messages.pos.minimum.price}: <Money cents={line.minPriceCents} /> ·{' '}
                        {messages.pos.minimum.sold}:{' '}
                        <Money
                          cents={line.wholePiece ? line.lineTotalCents : line.actualPriceCents}
                        />
                      </span>
                    </span>
                  )}
                  {seesCosts && lineFigures?.profitCents != null && (
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{messages.pos.columns.profit}</span>
                      <Money
                        cents={lineFigures.profitCents}
                        tone={lineFigures.profitCents < 0 ? 'loss' : 'profit'}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <dl className="grid gap-1.5 rounded-lg border bg-card p-3">
            {figures.discountCents > 0 && (
              <>
                <Row label={d.subtotal}>
                  <Money cents={figures.linesTotalCents} />
                </Row>
                <Row label={t.discount}>
                  <Money cents={figures.discountCents} />
                </Row>
              </>
            )}
            <Row label={t.total} strong>
              <Money
                cents={figures.totalCents}
                className={voided ? 'text-muted-foreground line-through' : undefined}
              />
            </Row>
            {figures.returnedCents > 0 && (
              <>
                <Row label={t.returnedValue}>
                  <Money cents={figures.returnedCents} />
                </Row>
                <Row label={t.netTotal} strong>
                  <Money cents={figures.netTotalCents} />
                </Row>
              </>
            )}
            {!voided && (
              <>
                <Row label={t.paid}>
                  <Money cents={figures.paidCents} />
                </Row>
                <Row label={t.due} strong>
                  <Money
                    cents={Math.max(figures.dueCents, 0)}
                    tone={figures.dueCents > 0 ? 'debt' : undefined}
                  />
                </Row>
                {sale.dueDate && figures.dueCents > 0 && (
                  <Row label={t.dueDate}>
                    <DateText value={sale.dueDate} format="long" />
                  </Row>
                )}
              </>
            )}
            {seesCosts && figures.capitalCents !== null && figures.profitCents !== null && (
              <>
                <Row label={t.cost}>
                  <Money cents={figures.capitalCents} tone="capital" />
                </Row>
                <Row label={t.profit}>
                  <Money
                    cents={figures.profitCents}
                    tone={figures.profitCents < 0 ? 'loss' : 'profit'}
                  />
                </Row>
              </>
            )}
          </dl>

          {!voided && (
            <section aria-label={h.drawer.paymentsLegend} className="grid gap-1">
              <h3 className="font-heading font-semibold">{t.payments}</h3>
              {figures.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.noPayments}</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {figures.payments.map((payment) => (
                    <li key={payment.allocationId} className="grid gap-0.5 px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <DateText value={payment.date} />
                        <Money cents={payment.amountCents} />
                      </div>
                      {seesCosts && (
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
                          <span>
                            {t.capital}:{' '}
                            {payment.capitalCents === null ? (
                              '—'
                            ) : (
                              <Money cents={payment.capitalCents} tone="capital" />
                            )}
                          </span>
                          <span>
                            {t.recognized}:{' '}
                            {payment.profitCents === null ? (
                              '—'
                            ) : (
                              <Money cents={payment.profitCents} tone="profit" />
                            )}
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {view.returns.length > 0 && (
            <section aria-label={d.returns} className="grid gap-1">
              <h3 className="font-heading font-semibold">{d.returns}</h3>
              <ul className="divide-y rounded-lg border bg-card">
                {view.returns.map((given) => (
                  <li key={given.id} className="grid gap-0.5 px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <DateText value={given.date} />
                      <Money cents={given.creditCents} />
                    </div>
                    <p className="text-sm text-muted-foreground">{given.reason}</p>
                    <p className="text-sm text-muted-foreground">
                      {given.lines
                        .map((returned) => {
                          const found = view.lines.find(
                            (entry) => entry.line.id === returned.lineId,
                          );
                          return found?.product?.name ?? '';
                        })
                        .join(messages.forms.listSeparator)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sale.note && (
            <p className="text-sm">
              <span className="text-muted-foreground">{d.note}: </span>
              {sale.note}
            </p>
          )}
          {view.writeOff && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t.writeOffReason}: </span>
              {view.writeOff.reason}
            </p>
          )}
          {view.saleVoid && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t.voidReason}: </span>
              {view.saleVoid.reason}
            </p>
          )}
        </div>
      </div>

      <SaleActionBar
        data={data}
        onAction={onAction}
        shareVariant="default"
        className="flex max-h-[45dvh] flex-wrap gap-2 overflow-y-auto border-t p-4"
      />
    </>
  );
}
