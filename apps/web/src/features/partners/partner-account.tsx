'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { isLockedOn, LockedBadge, periodLabel, useLockedThrough } from '@/features/settlements';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { PartnerDialog } from './partner-dialog';
import { ProfitShareText } from './partner-card';
import { type MoneyMoveKind, MoneyMoveDialog } from './partner-dialogs';
import { failureText } from './people-errors';
import { profitOutlookOf } from './people-view';
import { ProfitShareDialog } from './profit-share-dialog';
import { useCanManage } from './use-can-manage';

const t = messages.partners;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end wrap-anywhere">{children}</dd>
    </div>
  );
}

/**
 * One partner's account (/settings/partners/view?id=…, BUILD_PROMPTS 4.2): capital and where it came
 * from, retained profit, shares, draws and what is left undrawn; every move, voidable with a reason;
 * what each settlement allocated to them; their details and profit share.
 */
export function PartnerAccountScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const canManage = useCanManage();
  const [voiding, setVoiding] = useState<{ kind: 'move' | 'draw'; id: string } | null>(null);
  const [move, setMove] = useState<MoneyMoveKind | null>(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const lockedThrough = useLockedThrough();
  const data = useLiveQuery(async () => {
    const [view, partners, rules] = await Promise.all([
      repositories.partners.account(id),
      repositories.partners.list(),
      repositories.settlements.splitRules(),
    ]);
    return { view: view ?? null, partners, rules };
  }, [repositories, id]);

  if (data === undefined) return <LoadingState />;
  const { view, partners, rules } = data;
  if (view === null) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/settings/partners">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { partner, account, status } = view;
  const outlook = profitOutlookOf(
    rules,
    partner.isOwner ? { kind: 'owner' } : { kind: 'partner', partnerId: partner.id },
  );
  const figures = [
    [t.capital, account.capitalCents],
    [t.contributions, account.contributionsCents],
    [t.retained, account.retainedProfitCents],
    [t.withdrawals, account.withdrawalsCents],
    [t.shares, account.sharesCents],
    [t.draws, account.drawsCents],
  ] as const;

  return (
    <div className="grid w-full max-w-4xl gap-5">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/settings/partners">{t.back}</Link>
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-semibold wrap-anywhere">
              <bdi>{partner.name}</bdi>
            </h2>
            <Badge variant="secondary">{partner.isOwner ? t.owner : t.partner}</Badge>
            <Badge variant={status === 'active' ? 'success' : 'outline'}>{t.status[status]}</Badge>
          </div>
          {partner.title && (
            <p className="text-muted-foreground wrap-anywhere">
              <bdi>{partner.title}</bdi>
            </p>
          )}
          <p className="flex flex-wrap items-start gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              {t.ownership}{' '}
              <bdi data-num className="font-medium text-foreground">
                {partner.ownershipBp / 100}%
              </bdi>
            </span>
            <span className="flex items-start gap-1.5">
              {t.profitShare}
              <ProfitShareText outlook={outlook} className="justify-items-start text-foreground" />
            </span>
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(true);
              }}
            >
              {t.editDetails}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSharing(true);
              }}
            >
              {t.changeProfitShare}
            </Button>
          </div>
        )}
      </header>

      <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 sm:grid-cols-2">
        {figures.map(([label, cents]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>
              <Money cents={cents} />
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-2 font-semibold">
          <dt>{t.undrawn}</dt>
          <dd>
            <Money
              cents={account.undrawnCents}
              tone={account.undrawnCents < 0 ? 'debt' : 'profit'}
            />
          </dd>
        </div>
      </dl>
      <p className="-mt-3 text-sm text-muted-foreground">{t.detail.undrawnHint}</p>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          {(['contribution', 'draw', 'withdrawal'] as const).map((kind) => (
            <Button
              key={kind}
              variant="outline"
              onClick={() => {
                setMove(kind);
              }}
            >
              {kind === 'contribution' ? t.contribution : kind === 'draw' ? t.draw : t.withdrawal}
            </Button>
          ))}
        </div>
      )}

      <section aria-label={t.movesTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.movesTitle}</h3>
        {view.moves.length === 0 ? (
          <p className="text-muted-foreground">{t.noMoves}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.date}</TableHead>
                  <TableHead>{t.columns.type}</TableHead>
                  <TableHead className="text-end">{t.columns.amount}</TableHead>
                  <TableHead className="max-sm:hidden">{t.columns.note}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.voidAction}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.moves.map((entry) => (
                  <TableRow
                    key={entry.id}
                    className={entry.voidedAt ? 'text-muted-foreground line-through' : undefined}
                  >
                    <TableCell>
                      <DateText value={entry.date} />
                    </TableCell>
                    <TableCell>{t.types[entry.type]}</TableCell>
                    <TableCell className="text-end">
                      <Money cents={entry.amountCents} />
                    </TableCell>
                    <TableCell className="max-sm:hidden">{entry.note}</TableCell>
                    <TableCell className="text-end">
                      {canManage &&
                        entry.voidedAt === null &&
                        entry.type !== 'retained_profit' &&
                        (isLockedOn(entry.date, lockedThrough) ? (
                          <LockedBadge lockedThrough={lockedThrough} />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setVoiding({ kind: 'move', id: entry.id });
                            }}
                          >
                            {t.voidAction}
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-label={t.drawsTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.drawsTitle}</h3>
        {view.draws.length === 0 ? (
          <p className="text-muted-foreground">{t.noDraws}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.date}</TableHead>
                  <TableHead className="text-end">{t.columns.amount}</TableHead>
                  <TableHead>{t.fields.reason}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.voidAction}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.draws.map((draw) => (
                  <TableRow
                    key={draw.id}
                    className={draw.voidedAt ? 'text-muted-foreground line-through' : undefined}
                  >
                    <TableCell>
                      <DateText value={draw.date} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={draw.amountCents} />
                    </TableCell>
                    <TableCell>{draw.reason}</TableCell>
                    <TableCell className="text-end">
                      {canManage &&
                        draw.voidedAt === null &&
                        (isLockedOn(draw.date, lockedThrough) ? (
                          <LockedBadge lockedThrough={lockedThrough} />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setVoiding({ kind: 'draw', id: draw.id });
                            }}
                          >
                            {t.voidAction}
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-label={t.detail.allocationsTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.detail.allocationsTitle}</h3>
        {view.allocations.length === 0 ? (
          <p className="text-muted-foreground">{t.detail.noAllocations}</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.detail.columns.period}</TableHead>
                  <TableHead className="text-end">{t.detail.columns.allocated}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.detail.columns.settlement}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.allocations.map(({ share, settlement }) => (
                  <TableRow key={share.id}>
                    <TableCell>
                      {settlement ? (
                        periodLabel(settlement.periodStart, settlement.periodEnd)
                      ) : (
                        <span className="text-muted-foreground">{t.detail.none}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={share.amountCents} tone="profit" />
                    </TableCell>
                    <TableCell className="text-end">
                      {settlement && (
                        <Button asChild size="sm" variant="link">
                          <Link href={`/settlements/view?id=${settlement.id}`}>
                            {t.detail.viewSettlement}
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-sm text-muted-foreground">{t.detail.allocationsHint}</p>
      </section>

      <section aria-label={t.detail.detailsTitle} className="grid gap-2">
        <h3 className="font-heading font-semibold">{t.detail.detailsTitle}</h3>
        <dl className="grid gap-2 rounded-lg border bg-card p-4 text-sm">
          <Detail label={t.form.startDate}>
            {partner.startDate ? <DateText value={partner.startDate} /> : t.detail.none}
          </Detail>
          <Detail label={t.form.title}>
            {partner.title ? <bdi>{partner.title}</bdi> : t.detail.none}
          </Detail>
          <Detail label={t.form.phone}>
            {partner.phone ? (
              <bdi dir="ltr" data-num>
                {partner.phone}
              </bdi>
            ) : (
              t.detail.none
            )}
          </Detail>
          {partner.notes && (
            <Detail label={t.form.notes}>
              <bdi>{partner.notes}</bdi>
            </Detail>
          )}
        </dl>
      </section>

      <MoneyMoveDialog
        key={move ? `${move} ${partner.id}` : 'closed'}
        move={move ? { kind: move, partner: view } : null}
        onOpenChange={(open) => {
          if (!open) setMove(null);
        }}
      />
      <PartnerDialog
        key={editing ? 'edit' : 'closed'}
        target={editing ? view : null}
        partners={partners}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      />
      <ProfitShareDialog
        key={sharing ? 'share' : 'closed'}
        target={sharing ? view : null}
        partners={partners}
        rules={rules}
        onOpenChange={(open) => {
          if (!open) setSharing(false);
        }}
      />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={t.voidTitle}
        description={t.voidDescription}
        onConfirm={async (reason) => {
          try {
            if (voiding?.kind === 'move')
              await repositories.partners.voidCapitalMove(voiding.id, reason);
            if (voiding?.kind === 'draw') await repositories.partners.voidDraw(voiding.id, reason);
          } catch (error) {
            toast.error(failureText(error));
            return;
          }
          setVoiding(null);
          toast.success(t.voided, { description: messages.forms.saved });
        }}
      />
    </div>
  );
}
