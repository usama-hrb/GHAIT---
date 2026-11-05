'use client';

import type { SettlementPreviewResult } from '@fabric/contracts';
import { dayAfter } from '@fabric/core';
import { LockIcon, ScaleIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type SettlementView, useLiveQuery, useRepositories, useSession } from '@/local-db';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineNotice,
  useOnlineStatus,
  VoidDialog,
} from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { addDays, shopToday } from '@/shared/lib/dates';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { ApproveDialog, type ServerPreviewState, serverErrorMessage } from './approve-dialog';
import { Breakdown } from './breakdown';
import { Distribution } from './distribution';
import { RuleNote } from './rule-note';
import { periodLabel } from './period-label';
import { PeriodPicker } from './period-picker';
import { SettlementHistory } from './settlement-history';
import {
  distributionOf,
  factsOfPreview,
  factsOfSettlement,
  type PeriodState,
  participantsOf,
  periodStateOf,
  type SettlementFacts,
} from './settlement-facts';

const t = messages.settlements;

/** What the page shows for the chosen period. `end` ties it to the period it was read for. */
type PeriodView =
  | { end: string; kind: 'none' }
  | { end: string; kind: 'open'; result: SettlementPreviewResult }
  | { end: string; kind: 'settled'; detail: SettlementView };

function StatusBadge({ state }: { state: PeriodState }) {
  if (state === 'settled') {
    return (
      <Badge variant="success">
        <LockIcon data-icon="inline-start" aria-hidden />
        {t.status.settled}
      </Badge>
    );
  }
  if (state === 'ready') return <Badge variant="warning">{t.status.ready}</Badge>;
  return <Badge variant="outline">{t.status.notSettled}</Badge>;
}

/**
 * The settlement workspace (SPEC §8, §14.10, BUILD_PROMPTS 4.3): pick a period, see how its net
 * profit is made and who receives what, approve it (the server computes and locks it) and read
 * the history. The figures are this device's records, offline too; nothing here works out an
 * accounting amount, it shows what @fabric/core computed. The split rules live in Partners.
 */
