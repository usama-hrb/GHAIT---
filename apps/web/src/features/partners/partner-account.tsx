'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { isLockedOn, LockedBadge, useLockedThrough } from '@/features/settlements';

const t = messages.partners;

/**
 * One partner's account (/partners/view?id=…, BUILD_PROMPTS 4.2): capital and where it came
 * from, retained profit, shares, draws and what is left undrawn; every move, voidable with a reason.
 */
export function PartnerAccountScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const [voiding, setVoiding] = useState<{ kind: 'move' | 'draw'; id: string } | null>(null);
  const lockedThrough = useLockedThrough();
  const view = useLiveQuery(
    async () => (await repositories.partners.account(id)) ?? null,
    [repositories, id],
  );

  if (view === undefined) return <LoadingState />;
  if (view === null) {
    return (
      <EmptyState
        title={t.notFound}
        action={
          <Button asChild variant="outline">
            <Link href="/partners">{t.back}</Link>
          </Button>
        }
      />
    );
  }
  const { partner, account } = view;
  const figures = [
    [t.capital, account.capitalCents],
    [t.contributions, account.contributionsCents],
    [t.retained, account.retainedProfitCents],
    [t.withdrawals, account.withdrawalsCents],
    [t.shares, account.sharesCents],
    [t.draws, account.drawsCents],
  ] as const;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href="/partners">{t.back}</Link>
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">{partner.name}</h2>
        <Badge variant="secondary">{partner.isOwner ? t.owner : t.partner}</Badge>
      </div>
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
                {view.moves.map((move) => (
                  <TableRow
                    key={move.id}
                    className={move.voidedAt ? 'text-muted-foreground line-through' : undefined}
                  >
                    <TableCell>
                      <DateText value={move.date} />
                    </TableCell>
                    <TableCell>{t.types[move.type]}</TableCell>
                    <TableCell className="text-end">
                      <Money cents={move.amountCents} />
                    </TableCell>
                    <TableCell className="max-sm:hidden">{move.note}</TableCell>
                    <TableCell className="text-end">
                      {move.voidedAt === null &&
                        move.type !== 'retained_profit' &&
                        (isLockedOn(move.date, lockedThrough) ? (
                          <LockedBadge lockedThrough={lockedThrough} />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setVoiding({ kind: 'move', id: move.id });
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
                      {draw.voidedAt === null &&
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

      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={t.voidTitle}
        description={t.voidDescription}
        onConfirm={async (reason) => {
          if (voiding?.kind === 'move')
            await repositories.partners.voidCapitalMove(voiding.id, reason);
          if (voiding?.kind === 'draw') await repositories.partners.voidDraw(voiding.id, reason);
          setVoiding(null);
          toast.success(t.voided, { description: messages.forms.saved });
        }}
      />
    </div>
  );
}
