'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState, OfflineNotice, useOnlineStatus, VoidDialog } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { ApproveDialog, type ServerPreviewState, serverErrorMessage } from './approve-dialog';
import { Breakdown } from './breakdown';
import { SplitRules } from './split-rules';

const t = messages.settlements;

/**
 * Monthly settlement (SPEC §8, §14.10, BUILD_PROMPTS 4.3): pick the period's end, see its full
 * breakdown (this device's records, offline too), approve it on the server, which locks the
 * period; unlock the latest one with a reason. The split rules live here too.
 */
export function SettlementsScreen() {
  const id = useId();
  const repositories = useRepositories();
  const online = useOnlineStatus();
  const [chosenEnd, setChosenEnd] = useState<string | null>(null);
  const [server, setServer] = useState<ServerPreviewState | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const [proposed, lockedThrough, history] = await Promise.all([
      repositories.settlements.nextPeriodEnd(),
      repositories.settlements.lockedThrough(),
      repositories.settlements.history(),
    ]);
    return { proposed, lockedThrough, history };
  }, [repositories]);
  const periodEnd = chosenEnd ?? data?.proposed ?? '';
  const preview = useLiveQuery(
    async () => (periodEnd === '' ? null : repositories.settlements.preview(periodEnd)),
    [repositories, periodEnd],
  );

  if (data === undefined) return <LoadingState />;
  const latest = data.history.find((settlement) => settlement.voidedAt === null);
  const local = preview?.ok ? preview.preview : null;

  function askServer() {
    setServer({ status: 'loading' });
    repositories.settlements
      .serverPreview(periodEnd)
      .then((result) => {
        setServer({ status: 'ready', preview: result });
      })
      .catch((error: unknown) => {
        setServer({ status: 'error', message: serverErrorMessage(error) });
      });
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <OfflineNotice />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
        <p className="text-sm text-muted-foreground">
          {data.lockedThrough ? (
            <>
              {t.lockedThrough} <DateText value={data.lockedThrough} />
            </>
          ) : (
            t.noneYet
          )}
        </p>
      </div>

      <section aria-label={t.newTitle} className="grid gap-4 rounded-xl border bg-card p-4">
        <h3 className="font-heading font-semibold">{t.newTitle}</h3>
        <Field className="max-w-56">
          <FieldLabel htmlFor={`${id}-end`}>{t.periodEnd}</FieldLabel>
          <Input
            id={`${id}-end`}
            type="date"
            value={periodEnd}
            onChange={(event) => {
              setChosenEnd(event.target.value);
            }}
          />
        </Field>
        {periodEnd === '' && <p className="text-muted-foreground">{t.nothingToSettle}</p>}
        {preview && !preview.ok && (
          <Alert>
            <AlertDescription>
              {preview.issues.map((issue) => t.issues[issue.message] ?? messages.forms.invalid)}
            </AlertDescription>
          </Alert>
        )}
        {local && (
          <div className="grid gap-3">
            <p>
              {t.period}: <DateText value={local.periodStart} /> –{' '}
              <DateText value={local.periodEnd} />
            </p>
            <Breakdown lines={local.breakdown} />
            <p className="text-sm text-muted-foreground">
              {t.weights}: {t.owner} <bdi data-num>{local.ownerWeight}</bdi> · {t.partner}{' '}
              <bdi data-num>{local.partnerWeight}</bdi> · {t.shop}{' '}
              <bdi data-num>{local.shopWeight}</bdi>
            </p>
            <p className="text-sm text-muted-foreground">{t.deviceFigures}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="accent" disabled={!online} onClick={askServer}>
                {t.approve}
              </Button>
              {!online && <span className="text-sm text-muted-foreground">{t.approveOffline}</span>}
            </div>
          </div>
        )}
      </section>

      <section aria-label={t.historyTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.historyTitle}</h3>
        {data.history.length === 0 ? (
          <p className="text-muted-foreground">{t.noneYet}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.period}</TableHead>
                  <TableHead className="text-end">{t.columns.net}</TableHead>
                  <TableHead>{t.columns.status}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.view}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((settlement) => (
                  <TableRow
                    key={settlement.id}
                    className={settlement.voidedAt ? 'text-muted-foreground' : undefined}
                  >
                    <TableCell>
                      <DateText value={settlement.periodStart} /> –{' '}
                      <DateText value={settlement.periodEnd} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money
                        cents={settlement.netProfitCents}
                        tone={settlement.netProfitCents < 0 ? 'loss' : 'profit'}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={settlement.voidedAt ? 'outline' : 'secondary'}>
                        {settlement.voidedAt ? t.unlocked : t.locked}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <span className="flex justify-end gap-1">
                        <Button asChild size="sm" variant="link">
                          <Link href={`/settlements/view?id=${settlement.id}`}>{t.view}</Link>
                        </Button>
                        {settlement.id === latest?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!online}
                            onClick={() => {
                              setUnlocking(settlement.id);
                            }}
                          >
                            {t.unlock}
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <SplitRules />

      <ApproveDialog
        state={server}
        local={local}
        onRetry={askServer}
        onOpenChange={(open) => {
          if (open) return;
          setServer(null);
          setChosenEnd(null);
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
