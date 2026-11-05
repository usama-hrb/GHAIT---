'use client';

import { TriangleAlertIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { messages } from '@/i18n';
import type { PartnerExitPlan } from '@/local-db';
import { DateText, formatDate, Money } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Textarea } from '@/shared/ui/textarea';
import {
  type ExitChoices,
  type ExitFacts,
  ownershipAfter,
  ownershipSharesOf,
  profitSharesOf,
  reviewOf,
  splitAfter,
  splitBefore,
  transferOf,
} from './partner-exit-model';
import { formatBp } from './partner-exit-panels';
import { ShareList } from './rule-shares';

const t = messages.partners.exit;

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="grid gap-1.5">{children}</dd>
    </div>
  );
}

/** Before, paid now and what stays owed: the three figures of a payment, side by side. */
function Figures({
  openingCents,
  paidCents,
  remainingCents,
}: {
  openingCents: number;
  paidCents: number;
  remainingCents: number;
}) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div className="grid gap-0.5">
        <dt className="text-xs text-muted-foreground">{t.review.before}</dt>
        <dd className="font-medium">
          <Money cents={openingCents} />
        </dd>
      </div>
      <div className="grid gap-0.5">
        <dt className="text-xs text-muted-foreground">{t.review.paid}</dt>
        <dd className="font-medium">
          <Money cents={paidCents} tone={paidCents > 0 ? 'profit' : undefined} />
        </dd>
      </div>
      <div className="grid gap-0.5">
        <dt className="text-xs text-muted-foreground">{t.review.remains}</dt>
        <dd className="font-medium">
          <Money cents={remainingCents} tone={remainingCents > 0 ? 'debt' : undefined} />
        </dd>
      </div>
    </dl>
  );
}

/**
 * The last look before the exit is confirmed: in plain words what is paid now, what stays owed,
 * who takes over, and what does not change. Reads the same choices the device will be given.
 */
