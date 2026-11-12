'use client';

import { zakatPaymentStateOf } from '@fabric/contracts';
import { useState } from 'react';
import { messages } from '@/i18n';
import { useGuardedQuery, useRepositories, useSession } from '@/local-db';
import { ErrorState, LoadingState, OfflineNotice } from '@/shared/brand';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { ZakatStatusCard } from './status-card';
import { ZakatSummary } from './summary-cards';
import { ZakatAttention } from './zakat-attention';
import { ZakatHistory } from './zakat-history';
import { ZakatPayDialog } from './zakat-pay-dialog';

const t = messages.zakat;

/**
 * The Zakat Management Center (SPEC §10, ADR 0028): where the shop stands on zakat in one state,
 * what needs a look, the hawl, the nisab, the base and the zakat in four figures, and every saved
 * report. It records nothing by itself: the one main action opens the guided review, and the
 * methodology, the history and a payment are secondary. A calculation tool, not a fatwa: the note
 * says so. The owner changes things; a partner reads.
 */
export function ZakatScreen() {
  const repositories = useRepositories();
  const isOwner = useSession().user?.role === 'owner';
  const [paying, setPaying] = useState(false);
  const { result, retry } = useGuardedQuery(async () => {
    const [review, history] = await Promise.all([
      repositories.zakat.review(),
      repositories.zakat.history(),
    ]);
    return { review, history };
  }, [repositories]);

  const data = result?.ok ? result.value : null;
  const latest = data?.review.latest ?? null;
  const left =
    latest === null
      ? 0
      : zakatPaymentStateOf({
          dueCents: latest.zakatDueCents,
          paidCents: latest.paidCents,
          voided: false,
        }).remainingCents;

  return (
    <div className="@container mx-auto grid w-full max-w-5xl gap-6">
      <OfflineNotice />
      <p className="max-w-prose text-muted-foreground">{t.subtitle}</p>
      <Alert>
        <AlertDescription>{t.notFatwa}</AlertDescription>
      </Alert>
      {!isOwner && (
        <p role="note" className="text-sm text-muted-foreground">
          {t.readOnlyNote}
        </p>
      )}

      {result === undefined ? (
        <LoadingState rows={3} />
      ) : data === null ? (
        <ErrorState onRetry={retry} />
      ) : (
        <>
          <ZakatStatusCard
            status={data.review.status}
            latest={latest}
            lastCalculatedAt={data.review.lastCalculatedAt}
            canPay={isOwner && left > 0}
            onPay={() => {
              setPaying(true);
            }}
          />
          <ZakatAttention items={data.review.items} />
          <ZakatSummary review={data.review} />
          <ZakatHistory rows={data.history} />
          {latest !== null && (
            <ZakatPayDialog
              key={paying ? 'open' : 'closed'}
              report={latest}
              open={paying}
              onOpenChange={setPaying}
            />
          )}
        </>
      )}
    </div>
  );
}
