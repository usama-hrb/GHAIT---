import { zakatPaymentStateOf } from '@fabric/contracts';
import { CircleCheckIcon, CircleMinusIcon } from 'lucide-react';
import { messages } from '@/i18n';
import type { ZakatReview } from '@/local-db';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Progress } from '@/shared/ui/progress';
import { hawlProgressOf, nisabPercentOf } from './zakat-model';
import { DualDate, Fact } from './zakat-ui';

const t = messages.zakat;

/** The hawl: when it began, the latest and the next one, and how far through the year the shop is. */
function HawlCard({ clock }: { clock: ZakatReview['clock'] }) {
  const percent = hawlProgressOf(clock);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t.cards.hawl.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {clock.start === null ? (
          <p className="text-muted-foreground">{t.cards.hawl.notSet}</p>
        ) : (
          <>
            <dl className="grid gap-2">
              <Fact label={t.cards.hawl.start}>
                <DualDate value={clock.start} />
              </Fact>
              {clock.last !== null && (
                <Fact label={t.cards.hawl.latest}>
                  <DualDate value={clock.last} />
                </Fact>
              )}
              {clock.next !== null && (
                <Fact label={t.cards.hawl.next}>
                  <DualDate value={clock.next} />
                </Fact>
              )}
            </dl>
            {percent === null ? (
              clock.startsLater && (
                <p className="text-sm text-muted-foreground">{t.cards.hawl.startsLater}</p>
              )
            ) : (
              <div className="grid gap-1.5">
                <Progress value={percent} aria-label={t.cards.hawl.progress} />
                <p className="text-sm text-muted-foreground">
                  {t.cards.hawl.elapsed(clock.elapsedDays, clock.totalDays)} ·{' '}
                  {t.cards.hawl.left(clock.remainingDays)}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The nisab today: the threshold, the base against it and whether it is reached, in words. */
function NisabCard({ estimate }: { estimate: ZakatReview['estimate'] }) {
  const check = estimate?.nisab ?? null;
  const percent = check === null ? null : nisabPercentOf(check);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t.cards.nisab.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {check === null ? (
          <p className="text-muted-foreground">{t.cards.nisab.unavailable}</p>
        ) : (
          <>
            <dl className="grid gap-2">
              <Fact label={t.cards.nisab.threshold}>
                <Money cents={check.thresholdCents} />
              </Fact>
              <Fact label={t.cards.nisab.base}>
                <Money cents={check.baseCents} />
              </Fact>
            </dl>
            <p className="flex items-center gap-1.5 font-medium">
              {check.reached ? (
                <CircleCheckIcon className="size-4 text-success" aria-hidden />
              ) : (
                <CircleMinusIcon className="size-4 text-muted-foreground" aria-hidden />
              )}
              {check.reached ? t.cards.nisab.reached : t.cards.nisab.notReached}
            </p>
            {percent !== null && (
              <div className="grid gap-1.5">
                <Progress value={percent} aria-label={t.cards.nisab.progress} />
                <p className="text-sm text-muted-foreground">{t.cards.nisab.percentOf(percent)}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {t.metals[check.metal]}: <Money cents={check.pricePerGramCents} /> {t.perGram} (
              <DateText value={check.priceDate} />)
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The base: today's estimate, or the figure of the saved report once there is one. */
function BaseCard({
  estimate,
  latest,
}: {
  estimate: ZakatReview['estimate'];
  latest: ZakatReview['latest'];
}) {
  const saved = latest !== null;
  const cents = latest?.baseCents ?? estimate?.fields.baseCents ?? null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t.cards.base.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {cents === null ? (
          <p className="text-muted-foreground">{t.cards.base.unavailable}</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-xl font-semibold">
                <Money cents={cents} />
              </span>
              <Badge variant={saved ? 'success' : 'outline'}>
                {saved ? t.cards.base.saved : t.cards.base.estimate}
              </Badge>
            </p>
            <p className="text-sm text-muted-foreground">
              {saved ? (
                <>
                  {t.cards.base.savedNote} <DateText value={latest.hawlDate} format="hijri" />
                </>
              ) : (
                t.cards.base.estimateNote
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The zakat itself. Before the first hawl has come nothing is due and no figure is shown, however
 * the base stands; after it, an estimate until a report is saved, then the report's amount with
 * what was paid and what is left.
 */
function ZakatDueCard({
  clock,
  estimate,
  latest,
}: {
  clock: ZakatReview['clock'];
  estimate: ZakatReview['estimate'];
  latest: ZakatReview['latest'];
}) {
  const payment =
    latest === null
      ? null
      : zakatPaymentStateOf({
          dueCents: latest.zakatDueCents,
          paidCents: latest.paidCents,
          voided: false,
        });
  const estimated = clock.last !== null ? (estimate?.fields.zakatDueCents ?? null) : null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t.cards.due.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {payment !== null ? (
          payment.dueCents <= 0 ? (
            <p className="text-muted-foreground">{t.cards.due.none}</p>
          ) : (
            <>
              <dl className="grid gap-2">
                <Fact label={t.cards.due.final}>
                  <Money cents={payment.dueCents} />
                </Fact>
                <Fact label={t.cards.due.paid}>
                  <Money cents={payment.paidCents} />
                </Fact>
                <Fact label={t.cards.due.remaining}>
                  <Money cents={payment.remainingCents} />
                </Fact>
              </dl>
              <Progress value={payment.percent} aria-label={t.cards.due.progress} />
            </>
          )
        ) : clock.last === null ? (
          <p className="text-muted-foreground">
            {clock.start === null ? t.cards.due.unavailable : t.cards.due.notDueYet}
          </p>
        ) : estimated === null ? (
          <p className="text-muted-foreground">{t.cards.due.unavailable}</p>
        ) : estimated <= 0 ? (
          <p className="text-muted-foreground">{t.cards.due.none}</p>
        ) : (
          <dl className="grid gap-2">
            <Fact label={t.cards.due.estimated}>
              <Money cents={estimated} />
            </Fact>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** The four figures of the overview side by side where there is room (a container query). */
export function ZakatSummary({ review }: { review: ZakatReview }) {
  return (
    <div className="grid gap-3 @xl:grid-cols-2">
      <HawlCard clock={review.clock} />
      <NisabCard estimate={review.estimate} />
      <BaseCard estimate={review.estimate} latest={review.latest} />
      <ZakatDueCard clock={review.clock} estimate={review.estimate} latest={review.latest} />
    </div>
  );
}