export function SettlementsScreen() {
  const repositories = useRepositories();
  const online = useOnlineStatus();
  const isOwner = useSession().user?.role === 'owner';
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [server, setServer] = useState<ServerPreviewState | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    try {
      const [openEnds, lockedThrough, history, partners, rules] = await Promise.all([
        repositories.settlements.openPeriodEnds(),
        repositories.settlements.lockedThrough(),
        repositories.settlements.history(),
        repositories.partners.list(),
        repositories.settlements.splitRules(),
      ]);
      return { openEnds, lockedThrough, history, partners, rules };
    } catch {
      return { failed: true as const };
    }
  }, [repositories, attempt]);

  const failed = data !== undefined && 'failed' in data;
  const live = !failed && data ? data.history.filter((row) => row.voidedAt === null) : [];
  const defaultEnd = (!failed && data ? data.openEnds[0] : undefined) ?? live[0]?.periodEnd ?? '';
  const end = chosen ?? defaultEnd;
  const settlement = live.find((row) => row.periodEnd === end);

  const view = useLiveQuery(async (): Promise<PeriodView | null> => {
    if (end === '') return { end, kind: 'none' };
    if (settlement) {
      const detail = await repositories.settlements.detail(settlement.id);
      return detail ? { end, kind: 'settled', detail } : { end, kind: 'none' };
    }
    return { end, kind: 'open', result: await repositories.settlements.preview(end) };
  }, [repositories, end, settlement?.id]);

  if (data === undefined) return <LoadingState />;
  if ('failed' in data) {
    return (
      <ErrorState
        title={t.loadError}
        description={t.loadErrorDescription}
        onRetry={() => {
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  const participants = participantsOf(data.partners);
  const latest = live[0];
  // A view read for another period is stale: wait for the one that matches.
  const current = view?.end === end ? view : null;
  const local = current?.kind === 'open' && current.result.ok ? current.result.preview : null;
  const issues = current?.kind === 'open' && !current.result.ok ? current.result.issues : [];
  const state = periodStateOf({ settled: current?.kind === 'settled', previewOk: local !== null });

  let facts: SettlementFacts | null = null;
  if (current?.kind === 'settled') facts = factsOfSettlement(current.detail);
  else if (local) facts = factsOfPreview(local);

  function askServer() {
    setServer({ status: 'loading' });
    repositories.settlements
      .serverPreview(end)
      .then((result) => {
        setServer({ status: 'ready', preview: result });
      })
      .catch((error: unknown) => {
        setServer({ status: 'error', message: serverErrorMessage(error) });
      });
  }

  const earlierOpen = state === 'ready' && data.openEnds.length > 1 && end !== data.openEnds[0];
  const nothingToSettle = data.openEnds.length === 0 && data.history.length > 0;

  return (
    <div className="grid w-full gap-6">
      <OfflineNotice />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-0.5">
          <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{t.description}</p>
          {data.lockedThrough && (
            <p className="text-sm text-muted-foreground">
              {t.lockedThrough} <DateText value={data.lockedThrough} />
            </p>
          )}
        </div>
        <PeriodPicker
          openEnds={data.openEnds}
          settled={live}
          end={end}
          custom={custom}
          min={data.lockedThrough ? dayAfter(data.lockedThrough) : '2000-01-01'}
          max={addDays(shopToday(), -1)}
          onSelect={(next) => {
            setCustom(false);
            setChosen(next);
          }}
          onCustom={() => {
            setCustom(true);
            setChosen(end);
          }}
          onDate={setChosen}
        />
      </header>

      {nothingToSettle && !custom && settlement === undefined && (
        <Alert>
          <AlertDescription>{t.nothingToSettle}</AlertDescription>
        </Alert>
      )}

      {current === null ? (
        <div className="grid gap-4" role="status" aria-label={messages.states.loading}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <section
            aria-label={t.summary.label}
            className="grid gap-4 rounded-xl border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
          >
            <div className="grid gap-3">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-10">
                <div className="col-span-2 grid gap-0.5 sm:col-span-1">
                  <dt className="text-sm text-muted-foreground">{t.summary.net}</dt>
                  <dd className="font-heading text-3xl font-semibold">
                    {facts ? (
                      <span data-testid="summary-net">
                        <NetFigure cents={facts.netProfitCents} />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-sm text-muted-foreground">{t.summary.period}</dt>
                  <dd className="font-medium">
                    {facts ? (
                      periodLabel(facts.periodStart, facts.periodEnd)
                    ) : end === '' ? (
                      '—'
                    ) : (
                      <DateText value={end} />
                    )}
                  </dd>
                </div>
                <div className="grid content-start justify-items-start gap-1">
                  <dt className="text-sm text-muted-foreground">{t.summary.status}</dt>
                  <dd>
                    <StatusBadge state={state} />
                  </dd>
                </div>
                {state === 'settled' && settlement && (
                  <div className="grid gap-0.5">
                    <dt className="text-sm text-muted-foreground">{t.lockedAt}</dt>
                    <dd className="font-medium">
                      <DateText value={settlement.lockedAt} />
                    </dd>
                  </div>
                )}
              </dl>
              <p className="text-sm text-muted-foreground">{t.statusHelp[state]}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {state === 'ready' && isOwner && (
                <Button variant="accent" size="lg" disabled={!online} onClick={askServer}>
                  {t.review}
                </Button>
              )}
              {state === 'settled' && settlement && (
                <>
                  <Button asChild variant="outline" size="lg">
                    <Link href={`/settlements/view?id=${settlement.id}`}>{t.details}</Link>
                  </Button>
                  {isOwner && settlement.id === latest?.id && (
                    <Button
                      variant="ghost"
                      size="lg"
                      disabled={!online}
                      onClick={() => {
                        setUnlocking(settlement.id);
                      }}
                    >
                      {t.unlock}
                    </Button>
                  )}
                </>
              )}
            </div>
            {state === 'ready' && !isOwner && (
              <p className="text-sm text-muted-foreground lg:col-span-2">{t.ownerOnly}</p>
            )}
            {state === 'ready' && isOwner && !online && (
              <p className="text-sm text-muted-foreground lg:col-span-2">{t.approveOffline}</p>
            )}
          </section>

          {issues.length > 0 && (
            <Alert>
              <AlertDescription>
                {issues.map((issue) => t.issues[issue.message] ?? messages.forms.invalid)}
              </AlertDescription>
            </Alert>
          )}
          {earlierOpen && (
            <Alert>
              <AlertDescription>{t.settlesEarlier}</AlertDescription>
            </Alert>
          )}

          {facts ? (
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:gap-12">
              <div className="grid content-start gap-2">
                <Breakdown lines={facts.breakdown} />
                <p className="text-sm text-muted-foreground">
                  {state === 'settled' ? t.figuresApproved : t.figuresOfDevice}
                </p>
              </div>
              <Distribution
                distribution={distributionOf(facts, participants)}
                netProfitCents={facts.netProfitCents}
                carryDeficitOutCents={facts.carryDeficitOutCents}
                rule={<RuleNote facts={facts} state={state} rules={data.rules} />}
              />
            </div>
          ) : (
            issues.length === 0 && (
              <EmptyState icon={ScaleIcon} title={t.status.notSettled} description={t.noneYet} />
            )
          )}
        </>
      )}

      <section aria-labelledby="settlement-history" className="grid gap-3">
        <h3 id="settlement-history" className="font-heading text-lg font-semibold">
          {t.historyTitle}
        </h3>
        <SettlementHistory rows={data.history} />
      </section>

      <ApproveDialog
        state={server}
        local={local}
        participants={participants}
        onRetry={askServer}
        onOpenChange={(open) => {
          if (open) return;
          setServer(null);
        }}
      />
      <VoidDialog
        open={unlocking !== null}
        onOpenChange={(open) => {
          if (!open) setUnlocking(null);
        }}
        title={t.unlockTitle}
        description={t.unlockDescription}
        confirmLabel={t.unlockConfirm}
        onConfirm={async (reason) => {
          if (!unlocking) return;
          try {
            await repositories.settlements.unlock(unlocking, reason);
            toast.success(t.unlockedDone);
          } catch (error) {
            toast.error(serverErrorMessage(error));
          }
          setUnlocking(null);
        }}
      />
    </div>
  );
}

/** The net profit: a loss is signed and toned; a period that earned nothing is plain. */
function NetFigure({ cents }: { cents: number }) {
  return <Money cents={cents} tone={cents < 0 ? 'loss' : cents > 0 ? 'profit' : undefined} />;
}
