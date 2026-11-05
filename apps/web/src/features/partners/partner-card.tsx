'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import type { PartnerView } from '@/local-db';
import { formatDate, Money } from '@/shared/format';
import { formatPermille } from '@/shared/lib/percent';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import type { MoneyMoveKind } from './partner-dialogs';
import type { ProfitOutlook } from './people-view';

const t = messages.partners;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

/** What a person gets of the profit, now and from the next rule: "33.3%", "25% from 1 Dec". */
export function ProfitShareText({
  outlook,
  className = 'justify-items-end',
}: {
  outlook: ProfitOutlook;
  className?: string;
}) {
  return (
    <span className={`grid ${className}`}>
      <span data-num className="font-medium">
        <bdi>
          {outlook.nowPermille > 0 ? formatPermille(outlook.nowPermille) : t.profitShareNone}
        </bdi>
      </span>
      {outlook.next && (
        <span className="text-xs text-muted-foreground">
          {t.profitShareFrom(
            formatPermille(outlook.next.permille),
            formatDate(outlook.next.from, 'medium'),
          )}
        </span>
      )}
    </span>
  );
}

/**
 * One person of the shop: who they are, their part of the shop and of the profit, and their
 * money. The money moves are the owner's; everyone with access can open the account.
 */
export function PartnerCard({
  view,
  outlook,
  canManage,
  onMove,
}: {
  view: PartnerView;
  outlook: ProfitOutlook;
  canManage: boolean;
  onMove: (kind: MoneyMoveKind) => void;
}) {
  const { partner, account, status } = view;
  return (
    <section
      aria-label={partner.name}
      className="grid content-start gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <h4 className="font-heading text-lg font-semibold wrap-anywhere">
            <bdi>{partner.name}</bdi>
          </h4>
          {partner.title && (
            <p className="text-sm text-muted-foreground wrap-anywhere">
              <bdi>{partner.title}</bdi>
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge variant="secondary">{partner.isOwner ? t.owner : t.partner}</Badge>
          <Badge variant={status === 'active' ? 'success' : 'outline'}>{t.status[status]}</Badge>
        </div>
      </div>

      <dl className="grid gap-1.5 text-sm">
        <Row label={t.ownership}>
          <bdi data-num className="font-medium">
            {partner.ownershipBp / 100}%
          </bdi>
        </Row>
        <Row label={t.profitShare}>
          <ProfitShareText outlook={outlook} />
        </Row>
        <Row label={t.capital}>
          <Money cents={account.capitalCents} tone="capital" />
        </Row>
        <Row label={t.undrawn}>
          <Money cents={account.undrawnCents} tone={account.undrawnCents < 0 ? 'debt' : 'profit'} />
        </Row>
        <Row label={t.draws}>
          <Money cents={account.drawsCents} />
        </Row>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {canManage &&
          (['contribution', 'draw', 'withdrawal'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              onClick={() => {
                onMove(kind);
              }}
            >
              {kind === 'contribution' ? t.contribution : kind === 'draw' ? t.draw : t.withdrawal}
            </Button>
          ))}
        <Button asChild size="sm" variant="link">
          <Link href={`/settings/partners/view?id=${partner.id}`}>{t.account}</Link>
        </Button>
      </div>
    </section>
  );
}
