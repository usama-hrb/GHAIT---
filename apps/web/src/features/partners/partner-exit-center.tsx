'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type PartnerExitPlan, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState } from '@/shared/brand';
import { formatDate, Money } from '@/shared/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import {
  canReview,
  type ExitChoices,
  type ExitFacts,
  factsOf,
  firstNeeding,
  firstPeriodWithoutThem,
  departureIssue,
  inputOf,
  noChoices,
  ownershipAfter,
  ownershipSharesOf,
  partnerKey,
  payOf,
  profitSharesOf,
  type SectionKey,
  type SectionState,
  sectionStates,
  SECTIONS,
  splitAfter,
  splitBefore,
  transferOf,
} from './partner-exit-model';
import {
  Fact,
  formatBp,
  PayPanel,
  type RecipientOption,
  SectionRow,
  TransferEditor,
} from './partner-exit-panels';
import { ExitReviewView } from './partner-exit-review';
import { failureText } from './people-errors';
import { ShareList } from './rule-shares';

const t = messages.partners.exit;

/** The figures the review was opened on: if they move, confirming waits until the owner looks again. */
interface Seen {
  undrawnCents: number;
  capitalCents: number;
  ownershipBp: number;
}

const seenOf = (plan: PartnerExitPlan): Seen => ({
  undrawnCents: plan.account.undrawnCents,
  capitalCents: plan.account.capitalCents,
  ownershipBp: plan.partner.ownershipBp,
});

