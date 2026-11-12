import {
  nisabCheckOf,
  zakatBaseCategoriesOf,
  zakatPaymentNoteOf,
  zakatPaymentStateOf,
} from '@fabric/contracts';
import { BanIcon, CircleCheckIcon, CircleMinusIcon } from 'lucide-react';
import { messages } from '@/i18n';
import type { ZakatReportView } from '@/local-db';
import { DateText, Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Progress } from '@/shared/ui/progress';
import { BaseCategories } from './base-categories';
import { GoodsTable } from './goods-table';
import { CollapsibleSection, DualDate, Fact, PaymentStateBadge } from './zakat-ui';

const t = messages.zakat;

/**
 * One saved report, exactly as it was saved: its figures, the nisab reference and the settings it
 * was made with (a later change to the settings never reaches it), how it was built, what was paid
 * on it and by whom. Nothing here is worked out again: the base categories, the nisab check and the
 * payment state are read from the saved report and its payments. The owner may record a payment
 * and, while nothing is paid, void it; a partner only reads.
 */
export function ZakatReportBody({
  view,
  isOwner,
  shareHref,
  onPay,
  onVoid,
}: {
  view: ZakatReportView;
  isOwner: boolean;
  shareHref: string;
  onPay: () => void;
  onVoid: () => void;
}) {
  const { report, paidCents, payments } = view;
  const { settings, breakdown } = report;
  const voided = report.voidedAt !== null;
  const payment = zakatPaymentStateOf({ dueCents: report.zakatDueCents, paidCents, voided });
  const nisab = nisabCheckOf(report);
  const categories = zakatBaseCategoriesOf(breakdown, settings, null);
  const canPay = isOwner && !voided && payment.remainingCents > 0;
  const canVoid = isOwner && !voided && paidCents === 0;
  const Reached = nisab.reached ? CircleCheckIcon : CircleMinusIcon;

  return (
    <div className="grid gap-5">
      <header className="grid gap-2">
        <h2 className="font-heading text-xl font-semibold">
          {t.reportOf} <DateText value={report.hawlDate} format="hijri" />
        </h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <PaymentStateBadge state={payment.state} />
          <span>
            {t.report.calculated} <DateText value={report.createdAt} />
          </span>
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">{t.report.asSaved}</p>
      </header>

      {voided && (
        <Alert role="status">
          <BanIcon aria-hidden />
          <AlertDescription>{t.report.voidedBanner}</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="report-result" className="grid gap-3">
        <h3 id="report-result" className="font-heading text-lg font-semibold">
          {t.review.steps.result}
        </h3>
        <dl className="grid gap-2 @md:grid-cols-3">
          <Fact label={t.report.hawl} className="@md:col-span-3">
            <DualDate value={report.hawlDate} />
          </Fact>
          <Fact label={t.resultStep.rows.base}>
            <Money cents={report.baseCents} />
          </Fact>
          <Fact label={t.resultStep.rows.nisab}>
            <Money cents={report.nisabCents} />
          </Fact>
          <Fact label={t.resultStep.rows.due}>
            <Money cents={report.zakatDueCents} />
          </Fact>
        </dl>
        <p className="flex items-start gap-2 text-sm">
          <Reached
            className={cn(
              'mt-0.5 size-4 shrink-0',
              nisab.reached ? 'text-success' : 'text-muted-foreground',
            )}
            aria-hidden
          />
          <span>
            {nisab.reached ? t.nisabStep.reached : t.nisabStep.notReached}{' '}
            <span className="text-muted-foreground">
              {t.report.reference}: {t.metals[nisab.metal]} ·{' '}
              <Money cents={nisab.pricePerGramCents} /> {t.perGram} (
              <DateText value={nisab.priceDate} />)
            </span>
          </span>
        </p>
      </section>

      <section
        aria-labelledby="report-payment"
        className="grid gap-3 rounded-xl border bg-card p-4"
      >
        <h3 id="report-payment" className="font-heading text-lg font-semibold">
          {t.report.paymentTitle}
        </h3>
        {payment.dueCents <= 0 ? (
          <p className="text-muted-foreground">{t.cards.due.none}</p>
        ) : (
          <>
            <dl className="grid gap-2 @md:grid-cols-3">
              <Fact label={t.report.due}>
                <Money cents={payment.dueCents} />
              </Fact>
              <Fact label={t.report.paid}>
                <Money cents={payment.paidCents} />
              </Fact>
              <Fact label={t.report.remaining}>
                <Money cents={payment.remainingCents} />
              </Fact>
              {payment.excessCents > 0 && (
                <Fact label={t.report.excess} className="@md:col-span-3">
                  <Money cents={payment.excessCents} />
                </Fact>
              )}
            </dl>
            <Progress value={payment.percent} aria-label={t.report.progress} />
          </>
        )}

        <div className="grid gap-1.5">
          <h4 className="font-medium">{t.report.paymentsTitle}</h4>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.report.noPayments}</p>
          ) : (
            <ul className="grid divide-y rounded-lg border">
              {payments.map((draw) => {
                const note = zakatPaymentNoteOf(draw.reason, report.hawlDate);
                const gone = draw.voidedAt !== null;
                return (
                  <li
                    key={draw.id}
                    className={cn(
                      'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 p-3',
                      gone && 'text-muted-foreground',
                    )}
                  >
                    <span className={cn('min-w-0', gone && 'line-through')}>
                      {draw.partnerName} · <DateText value={draw.date} />
                      {note !== null && (
                        <span className="block text-sm text-muted-foreground">{note}</span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-2">
                      {gone && <span className="text-xs">{t.paymentState.voided}</span>}
                      <span className={cn(gone && 'line-through')}>
                        <Money cents={draw.amountCents} />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t.paymentHint}</p>
        <p className="text-sm text-muted-foreground">{t.report.unsupported}</p>
        {canPay && (
          <div>
            <Button type="button" variant="accent" onClick={onPay}>
              {t.actions.pay}
            </Button>
          </div>
        )}
      </section>

      <CollapsibleSection defaultOpen title={t.report.baseTitle}>
        <BaseCategories
          categories={categories}
          breakdown={breakdown}
          items={[]}
          baseCents={report.baseCents}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t.report.inventoryTitle}>
        <p className="text-sm">
          <span className="text-muted-foreground">{t.inventoryStep.valuation}: </span>
          <span className="font-medium">{t.valuations[settings.goodsValuation]}</span>
        </p>
        <GoodsTable
          goods={breakdown.goods}
          valuation={settings.goodsValuation}
          countedCents={breakdown.goodsCents}
        />
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen
        title={t.report.methodologyTitle}
        description={t.report.methodologyNote}
      >
        <dl className="grid gap-2 @md:grid-cols-2">
          <Fact label={t.fields.merchant}>{t.managing}</Fact>
          <Fact label={t.fields.nisabMetal}>{t.metals[settings.nisabMetal]}</Fact>
          <Fact label={t.fields.valuation}>{t.valuations[settings.goodsValuation]}</Fact>
          <Fact label={t.fields.doubtful}>
            {settings.includeDoubtfulDebts ? t.settingsStep.counted : t.settingsStep.notCounted}
          </Fact>
        </dl>
      </CollapsibleSection>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={shareHref} target="_blank" rel="noreferrer">
            {t.shareAction}
          </a>
        </Button>
        {canVoid && (
          <Button type="button" variant="ghost" onClick={onVoid}>
            {t.voidAction}
          </Button>
        )}
      </div>
    </div>
  );
}
