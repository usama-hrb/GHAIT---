'use client';

import type { ZakatReport } from '@fabric/contracts';
import { formatMoneyAmount, type MoneyUnit } from '@fabric/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { isPeriodLocked, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import {
  DateText,
  formatDate,
  Money,
  MoneyInput,
  moneyUnitLabel,
  useMoneyUnit,
} from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { whatsAppLink } from '@/shared/lib/whatsapp';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { ZakatBreakdownView } from './zakat-breakdown';

const t = messages.zakat;

/** The report as text, to share on WhatsApp (no printing, CLAUDE.md). */
function shareText(report: ZakatReport, unit: MoneyUnit): string {
  const money = (cents: number) => `${formatMoneyAmount(cents, unit)} ${moneyUnitLabel(unit)}`;
  const { breakdown } = report;
  return [
    t.share.title(formatDate(report.hawlDate, 'hijri')),
    `${t.lines.goods}: ${money(breakdown.goodsCents)}`,
    `${t.lines.cash}: ${money(breakdown.cashCents)}`,
    `${t.lines.receivables}: ${money(breakdown.receivablesCents)}`,
    `${t.lines.debts}: −${money(breakdown.debtsDueCents)}`,
    `${t.lines.base}: ${money(report.baseCents)}`,
    `${t.lines.nisab}: ${money(report.nisabCents)}`,
    `${t.lines.due}: ${money(report.zakatDueCents)}`,
    t.notFatwa,
  ].join('\n');
}

function PayDialog({
  reportId,
  remainingCents,
  open,
  onOpenChange,
}: {
  reportId: string;
  remainingCents: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const [amount, setAmount] = useState<number | null>(remainingCents);
  const [date, setDate] = useState(() => shopToday());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (amount === null || amount <= 0) return;
            repositories.zakat
              .pay(reportId, { amountCents: amount, date })
              .then(() => {
                toast.success(t.paid, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof ValidationError ? error.issues[0]?.message : undefined;
                toast.error(
                  isPeriodLocked(error)
                    ? messages.forms.periodLocked
                    : ((message && t.issues[message]) ?? messages.forms.invalid),
                );
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.payTitle}</DialogTitle>
            <DialogDescription>{t.payDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>{t.fields.amount}</FieldLabel>
                <MoneyInput id={`${id}-amount`} required value={amount} onValueChange={setAmount} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>{t.fields.date}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
                <PeriodLockHint date={date} lockedThrough={lockedThrough} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit">{t.pay}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One saved zakat report (/zakat/view?id=…): its items, its settings, what was paid and by whom. */
export function ZakatReportScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const { unit } = useMoneyUnit();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const view = useLiveQuery(
    async () => (await repositories.zakat.report(id)) ?? null,
    [repositories, id],
  );

  if (view === undefined) return <LoadingState />;
  if (view === null) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/zakat">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { report } = view;
  const remaining = report.zakatDueCents - view.paidCents;
  const settings = report.settings;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/zakat">{t.back}</Link>
      </Button>
      <h2 className="font-heading text-xl font-semibold">
        {t.reportOf} <DateText value={report.hawlDate} format="hijri" />
      </h2>
      <p className="text-sm text-muted-foreground">
        <DateText value={report.hawlDate} /> · {t.metals[settings.nisabMetal]}:{' '}
        <Money cents={report.metalPrice.pricePerGramCents} /> {t.perGram} (
        <DateText value={report.metalPrice.date} />) · {t.valuations[settings.goodsValuation]} ·{' '}
        {settings.includeDoubtfulDebts ? t.doubtfulIn : t.doubtfulOut}
      </p>
      <ZakatBreakdownView
        breakdown={report.breakdown}
        baseCents={report.baseCents}
        nisabCents={report.nisabCents}
        zakatDueCents={report.zakatDueCents}
      />

      <section aria-label={t.paymentsTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.paymentsTitle}</h3>
        <p>
          {t.paidSoFar} <Money cents={view.paidCents} /> · {t.left}{' '}
          <Money cents={Math.max(0, remaining)} />
        </p>
        {view.payments.length > 0 && (
          <dl className="grid gap-1 rounded-lg border bg-card p-4">
            {view.payments.map((draw) => (
              <div
                key={draw.id}
                className={
                  draw.voidedAt
                    ? 'flex justify-between gap-2 line-through'
                    : 'flex justify-between gap-2'
                }
              >
                <dt className="text-muted-foreground">
                  {draw.partnerName} · <DateText value={draw.date} />
                </dt>
                <dd>
                  <Money cents={draw.amountCents} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-sm text-muted-foreground">{t.paymentHint}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        {report.voidedAt === null && remaining > 0 && (
          <Button
            variant="accent"
            onClick={() => {
              setPaying(true);
            }}
          >
            {t.pay}
          </Button>
        )}
        <Button asChild variant="outline">
          <a href={whatsAppLink(shareText(report, unit), null)} target="_blank" rel="noreferrer">
            {t.shareAction}
          </a>
        </Button>
        {report.voidedAt === null && view.paidCents === 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setVoiding(true);
            }}
          >
            {t.voidAction}
          </Button>
        )}
      </div>

      <PayDialog
        key={paying ? 'open' : 'closed'}
        reportId={report.id}
        remainingCents={Math.max(0, remaining)}
        open={paying}
        onOpenChange={setPaying}
      />
      <VoidDialog
        open={voiding}
        onOpenChange={setVoiding}
        title={t.voidTitle}
        description={t.voidDescription}
        onConfirm={async (reason) => {
          await repositories.zakat.void(report.id, reason);
          setVoiding(false);
          toast.success(t.voided, { description: messages.forms.saved });
        }}
      />
    </div>
  );
}