export function ExitReviewView({
  plan,
  facts,
  choices,
  note,
  onNoteChange,
  stale,
  error,
}: {
  plan: PartnerExitPlan;
  facts: ExitFacts;
  choices: ExitChoices;
  note: string;
  onNoteChange: (note: string) => void;
  /** The figures moved since the review opened: confirming is off until the owner goes back. */
  stale: boolean;
  /** Why the last attempt failed, in words. */
  error: string | null;
}) {
  const noteId = useId();
  const review = reviewOf(facts, choices);
  const names = new Map(plan.partners.map((partner) => [partner.id, partner.name]));
  const labels = {
    owner: messages.partners.owner,
    shop: messages.partners.splitRules.shop,
    partner: (partnerId: string) =>
      names.get(partnerId) ?? messages.partners.splitRules.unknownPartner,
  };
  const nameOf = (key: string): string =>
    key === 'owner'
      ? messages.partners.owner
      : key === 'shop'
        ? messages.partners.splitRules.shop
        : (names.get(key.slice('partner:'.length)) ?? messages.partners.splitRules.unknownPartner);
  const standing =
    facts.exitedOn > facts.today ? t.leaving(formatDate(facts.exitedOn, 'medium')) : t.former;

  const handedOwnership =
    facts.ownershipBp > 0 ? transferOf(choices.ownership, facts.ownershipBp).parts : [];
  const handedProfit = facts.sharesProfit ? transferOf(choices.profitShare, 10_000) : null;
  const after = facts.sharesProfit
    ? splitAfter(plan, facts, profitSharesOf(choices.profitShare), labels)
    : null;
  const before = splitBefore(plan, facts, labels);
  const ownShare = before?.find((share) => share.key === `partner:${plan.partner.id}`);
  const ownershipRows = ownershipAfter(
    plan,
    ownershipSharesOf(choices.ownership, plan),
    (id, isOwner) => (isOwner ? messages.partners.owner : (names.get(id) ?? '')),
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="font-heading text-lg font-semibold">{t.review.title(plan.partner.name)}</h3>
        <p className="text-sm text-muted-foreground">{t.review.intro}</p>
      </div>

      {stale && (
        <Alert variant="destructive" role="alert">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription>{t.review.stale}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription className="grid gap-1">
            <p>{t.review.failed}</p>
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      )}

      <dl className="rounded-xl border bg-card px-3 sm:px-4">
        <Line label={t.review.leaving}>
          <p className="font-medium">
            <DateText value={facts.exitedOn} format="long" />
          </p>
          <p className="text-sm text-muted-foreground">
            {t.review.becomes}: {standing}
          </p>
        </Line>
        <Line label={t.review.profit}>
          <Figures {...review.profit} />
        </Line>
        <Line label={t.review.capital}>
          <Figures {...review.capital} />
        </Line>
        <Line label={t.review.ownership}>
          {facts.ownershipBp > 0 ? (
            <>
              <p>{t.review.ownershipChange(formatBp(facts.ownershipBp), formatBp(0))}</p>
              <p className="text-sm text-muted-foreground">
                {t.review.handedTo}:{' '}
                {handedOwnership.map(({ to, bp }) => `${nameOf(to)} ${formatBp(bp)}`).join(' · ')}
              </p>
              <ShareList shares={ownershipRows} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.transfer.nothing}</p>
          )}
        </Line>
        <Line label={t.review.profitSharing}>
          {facts.sharesProfit ? (
            <>
              <p>
                {t.review.profitSharingChange(
                  ownShare ? `${String(ownShare.permille / 10)}%` : '0%',
                  formatDate(facts.shareFrom ?? facts.ruleFrom, 'medium'),
                )}
              </p>
              {handedProfit && handedProfit.parts.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t.review.handedTo}:{' '}
                  {handedProfit.parts
                    .map(({ to, bp }) => `${nameOf(to)} ${formatBp(bp)}`)
                    .join(' · ')}
                </p>
              )}
              {after && <ShareList shares={after} />}
              <p className="text-sm text-muted-foreground">
                {t.review.firstPeriod(formatDate(`${review.firstPeriodWithoutThem}-01`, 'month'))}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t.review.profitSharingKept}</p>
          )}
        </Line>
        <Line label={t.other.title}>
          {facts.profit.undrawnCents < 0 || facts.stillShared ? (
            <ul className="grid gap-1.5 text-sm">
              {facts.profit.undrawnCents < 0 && (
                <li>
                  {t.other.drewAhead} <Money cents={-facts.profit.undrawnCents} tone="debt" />
                </li>
              )}
              {facts.stillShared && <li>{t.other.stillShared}</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t.review.otherNone}</p>
          )}
        </Line>
      </dl>

      <div className="grid gap-2 rounded-xl bg-muted p-3 sm:grid-cols-2 sm:p-4">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-muted-foreground">{t.review.total}</span>
          <Money cents={review.paidCents} className="text-lg font-semibold" />
        </p>
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-muted-foreground">{t.review.totalRemaining}</span>
          <Money
            cents={review.remainingCents}
            tone={review.remainingCents > 0 ? 'debt' : undefined}
            className="text-lg font-semibold"
          />
        </p>
      </div>

      <div className="grid gap-1 rounded-xl border p-3 sm:p-4">
        <h4 className="font-medium">{t.review.unchangedTitle}</h4>
        <p className="text-sm text-muted-foreground">{t.review.unchanged}</p>
      </div>

      <Field>
        <FieldLabel htmlFor={noteId}>
          {t.review.note}
          <span className="text-muted-foreground"> ({t.review.optional})</span>
        </FieldLabel>
        <Textarea
          id={noteId}
          rows={2}
          maxLength={1000}
          placeholder={t.review.notePlaceholder}
          value={note}
          onChange={(event) => {
            onNoteChange(event.target.value);
          }}
        />
      </Field>
    </div>
  );
}
