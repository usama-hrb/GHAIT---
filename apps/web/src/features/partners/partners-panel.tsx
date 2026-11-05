'use client';

import { useState } from 'react';
import { messages } from '@/i18n';
import { type PartnerView, useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState } from '@/shared/brand';
import { Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { OwnershipDialog } from './ownership-dialog';
import { PartnerCard } from './partner-card';
import { PartnerDialog } from './partner-dialog';
import { MoneyMoveDialog, type MoneyMoveKind, PartnersSetupForm } from './partner-dialogs';
import { profitOutlookOf } from './people-view';
import { ProfitSplitRules } from './profit-split-rules';
import { useCanManage } from './use-can-manage';

const t = messages.partners;

/**
 * The partners tab (SPEC §6, §7, §8.4): everyone who owns part of the shop, with their share of
 * the shop and of the profit, their capital and what is left to draw; the shop's money by the
 * records; the profit split rules. Set up once, then partners are added one at a time.
 */
export function PartnersPanel() {
  const repositories = useRepositories();
  const canManage = useCanManage();
  const [move, setMove] = useState<{ kind: MoneyMoveKind; partner: PartnerView } | null>(null);
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const data = useLiveQuery(async () => {
    const [partners, rules, cash, pulled] = await Promise.all([
      repositories.partners.list(),
      repositories.settlements.splitRules(),
      repositories.partners.cash(),
      repositories.maintenance.pulledOnce(),
    ]);
    return { partners, rules, cash, pulled };
  }, [repositories]);

  if (data === undefined) return <LoadingState />;
  const { partners, rules } = data;

  // A new device shows the set-up only once it has the shop's data: the partners may exist.
  if (partners.length === 0 && !data.pulled) {
    return <LoadingState variant="spinner" label={t.waitingForSync} />;
  }

  if (partners.length === 0) {
    return (
      <div className="grid max-w-2xl gap-4">
        <h3 className="font-heading text-lg font-semibold">{t.setupTitle}</h3>
        <p className="text-muted-foreground">{t.setupDescription}</p>
        <div className="rounded-xl border bg-card p-4">
          <PartnersSetupForm />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <section aria-label={t.cash} className="grid gap-1 rounded-xl border bg-card p-4">
        <h3 className="font-heading font-semibold">{t.cash}</h3>
        <p className="text-2xl font-semibold">
          <Money cents={data.cash} />
        </p>
        <p className="text-sm text-muted-foreground">{t.cashHint}</p>
      </section>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-heading text-lg font-semibold">{t.partnersHeading}</h3>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSharing(true);
                }}
              >
                {t.ownershipShares}
              </Button>
              <Button
                variant="accent"
                onClick={() => {
                  setAdding(true);
                }}
              >
                {t.addPartner}
              </Button>
            </div>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {partners.map((view) => (
            <PartnerCard
              key={view.partner.id}
              view={view}
              outlook={profitOutlookOf(
                rules,
                view.partner.isOwner
                  ? { kind: 'owner' }
                  : { kind: 'partner', partnerId: view.partner.id },
              )}
              canManage={canManage}
              onMove={(kind) => {
                setMove({ kind, partner: view });
              }}
            />
          ))}
        </div>
      </div>

      <ProfitSplitRules partners={partners} />

      <MoneyMoveDialog
        key={move ? `${move.kind} ${move.partner.partner.id}` : 'closed'}
        move={move}
        onOpenChange={(open) => {
          if (!open) setMove(null);
        }}
      />
      <PartnerDialog
        key={adding ? 'add' : 'closed'}
        target={adding ? 'add' : null}
        partners={partners}
        onOpenChange={(open) => {
          if (!open) setAdding(false);
        }}
      />
      <OwnershipDialog
        key={sharing ? 'open' : 'closed'}
        open={sharing}
        partners={partners}
        onOpenChange={setSharing}
      />
    </div>
  );
}
