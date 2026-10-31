'use client';

import Link from 'next/link';
import { useState } from 'react';
import { messages } from '@/i18n';
import { type PartnerView, useLiveQuery, useRepositories } from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { type MoneyMoveKind, MoneyMoveDialog, PartnersForm } from './partner-dialogs';

const t = messages.partners;

function Figure({
  label,
  cents,
  tone,
}: {
  label: string;
  cents: number;
  tone?: 'debt' | 'profit' | 'capital';
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <Money cents={cents} tone={tone} />
      </dd>
    </div>
  );
}

/**
 * The partners (SPEC §6, §7, §8.4, BUILD_PROMPTS 4.2): their ownership, capital and undrawn
 * profit, the shop's money according to the records, and the money moves. Set up once.
 */
export function PartnersScreen() {
  const repositories = useRepositories();
  const [move, setMove] = useState<{ kind: MoneyMoveKind; partner: PartnerView } | null>(null);
  const [editing, setEditing] = useState(false);
  const data = useLiveQuery(async () => {
    const [partners, cash, pulled] = await Promise.all([
      repositories.partners.list(),
      repositories.partners.cash(),
      repositories.maintenance.pulledOnce(),
    ]);
    return { partners, cash, pulled };
  }, [repositories]);

  if (data === undefined) return <LoadingState />;
  const [owner, partner] = data.partners;

  // A new device shows the set-up only once it has the shop's data: the partners may exist.
  if ((!owner || !partner) && !data.pulled) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <OfflineNotice />
        <LoadingState variant="spinner" label={t.waitingForSync} />
      </div>
    );
  }

  if (!owner || !partner) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <OfflineNotice />
        <h2 className="font-heading text-xl font-semibold">{t.setupTitle}</h2>
        <p className="text-muted-foreground">{t.setupDescription}</p>
        <div className="rounded-xl border bg-card p-4">
          <PartnersForm />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <OfflineNotice />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-semibold">{t.title}</h2>
        <Button
          variant="outline"
          onClick={() => {
            setEditing(true);
          }}
        >
          {t.edit}
        </Button>
      </div>

      <section aria-label={t.cash} className="grid gap-1 rounded-xl border bg-card p-4">
        <h3 className="font-heading font-semibold">{t.cash}</h3>
        <p className="text-2xl font-semibold">
          <Money cents={data.cash} />
        </p>
        <p className="text-sm text-muted-foreground">{t.cashHint}</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {[owner, partner].map((view) => (
          <section
            key={view.partner.id}
            aria-label={view.partner.name}
            className="grid content-start gap-3 rounded-xl border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-lg font-semibold">{view.partner.name}</h3>
              <Badge variant="secondary">{view.partner.isOwner ? t.owner : t.partner}</Badge>
              <span className="text-sm text-muted-foreground">
                {t.ownership} <bdi data-num>{view.partner.ownershipBp / 100}%</bdi>
              </span>
            </div>
            <dl className="grid gap-1">
              <Figure label={t.capital} cents={view.account.capitalCents} tone="capital" />
              <Figure
                label={t.undrawn}
                cents={view.account.undrawnCents}
                tone={view.account.undrawnCents < 0 ? 'debt' : 'profit'}
              />
              <Figure label={t.draws} cents={view.account.drawsCents} />
            </dl>
            <div className="flex flex-wrap gap-2">
              {(['contribution', 'draw', 'withdrawal'] as const).map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setMove({ kind, partner: view });
                  }}
                >
                  {kind === 'contribution'
                    ? t.contribution
                    : kind === 'draw'
                      ? t.draw
                      : t.withdrawal}
                </Button>
              ))}
              <Button asChild size="sm" variant="link">
                <Link href={`/partners/view?id=${view.partner.id}`}>{t.account}</Link>
              </Button>
            </div>
          </section>
        ))}
      </div>

      <MoneyMoveDialog
        key={move ? `${move.kind} ${move.partner.partner.id}` : 'closed'}
        move={move}
        onOpenChange={(open) => {
          if (!open) setMove(null);
        }}
      />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.edit}</DialogTitle>
            <DialogDescription>{t.setupDescription}</DialogDescription>
          </DialogHeader>
          <PartnersForm
            current={{ owner, partner }}
            onSaved={() => {
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
