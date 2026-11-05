'use client';

import type { SettlementPreview } from '@fabric/contracts';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { ApiError, ReadOnlyError, useRepositories } from '@/local-db';
import { formatDate, Money } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { periodLabel } from './period-label';
import {
  adjustmentsTotalOf,
  distributionOf,
  factsOfPreview,
  groupedBreakdown,
  type Participant,
} from './settlement-facts';

const t = messages.settlements;

export type ServerPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: SettlementPreview }
  | { status: 'error'; message: string };

/** The message for a failed server call: the rule it broke, or that the server is out of reach. */
export function serverErrorMessage(error: unknown): string {
  if (error instanceof ReadOnlyError) return messages.auth.readOnly;
  if (error instanceof ApiError) {
    const issue = error.issues.find((candidate) => t.issues[candidate.message]);
    if (issue) return t.issues[issue.message] ?? t.serverError;
  }
  return t.serverError;
}

function Row({
  label,
  children,
  strong,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd className={strong ? 'font-heading text-lg font-semibold' : undefined}>{children}</dd>
    </div>
  );
}

/**
 * What the owner is about to lock: the period, the net profit and the adjustments behind it, the
 * three shares, and what approving does. Shown from the server's figures (every device's
 * records). Nothing counts as approved until the server answers: the button waits for it, a
 * failure stays in the dialog, and a settlement that changed since the preview asks for a fresh
 * one. `local` is this device's preview, only to say that the two differ.
 */
export function ApproveDialog({
  state,
  local,
  participants,
  onOpenChange,
  onRetry,
}: {
  state: ServerPreviewState | null;
  local: SettlementPreview | null;
  participants: readonly Participant[];
  onOpenChange: (open: boolean) => void;
  /** Fetch the server's preview again (after the records changed). */
  onRetry: () => void;
}) {
  const repositories = useRepositories();
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = state?.status === 'ready' ? state.preview : null;
  const differs =
    preview !== null &&
    local !== null &&
    JSON.stringify(preview.breakdown) !== JSON.stringify(local.breakdown);
  const facts = preview ? factsOfPreview(preview) : null;
  const grouped = facts ? groupedBreakdown(facts.breakdown) : null;
  const distribution = facts ? distributionOf(facts, participants) : null;

  function close() {
    setError(null);
    onOpenChange(false);
  }

  function approve() {
    if (!preview || approving) return;
    setApproving(true);
    setError(null);
    repositories.settlements
      .approve(preview.periodEnd, preview.breakdown)
      .then(() => {
        toast.success(t.approved);
        close();
      })
      .catch((caught: unknown) => {
        setError(serverErrorMessage(caught));
        if (caught instanceof ApiError && caught.status === 409) onRetry();
      })
      .finally(() => {
        setApproving(false);
      });
  }

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        // Closing mid-approval would hide the answer the owner is waiting for.
        if (approving) return;
        if (open) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.confirmTitle}</DialogTitle>
          <DialogDescription>{t.confirmDescription}</DialogDescription>
        </DialogHeader>
        {state?.status === 'loading' && (
          <p className="text-muted-foreground" role="status">
            {t.loadingServer}
          </p>
        )}
        {state?.status === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        {preview && facts && grouped && distribution && (
          <div className="grid gap-4">
            <dl className="grid gap-1.5">
              <Row label={t.period}>
                <span className="font-medium">
                  {periodLabel(preview.periodStart, preview.periodEnd)}
                </span>
              </Row>
            </dl>

            <div className="grid gap-3 border-t pt-3">
              {grouped.groups.map((group) => (
                <div key={group.key} className="grid gap-1.5">
                  {group.key !== 'profit' && (
                    <p className="text-xs font-medium text-muted-foreground">
                      {t.breakdown.groups[group.key]}
                    </p>
                  )}
                  <dl className="grid gap-1.5">
                    {group.lines.map((line) => (
                      <Row key={line.key} label={t.lines[line.key]}>
                        <Money cents={line.cents} tone={line.cents < 0 ? 'loss' : undefined} />
                      </Row>
                    ))}
                  </dl>
                </div>
              ))}
              <dl className="grid gap-1.5 border-t pt-2">
                <Row label={t.adjustmentsTotal}>
                  <Money
                    cents={adjustmentsTotalOf(grouped)}
                    tone={adjustmentsTotalOf(grouped) < 0 ? 'loss' : undefined}
                  />
                </Row>
                <Row label={t.lines.net_profit} strong>
                  <Money
                    cents={facts.netProfitCents}
                    tone={
                      facts.netProfitCents < 0
                        ? 'loss'
                        : facts.netProfitCents > 0
                          ? 'profit'
                          : undefined
                    }
                  />
                </Row>
              </dl>
              {!grouped.reconciles && (
                <Alert variant="destructive">
                  <AlertDescription>{t.breakdown.mismatch}</AlertDescription>
                </Alert>
              )}
            </div>

            {distribution.distributes ? (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-sm font-medium">{t.distribution.title}</p>
                <dl className="grid gap-1.5">
                  {distribution.allocations.map((allocation) => (
                    <div key={allocation.id} className="grid gap-1">
                      <Row
                        label={
                          allocation.kind === 'shop' ? (
                            t.lines.shop_share
                          ) : (
                            <>
                              <bdi>
                                {allocation.participant?.name ?? t.distribution.unknownPartner}
                              </bdi>{' '}
                              ({t.distribution[allocation.kind]})
                            </>
                          )
                        }
                      >
                        <Money
                          cents={allocation.amountCents}
                          tone={allocation.kind === 'shop' ? 'capital' : undefined}
                        />
                      </Row>
                      {allocation.kind === 'shop' &&
                        allocation.capital.map((move) => (
                          <div
                            key={move.partnerId}
                            className="flex justify-between gap-3 ps-3 text-sm text-muted-foreground"
                          >
                            <span className="min-w-0 break-words">
                              {t.distribution.capitalTo}:{' '}
                              <bdi>{move.participant?.name ?? t.distribution.unknownPartner}</bdi>
                            </span>
                            <Money cents={move.amountCents} tone="capital" />
                          </div>
                        ))}
                    </div>
                  ))}
                </dl>
                {!distribution.reconciles && (
                  <Alert variant="destructive">
                    <AlertDescription>{t.distribution.mismatch}</AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="grid gap-1.5 border-t pt-3">
                <p>{t.distribution.none}</p>
                {facts.carryDeficitOutCents > 0 && (
                  <dl>
                    <Row label={t.distribution.deficitOut}>
                      <Money cents={facts.carryDeficitOutCents} tone="debt" />
                    </Row>
                  </dl>
                )}
              </div>
            )}

            {differs && (
              <Alert>
                <AlertDescription>{t.differs}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-1.5 rounded-lg bg-muted/60 p-3 text-sm">
              <p>{t.confirmLock(formatDate(preview.periodEnd, 'medium'))}</p>
              <p className="text-muted-foreground">{t.confirmSync}</p>
              <p className="text-muted-foreground">{t.confirmNotPayment}</p>
            </div>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="gap-2 sm:flex-wrap">
          {preview && (
            <Button type="button" variant="ghost" disabled={approving} onClick={onRetry}>
              {t.refresh}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={approving} onClick={close}>
            {messages.forms.cancel}
          </Button>
          <Button type="button" variant="accent" disabled={!preview || approving} onClick={approve}>
            {approving ? t.approving : t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
