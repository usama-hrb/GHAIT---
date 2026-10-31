'use client';

import { Share2Icon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PaymentDialog } from '@/features/customers';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, useSession } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateAr, Meters, Money, useMoneyUnit } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { whatsAppLink } from '@/shared/lib/whatsapp';
import { invoiceText } from './invoice-text';
import { isLockedOn, PeriodLockHint, useLockedThrough } from '@/features/settlements';

const t = messages.sales;

/** One sale (/pos/view?id=…): its lines and totals, shared on WhatsApp, voided with a reason. */
export function SaleDetailScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const session = useSession();
  const isOwner = session.user?.role === 'owner';
  const { unit } = useMoneyUnit();
  const [voiding, setVoiding] = useState(false);
  const lockedThrough = useLockedThrough();
  const [paying, setPaying] = useState(false);
  const data = useLiveQuery(async () => {
    const view = await repositories.sales.get(id);
    if (!view) return null;
    return { view, shopName: await repositories.settings.get('shop_name', shopToday()) };
  }, [repositories, id]);

  if (data === undefined) return <LoadingState />;
  if (data === null) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/pos">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { view, shopName } = data;
  const { sale, figures } = view;
  const voided = sale.voidedAt !== null;
  const text = invoiceText(view, shopName, unit);
  const link = whatsAppLink(text, view.customer?.phone ?? null);

  const share = () => {
    if (typeof navigator.share === 'function') {
      navigator.share({ text }).catch(() => {
        // Closed without sharing: nothing to do.
      });
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(t.copied))
      .catch(() => {
        window.open(link, '_blank', 'noopener');
      });
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/pos">{t.back}</Link>
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.detailTitle}</h2>
        <DateAr value={sale.date} format="long" className="text-muted-foreground" />
        {voided && <Badge variant="destructive">{t.voided}</Badge>}
        {view.writeOff && <Badge variant="outline">{t.writtenOff}</Badge>}
      </div>
      {view.customer ? (
        <Link
          href={`/customers/view?id=${view.customer.id}`}
          className="underline-offset-4 hover:underline"
        >
          {view.customer.name}
        </Link>
      ) : (
        <p>{t.walkIn}</p>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{messages.pos.columns.item}</TableHead>
              <TableHead>{messages.pos.columns.roll}</TableHead>
              <TableHead className="text-end">{messages.pos.columns.length}</TableHead>
              <TableHead className="text-end max-sm:hidden">{messages.pos.columns.price}</TableHead>
              <TableHead className="text-end">{messages.pos.columns.total}</TableHead>
              {isOwner && (
                <TableHead className="text-end max-sm:hidden">
                  {messages.pos.columns.profit}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.lines.map(({ line, roll, variant, fabric, figures: lineFigures }) => (
              <TableRow key={line.id}>
                <TableCell>
                  {fabric?.name} · {variant?.colorName}
                  {line.wholePiece && (
                    <Badge variant="secondary" className="ms-1.5">
                      {t.invoice.wholePiece}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <bdi dir="ltr" data-num>
                    {roll?.shortCode}
                  </bdi>
                </TableCell>
                <TableCell className="text-end">
                  <Meters cm={line.soldCm} />
                </TableCell>
                <TableCell className="text-end max-sm:hidden">
                  <Money cents={line.actualPricePerMeterCents} />
                </TableCell>
                <TableCell className="text-end">
                  <Money cents={line.lineTotalCents} />
                </TableCell>
                {isOwner && (
                  <TableCell className="text-end max-sm:hidden">
                    {lineFigures?.profitCents == null ? (
                      '—'
                    ) : (
                      <Money
                        cents={lineFigures.profitCents}
                        tone={lineFigures.profitCents < 0 ? 'loss' : 'profit'}
                      />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 sm:grid-cols-2">
        {figures.discountCents > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.discount}</dt>
            <dd>
              <Money cents={figures.discountCents} />
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.total}</dt>
          <dd className="font-semibold">
            <Money cents={figures.totalCents} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.paid}</dt>
          <dd>
            <Money cents={figures.paidCents} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t.due}</dt>
          <dd>
            <Money
              cents={Math.max(figures.dueCents, 0)}
              tone={figures.dueCents > 0 ? 'debt' : undefined}
            />
          </dd>
        </div>
        {sale.dueDate && figures.dueCents > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t.dueDate}</dt>
            <dd>
              <DateAr value={sale.dueDate} format="long" />
            </dd>
          </div>
        )}
        {isOwner && figures.capitalCents !== null && figures.profitCents !== null && (
          <>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t.cost}</dt>
              <dd>
                <Money cents={figures.capitalCents} tone="capital" />
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t.profit}</dt>
              <dd>
                <Money
                  cents={figures.profitCents}
                  tone={figures.profitCents < 0 ? 'loss' : 'profit'}
                />
              </dd>
            </div>
          </>
        )}
      </dl>
      {sale.note && <p className="text-muted-foreground">{sale.note}</p>}
      {figures.payments.length > 0 && (
        <section aria-label={t.payments} className="grid gap-2">
          <h3 className="font-heading font-semibold">{t.payments}</h3>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.customers.columns.date}</TableHead>
                  <TableHead className="text-end">{messages.customers.columns.amount}</TableHead>
                  {isOwner && <TableHead className="text-end">{t.capital}</TableHead>}
                  {isOwner && <TableHead className="text-end">{t.recognized}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {figures.payments.map((payment) => (
                  <TableRow key={payment.allocationId}>
                    <TableCell>
                      <DateAr value={payment.date} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={payment.amountCents} />
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-end">
                        {payment.capitalCents === null ? (
                          '—'
                        ) : (
                          <Money cents={payment.capitalCents} tone="capital" />
                        )}
                      </TableCell>
                    )}
                    {isOwner && (
                      <TableCell className="text-end">
                        {payment.profitCents === null ? (
                          '—'
                        ) : (
                          <Money cents={payment.profitCents} tone="profit" />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
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

      {!voided && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="accent" size="lg" onClick={share}>
            <Share2Icon aria-hidden />
            {t.share}
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href={link} target="_blank" rel="noopener noreferrer">
              {t.whatsapp}
            </a>
          </Button>
          {view.customer && figures.dueCents > 0 && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setPaying(true);
              }}
            >
              {messages.customers.recordPayment}
            </Button>
          )}
          {isLockedOn(sale.date, lockedThrough) ? (
            <div className="ms-auto">
              <PeriodLockHint date={sale.date} lockedThrough={lockedThrough} />
            </div>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="ms-auto"
              onClick={() => {
                setVoiding(true);
              }}
            >
              {t.voidAction}
            </Button>
          )}
        </div>
      )}

      {view.customer && (
        <PaymentDialog
          open={paying}
          onOpenChange={setPaying}
          customerId={view.customer.id}
          invoices={[
            {
              saleId: sale.id,
              date: sale.date,
              dueDate: sale.dueDate,
              totalCents: sale.totalCents,
              paidCents: figures.paidCents,
              dueCents: figures.dueCents,
              writtenOff: view.writeOff !== undefined,
              overdue: false,
            },
          ]}
          defaultTarget={sale.id}
        />
      )}
      <VoidDialog
        open={voiding}
        onOpenChange={setVoiding}
        title={t.voidTitle}
        description={t.voidDescription}
        onConfirm={async (reason) => {
          await repositories.sales.voidSale(sale.id, reason);
          setVoiding(false);
          toast.success(t.voidedSaved, { description: messages.forms.saved });
        }}
      />
    </div>
  );
}
