import type { ZakatStatus } from '@fabric/contracts';
import Link from 'next/link';
import { messages } from '@/i18n';
import type { ZakatLatestReport } from '@/local-db';
import { DateText } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { statusTone } from './zakat-model';
import { STATUS_ICONS, TONES } from './zakat-ui';

/** The element the "view history" action scrolls to. */
export const ZAKAT_HISTORY_ID = 'zakat-history';

/** The words under the state's title: some states say a little more once a report is known. */
function descriptionOf(status: ZakatStatus, latest: ZakatLatestReport | null): string {
  const t = messages.zakat.status;
  if (status === 'calculation_completed') {
    return latest !== null && latest.zakatDueCents <= 0
      ? t.calculation_completed.noneDueDescription
      : t.calculation_completed.description;
  }
  if (status === 'payment_recorded') {
    return latest !== null && latest.paidCents >= latest.zakatDueCents
      ? t.payment_recorded.paidInFullDescription
      : t.payment_recorded.description;
  }
  return t[status].description;
}

/**
 * The first thing on the Zakat page: where the shop stands, in one state (never "due" because a
 * reminder came: the state is decided from the hawl, the nisab and the saved reports). It leads
 * with the one main action, reviewing the calculation, which saves nothing by itself; the others
 * (the methodology, the history, recording a payment) are secondary.
 */
export function ZakatStatusCard({
  status,
  latest,
  lastCalculatedAt,
  canPay,
  onPay,
}: {
  status: ZakatStatus;
  latest: ZakatLatestReport | null;
  /** When the newest report that is not voided was saved (an ISO time); null if there is none. */
  lastCalculatedAt: string | null;
  /** The owner may record a payment and the latest report has something left to pay. */
  canPay: boolean;
  onPay: () => void;
}) {
  const t = messages.zakat;
  const tone = TONES[statusTone(status)];
  const Icon = STATUS_ICONS[status];
  return (
    <Card role="status" className={cn('border-s-4', tone.edge)}>
      <CardContent className="grid gap-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              tone.badge,
            )}
          >
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="grid min-w-0 gap-1">
            <h2 className="font-heading text-xl leading-snug font-semibold">
              {t.status[status].title}
            </h2>
            <p className="text-muted-foreground">{descriptionOf(status, latest)}</p>
            <p className="text-sm text-muted-foreground">
              {lastCalculatedAt === null ? (
                t.noCalculation
              ) : (
                <>
                  {t.lastCalculation} <DateText value={lastCalculatedAt} />
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="accent" size="lg">
            <Link href="/zakat/review">{t.actions.review}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/zakat/settings">{t.actions.methodology}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href={`#${ZAKAT_HISTORY_ID}`}>{t.actions.history}</a>
          </Button>
          {canPay && (
            <Button type="button" variant="outline" size="lg" onClick={onPay}>
              {t.actions.pay}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