/** A tile of the overview: one figure, what it is, and where it comes from. */
function Tile({
  label,
  hint,
  children,
}: {
  label: string;
  hint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-0.5 rounded-lg border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{children}</dd>
      <dd className="text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

/**
 * The Partner Exit Center (S20): one guided place to let a partner leave without erasing
 * anything. It shows what they are owed and what they hold, asks what to do about each part, and
 * only then, after a review in plain words, writes everything in one step on the device. Choosing
 * only prepares an action; no payment, no hand-over and no exit is recorded before "Complete
 * partner exit". Whatever is not paid stays on their account, to pay at any time.
 */
export function PartnerExitCenter({
  partnerId,
  onClose,
}: {
  partnerId: string;
  onClose: () => void;
}) {
  const repositories = useRepositories();
  const found = useLiveQuery(
    async () => ({ plan: await repositories.partners.exitPlan(partnerId) }),
    [repositories, partnerId],
  );
  const [exitedOn, setExitedOn] = useState<string | null>(null);
  const [choices, setChoices] = useState<ExitChoices>(noChoices);
  const [open, setOpen] = useState<SectionKey | null | 'auto'>('auto');
  const [step, setStep] = useState<'plan' | 'review'>('plan');
  const [seen, setSeen] = useState<Seen | null>(null);
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second tap, or a second click, while the first is being written does nothing.
  const submittingRef = useRef(false);

  const plan = found?.plan;
  const day = exitedOn ?? plan?.today ?? '';
  const facts = useMemo(() => (plan ? factsOf(plan, day) : null), [plan, day]);

  function close() {
    if (!busy) onClose();
  }

  let body: React.ReactNode;
  let footer: React.ReactNode = null;

  if (found === undefined || !plan || !facts) {
    body = found === undefined ? <LoadingState /> : <EmptyState title={t.notFound} />;
  } else {
    const states = sectionStates(facts, choices);
    const dateIssue = departureIssue(day, plan.partner.startDate);
    const needing = SECTIONS.filter((key) => states[key] === 'needs').length;
    const stale = seen !== null && JSON.stringify(seen) !== JSON.stringify(seenOf(plan));

    const startReview = () => {
      setAttempted(true);
      if (dateIssue !== null) return;
      if (!canReview(states)) {
        setOpen(firstNeeding(states));
        return;
      }
      setSeen(seenOf(plan));
      setError(null);
      setStep('review');
    };

    const complete = async () => {
      if (submittingRef.current || stale) return;
      const input = inputOf(plan, facts, choices, {
        note,
        profitReason: t.profitReason,
        capitalNote: t.capital.reason,
      });
      if (!input) return;
      submittingRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await repositories.partners.completeExit(input);
      } catch (failure) {
        // Nothing was written: the choices and the note stay, and the text says why.
        submittingRef.current = false;
        setBusy(false);
        setError(failureText(failure));
        toast.error(failureText(failure));
        return;
      }
      toast.success(t.review.done, { description: messages.forms.saved });
      setBusy(false);
      onClose();
    };

    if (step === 'review') {
      body = (
        <ExitReviewView
          plan={plan}
          facts={facts}
          choices={choices}
          note={note}
          onNoteChange={setNote}
          stale={stale}
          error={error}
        />
      );
      footer = (
        <>
          <span className="hidden sm:block" />
          <div className="flex gap-2 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setStep('plan');
                setSeen(null);
                setError(null);
              }}
            >
              {t.footer.back}
            </Button>
            <Button
              type="button"
              variant="accent"
              disabled={busy || stale}
              onClick={() => {
                void complete();
              }}
            >
              {busy ? t.footer.completing : t.footer.complete}
            </Button>
          </div>
        </>
      );
    } else {
      const effectiveOpen = open === 'auto' ? firstNeeding(states) : open;
      body = (
        <PlanView
          plan={plan}
          facts={facts}
          choices={choices}
          states={states}
          open={effectiveOpen}
          attempted={attempted}
          dateIssue={dateIssue}
          day={day}
          onDay={setExitedOn}
          onChoices={(next) => {
            setChoices((current) => ({ ...current, ...next }));
          }}
          onToggle={(key) => {
            setOpen(effectiveOpen === key ? null : key);
          }}
        />
      );
      footer = (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {needing > 0 ? t.footer.needs(needing) : t.footer.ready}
          </p>
          <div className="flex gap-2 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
            <Button type="button" variant="outline" onClick={close}>
              {messages.forms.cancel}
            </Button>
            <Button type="button" variant="accent" onClick={startReview}>
              {t.footer.review}
            </Button>
          </div>
        </>
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="top-0 start-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 rtl:translate-x-0 sm:top-1/2 sm:start-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:rtl:translate-x-1/2 lg:max-w-4xl"
      >
        <DialogHeader className="gap-1 border-b p-4 pe-12">
          <DialogTitle className="font-heading text-lg font-semibold wrap-anywhere">
            {plan ? <bdi>{t.title(plan.partner.name)}</bdi> : messages.partners.exit.start}
          </DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{body}</div>
        {footer && (
          <div className="grid gap-2 border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-4">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What the plan view says about each part, one line. */
function PaySummary({
  kind,
  state,
  owedCents,
  choice,
}: {
  kind: 'profit' | 'capital';
  state: SectionState;
  owedCents: number;
  choice: ExitChoices['profit'];
}) {
  const copy = kind === 'profit' ? t.profit : t.capital;
  if (state === 'done') return <>{copy.allPaid}</>;
  if (state === 'na') return <>{copy.none}</>;
  if (state === 'needs') {
    return (
      <>
        {t.owed}: <Money cents={owedCents} />
      </>
    );
  }
  const paid = payOf(choice, owedCents).cents;
  return (
    <>
      {paid > 0 && (
        <>
          {t.paidNow}: <Money cents={paid} />
          {paid < owedCents && ' · '}
        </>
      )}
      {paid < owedCents && (
        <>
          {t.staysOnAccount}: <Money cents={owedCents - paid} />
        </>
      )}
    </>
  );
}

/** The whole plan on one screen: the overview, the date and the four parts. */
function PlanView({
  plan,
  facts,
  choices,
  states,
  open,
  attempted,
  dateIssue,
  day,
  onDay,
  onChoices,
  onToggle,
}: {
  plan: PartnerExitPlan;
  facts: ExitFacts;
  choices: ExitChoices;
  states: Record<SectionKey, SectionState>;
  open: SectionKey | null;
  attempted: boolean;
  dateIssue: ReturnType<typeof departureIssue>;
  day: string;
  onDay: (day: string) => void;
  onChoices: (change: Partial<ExitChoices>) => void;
  onToggle: (key: SectionKey) => void;
}) {
  const { account, partner } = plan;
  const names = new Map(plan.partners.map((person) => [person.id, person.name]));
  const labels = {
    owner: messages.partners.owner,
    shop: messages.partners.splitRules.shop,
    partner: (id: string) => names.get(id) ?? messages.partners.splitRules.unknownPartner,
  };
  // Whoever stays can take a part: the owner and the other partners; the shop takes profit only.
  const staying = plan.partners.filter(
    (person) => person.id !== partner.id && !person.isOwner && person.exitedOn == null,
  );
  const ownershipOptions: RecipientOption[] = [
    { key: 'owner', label: messages.partners.owner },
    ...staying.map((person) => ({ key: partnerKey(person.id), label: person.name })),
  ];
  const profitOptions: RecipientOption[] = [
    ...ownershipOptions,
    { key: 'shop', label: messages.partners.splitRules.shop },
  ];
  const before = splitBefore(plan, facts, labels);
  const ownShare = before?.find((share) => share.key === partnerKey(partner.id));
  const ownPercent = ownShare ? `${String(ownShare.permille / 10)}%` : '0%';
  const afterProfit = facts.sharesProfit
    ? splitAfter(plan, facts, profitSharesOf(choices.profitShare), labels)
    : null;
  const ownershipRows =
    facts.ownershipBp > 0 && transferOf(choices.ownership, facts.ownershipBp).chosen
      ? ownershipAfter(plan, ownershipSharesOf(choices.ownership, plan), (id, isOwner) =>
          isOwner ? messages.partners.owner : (names.get(id) ?? ''),
        )
      : null;
  const month = formatDate(`${firstPeriodWithoutThem(facts.ruleFrom)}-01`, 'month');
  const putIn = facts.capital.contributionsCents + facts.capital.retainedCents;

  const dateError =
    dateIssue === 'empty'
      ? t.date.empty
      : dateIssue === 'before_start'
        ? t.date.beforeStart(formatDate(partner.startDate ?? '', 'medium'))
        : null;

  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={t.overview.ownership} hint={t.overview.ownershipHint}>
          <bdi data-num>{formatBp(partner.ownershipBp)}</bdi>
        </Tile>
        <Tile label={t.overview.profitShare} hint={t.overview.profitShareHint}>
          <bdi data-num>{ownPercent}</bdi>
        </Tile>
        <Tile
          label={t.overview.capital}
          hint={
            <>
              {t.capital.putIn} <Money cents={putIn} /> · {t.capital.takenOut}{' '}
              <Money cents={facts.capital.withdrawnCents} />
            </>
          }
        >
          <Money cents={account.capitalCents} tone="capital" />
        </Tile>
        <Tile
          label={t.overview.profit}
          hint={
            <>
              {t.profit.allocated} <Money cents={facts.profit.allocatedCents} /> · {t.profit.drawn}{' '}
              <Money cents={facts.profit.drawnCents} />
            </>
          }
        >
          <Money cents={account.undrawnCents} tone={account.undrawnCents < 0 ? 'debt' : 'profit'} />
        </Tile>
      </dl>

      <Field data-invalid={(attempted && dateError !== null) || undefined}>
        <FieldLabel htmlFor="exit-date">{t.date.label}</FieldLabel>
        <Input
          id="exit-date"
          type="date"
          className="sm:max-w-56"
          value={day}
          min={partner.startDate ?? undefined}
          aria-invalid={dateError !== null || undefined}
          onChange={(event) => {
            onDay(event.target.value);
          }}
        />
        {dateError !== null ? (
          <FieldError>{dateError}</FieldError>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.date.hint(formatDate(facts.ruleFrom, 'medium'), month)}
            {day <= facts.today && ` ${t.date.past}`}
          </p>
        )}
      </Field>

      <div className="grid gap-3">
        <SectionRow
          title={t.profit.title}
          state={states.profit}
          open={open === 'profit'}
          onToggle={() => {
            onToggle('profit');
          }}
          summary={
            <PaySummary
              kind="profit"
              state={states.profit}
              owedCents={facts.profit.undrawnCents}
              choice={choices.profit}
            />
          }
        >
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <Fact label={t.profit.allocated}>
              <Money cents={facts.profit.allocatedCents} />
            </Fact>
            <Fact label={t.profit.drawn}>
              <Money cents={facts.profit.drawnCents} />
            </Fact>
            <Fact label={t.stillToPay}>
              <Money cents={facts.profit.undrawnCents} tone="profit" />
            </Fact>
          </dl>
          <p className="text-sm text-muted-foreground">{t.profit.note}</p>
          <PayPanel
            kind="profit"
            owedCents={facts.profit.undrawnCents}
            choice={choices.profit}
            today={facts.today}
            lockedThrough={plan.lockedThrough}
            showErrors={attempted}
            onChange={(profit) => {
              onChoices({ profit });
            }}
          />
        </SectionRow>

        <SectionRow
          title={t.capital.title}
          state={states.capital}
          open={open === 'capital'}
          onToggle={() => {
            onToggle('capital');
          }}
          summary={
            <PaySummary
              kind="capital"
              state={states.capital}
              owedCents={facts.capital.balanceCents}
              choice={choices.capital}
            />
          }
        >
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <Fact label={t.capital.putIn}>
              <Money cents={putIn} />
            </Fact>
            <Fact label={t.capital.takenOut}>
              <Money cents={facts.capital.withdrawnCents} />
            </Fact>
            <Fact label={t.stillToPay}>
              <Money cents={facts.capital.balanceCents} tone="capital" />
            </Fact>
          </dl>
          <p className="text-sm text-muted-foreground">{t.capital.note}</p>
          <PayPanel
            kind="capital"
            owedCents={facts.capital.balanceCents}
            choice={choices.capital}
            today={facts.today}
            lockedThrough={plan.lockedThrough}
            showErrors={attempted}
            onChange={(capital) => {
              onChoices({ capital });
            }}
          />
        </SectionRow>

        <SectionRow
          title={t.transfer.title}
          state={states.transfer}
          open={open === 'transfer'}
          onToggle={() => {
            onToggle('transfer');
          }}
          summary={
            states.transfer === 'ready'
              ? t.transfer.summaryDone
              : states.transfer === 'needs'
                ? [
                    facts.ownershipBp > 0 &&
                      `${t.overview.ownership} ${formatBp(facts.ownershipBp)}`,
                    facts.sharesProfit && `${t.overview.profitShare} ${ownPercent}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t.transfer.nothing
          }
        >
          <p className="text-sm text-muted-foreground">{t.transfer.explain}</p>
          <div className="grid gap-6 md:grid-cols-2">
            {facts.ownershipBp > 0 && (
              <TransferEditor
                heading={t.transfer.ownershipHeading(formatBp(facts.ownershipBp))}
                totalBp={facts.ownershipBp}
                options={ownershipOptions}
                choice={choices.ownership}
                allowSpread={false}
                rowsHint={t.transfer.ownershipRowsHint}
                showErrors={attempted}
                onChange={(ownership) => {
                  onChoices({ ownership });
                }}
              >
                {ownershipRows && (
                  <div className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
                    <p className="text-muted-foreground">{t.transfer.afterOwnership}</p>
                    <ShareList shares={ownershipRows} />
                  </div>
                )}
              </TransferEditor>
            )}
            {facts.sharesProfit && (
              <TransferEditor
                heading={t.transfer.profitHeading(ownPercent)}
                totalBp={10_000}
                options={profitOptions}
                choice={choices.profitShare}
                allowSpread
                rowsHint={t.transfer.profitRowsHint}
                showErrors={attempted}
                onChange={(profitShare) => {
                  onChoices({ profitShare });
                }}
              >
                <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
                  {before && (
                    <div className="grid gap-1">
                      <p className="text-muted-foreground">
                        {t.transfer.splitBefore(
                          formatDate(facts.shareFrom ?? facts.ruleFrom, 'medium'),
                        )}
                      </p>
                      <ShareList shares={before} />
                    </div>
                  )}
                  {afterProfit && (
                    <div className="grid gap-1">
                      <p className="text-muted-foreground">
                        {t.transfer.splitAfter(
                          formatDate(facts.shareFrom ?? facts.ruleFrom, 'medium'),
                        )}
                      </p>
                      <ShareList shares={afterProfit} />
                    </div>
                  )}
                </div>
              </TransferEditor>
            )}
          </div>
        </SectionRow>

        <SectionRow
          title={t.other.title}
          state={states.other}
          open={open === 'other'}
          onToggle={() => {
            onToggle('other');
          }}
          summary={states.other === 'na' ? t.other.none : t.other.summary}
        >
          <ul className="grid gap-2 text-sm">
            {facts.profit.undrawnCents < 0 && (
              <li className="flex flex-wrap items-baseline gap-x-2">
                <span>{t.other.drewAhead}</span>
                <Money cents={-facts.profit.undrawnCents} tone="debt" className="font-medium" />
              </li>
            )}
            {facts.stillShared && <li>{t.other.stillShared}</li>}
          </ul>
        </SectionRow>
      </div>
    </div>
  );
}

/** A badge for a partner who has left or is leaving; nothing for one who takes part. */
export function ExitStandingBadge({
  standing,
  exitedOn,
}: {
  standing: 'active' | 'leaving' | 'former';
  exitedOn: string | null | undefined;
}) {
  if (standing === 'active') return null;
  return (
    <Badge variant="outline">
      {standing === 'former' || !exitedOn ? t.former : t.leaving(formatDate(exitedOn, 'medium'))}
    </Badge>
  );
}
