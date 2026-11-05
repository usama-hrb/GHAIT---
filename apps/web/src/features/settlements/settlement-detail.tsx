'use client';

import { ArrowLeftIcon, LockIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice } from '@/shared/brand';
import { DateText } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Breakdown } from './breakdown';
import { Distribution } from './distribution';
import { periodLabel } from './period-label';
import { RuleNote } from './rule-note';
import { distributionOf, factsOfSettlement, participantsOf } from './settlement-facts';

const t = messages.settlements;

/**
 * One settlement (/settlements/view?id=…): its figures exactly as approved (they do not follow
 * later records or rules), how the net profit was made, who got what by the weights it was settled
 * with, and the costs it froze. An unlocked settlement is still shown, as what it was.
 */
export function SettlementDetailScreen() {
  const repositories = useRepositories();
  const id = useSearchParams().get('id');
  const data = useLiveQuery(async () => {
    if (!id) return { detail: undefined, partners: [] };
    const [detail, partners] = await Promise.all([
      repositories.settlements.detail(id),
      repositories.partners.list(),
    ]);
    return { detail, partners };
  }, [repositories, id]);

  if (data === undefined) return <LoadingState />;
  const { detail } = data;
  const back = (
    <Button asChild variant="ghost" className="w-fit">
      <Link href="/settlements">
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" aria-hidden />
        {t.back}
      </Link>
    </Button>
  );
  if (!detail) {
    return (
      <div className="grid w-full gap-4">
        <OfflineNotice />
        <EmptyState title={t.notFound} action={back} />
      </div>
    );
  }

  const { settlement } = detail;
  const facts = factsOfSettlement(detail);
  const participants = participantsOf(data.partners);

  return (
    <div className="grid w-full gap-6">
      <OfflineNotice />
      {back}
      <header className="grid gap-0.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-heading text-xl font-semibold">
            {periodLabel(settlement.periodStart, settlement.periodEnd)}
          </h2>
          {settlement.voidedAt ? (
            <Badge variant="outline">{t.status.unlocked}</Badge>
          ) : (
            <Badge variant="success">
              <LockIcon data-icon="inline-start" aria-hidden />
              {t.status.settled}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t.lockedAt} <DateText value={settlement.lockedAt} />
          {detail.lockedCostCount > 0 && (
            <>
              {' · '}
              {t.frozenCosts}: <bdi data-num>{detail.lockedCostCount}</bdi>
            </>
          )}
        </p>
      </header>

      {settlement.voidedAt && (
        <Alert>
          <AlertDescription>
            {t.unlockedOn} <DateText value={settlement.voidedAt} />. {t.unlockedNote}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:gap-12">
        <div className="grid content-start gap-2">
          <Breakdown lines={facts.breakdown} />
          <p className="text-sm text-muted-foreground">{t.figuresApproved}</p>
        </div>
        <Distribution
          distribution={distributionOf(facts, participants)}
          netProfitCents={facts.netProfitCents}
          carryDeficitOutCents={facts.carryDeficitOutCents}
          rule={<RuleNote facts={facts} state="settled" />}
        />
      </div>
    </div>
  );
}
