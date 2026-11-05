'use client';

import { ReceiptTextIcon, Share2Icon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState } from '@/shared/brand';
import { DateText, Money, Quantity, useMoneyUnit } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { whatsAppLink } from '@/shared/lib/whatsapp';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { useDirection } from '@/shared/ui/direction';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { invoiceText } from './invoice-text';
import { shareInvoice } from './share-invoice';

const t = messages.sales;
const h = messages.sales.history;
const d = messages.sales.history.drawer;

/**
 * A sale at a glance, beside the list (a full-screen sheet on a tablet held upright or a phone):
 * who bought what, the totals, what was paid and what is left. It shows no cost and no profit
 * (the invoice page does, to those who may see them); payments, returns and voiding happen there.
 */
export function SaleDrawer({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
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
        {shown !== null && <DrawerBody id={shown} />}
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

function DrawerBody({ id }: { id: string }) {
  const repositories = useRepositories();
  const { unit } = useMoneyUnit();
  const data = useLiveQuery(async () => {
    const view = await repositories.sales.get(id);
    if (!view) return null;
    return { view, shopName: await repositories.settings.get('shop_name', shopToday()) };
  }, [repositories, id]);

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
  const { view, shopName } = data;
  const { sale, figures } = view;
  const voided = sale.voidedAt !== null;
  const text = invoiceText(view, shopName, unit);
  const link = whatsAppLink(text, view.customer?.phone ?? null);

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
                  className="w-fit font-medium underline-offset-4 hover:underline"
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
              {view.lines.map(({ line, product }) => (
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
                  </div>
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
          </dl>

          {!voided && (
            <section aria-label={h.drawer.paymentsLegend} className="grid gap-1">
              <h3 className="font-heading font-semibold">{t.payments}</h3>
              {figures.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.noPayments}</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {figures.payments.map((payment) => (
                    <li
                      key={payment.allocationId}
                      className="flex items-baseline justify-between gap-3 px-3 py-2.5"
                    >
                      <DateText value={payment.date} />
                      <Money cents={payment.amountCents} />
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
                  <li
                    key={given.id}
                    className="flex items-baseline justify-between gap-3 px-3 py-2.5"
                  >
                    <DateText value={given.date} />
                    <Money cents={given.creditCents} />
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
          {view.saleVoid && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t.voidReason}: </span>
              {view.saleVoid.reason}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t p-4">
        <Button asChild size="lg" className="flex-1">
          <Link href={`/pos/view?id=${sale.id}`}>
            <ReceiptTextIcon data-icon="inline-start" aria-hidden />
            {h.openInvoice}
          </Link>
        </Button>
        {!voided && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={() => {
              shareInvoice(text, link);
            }}
          >
            <Share2Icon data-icon="inline-start" aria-hidden />
            {t.share}
          </Button>
        )}
      </div>
    </>
  );
}
