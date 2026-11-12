'use client';

import type { MetalPrice, ZakatReviewItem } from '@fabric/contracts';
import { CircleCheckIcon, CircleMinusIcon, OctagonAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId, useState } from 'react';
import { messages } from '@/i18n';
import type { ZakatOptions, ZakatReview } from '@/local-db';
import { DateText, Money } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Field, FieldLabel } from '@/shared/ui/field';
import { BaseCategories } from './base-categories';
import { GoodsTable } from './goods-table';
import { ReviewItemList } from './review-items';
import { attentionItemsOf, itemsForStage, saveBlocksOf, zakatRateText } from './zakat-model';
import { DualDate, Fact } from './zakat-ui';

/**
 * The bodies of the seven steps of the guided review. Each one reads the review it is given and
 * shows it: the figures come from the calculation (`ZakatReview`) and are never worked out here.
 * Nothing in these steps records anything; only the last one can save, and only the owner can.
 */

const intro = 'max-w-prose text-muted-foreground';

/** Where a step has nothing to show because an item stops the calculation: what stops it. */
export function BlockedNotice({ items }: { items: readonly ZakatReviewItem[] }) {
  const t = messages.zakat.review;
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3 rounded-lg border border-s-4 border-s-destructive bg-card p-3">
        <OctagonAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="grid gap-1">
          <p className="font-medium">{t.blockedTitle}</p>
          <p className="text-sm text-muted-foreground">{t.blockedDescription}</p>
        </div>
      </div>
      <ReviewItemList items={items.filter((item) => item.severity === 'blocking')} />
    </div>
  );
}

// ── 1 · Settings ─────────────────────────────────────────────────────────────────────────────────

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 rounded-lg border bg-card p-3">
      <h4 className="font-heading font-semibold">{title}</h4>
      <dl className="grid divide-y">{children}</dl>
    </section>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-0.5 py-2 first:pt-0 last:pb-0 @md:grid-cols-[minmax(0,13rem)_1fr] @md:gap-x-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">
        {children}
        <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{hint}</span>
      </dd>
    </div>
  );
}

function PriceValue({ price }: { price: MetalPrice | null }) {
  const t = messages.zakat;
  if (price === null) {
    return <span className="text-muted-foreground">{t.settingsStep.notSet}</span>;
  }
  return (
    <>
      <Money cents={price.pricePerGramCents} /> {t.perGram} (<DateText value={price.date} />)
    </>
  );
}

/**
 * The settings the calculation follows, grouped as in the methodology settings, each with what it
 * means. They are read here and never changed silently: changing one is a visit to the settings.
 */
export function SettingsStep({
  options,
  items,
  canChange,
  online,
}: {
  options: ZakatOptions;
  items: readonly ZakatReviewItem[];
  canChange: boolean;
  online: boolean;
}) {
  const t = messages.zakat;
  const groups = t.settings.groups;
  return (
    <div className="grid gap-4">
      <p className={intro}>{t.settingsStep.intro}</p>
      <ReviewItemList items={itemsForStage(items, 'settings')} />
      <SettingGroup title={groups.hawl.title}>
        <SettingRow label={t.fields.hawlStart} hint={t.hints.hawlStart}>
          {options.hawlStart === null ? (
            <span className="text-muted-foreground">{t.settingsStep.notSet}</span>
          ) : (
            <DualDate value={options.hawlStart} />
          )}
        </SettingRow>
        <SettingRow label={t.fields.reminderDays} hint={t.hints.reminderDays}>
          {t.settingsStep.reminder(options.reminderDays)}
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={groups.methodology.title}>
        <SettingRow label={t.fields.merchant} hint={t.managingHint}>
          {t.managing}
        </SettingRow>
        <SettingRow label={t.fields.nisabMetal} hint={t.hints.nisabMetal}>
          {t.metals[options.nisabMetal]}
        </SettingRow>
        <SettingRow label={t.fields.valuation} hint={t.hints.valuation}>
          {t.valuations[options.goodsValuation]}
        </SettingRow>
        <SettingRow label={t.fields.doubtful} hint={t.hints.doubtful}>
          {options.includeDoubtfulDebts ? t.settingsStep.counted : t.settingsStep.notCounted}
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={groups.prices.title}>
        <SettingRow label={t.fields.goldPrice} hint={t.hints.price}>
          <PriceValue price={options.goldPrice} />
        </SettingRow>
        <SettingRow label={t.fields.silverPrice} hint={t.hints.price}>
          <PriceValue price={options.silverPrice} />
        </SettingRow>
      </SettingGroup>
      {canChange && (
        <div className="grid justify-items-start gap-1.5">
          <Button asChild variant="outline">
            <Link href="/zakat/settings">{t.settingsStep.change}</Link>
          </Button>
          {!online && (
            <p className="text-sm text-muted-foreground">{t.settingsStep.changeOffline}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 2 · Zakat base ───────────────────────────────────────────────────────────────────────────────

/** The base by category: what is added, what is taken off, what is left out and what is not kept. */
export function BaseStep({ review }: { review: ZakatReview }) {
  const t = messages.zakat.baseStep;
  const { estimate } = review;
  if (estimate === null) return <BlockedNotice items={review.items} />;
  return (
    <div className="grid gap-4">
      <p className={intro}>{t.intro}</p>
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{t.formula}</p>
      <BaseCategories
        categories={estimate.categories}
        breakdown={estimate.fields.breakdown}
        items={review.items}
        baseCents={estimate.fields.baseCents}
      />
    </div>
  );
}

// ── 3 · Inventory valuation ──────────────────────────────────────────────────────────────────────

/** Every batch and how it was valued, so the inventory figure in the base can be checked. */
export function InventoryStep({ review }: { review: ZakatReview }) {
  const t = messages.zakat;
  const { estimate } = review;
  if (estimate === null) return <BlockedNotice items={review.items} />;
  const { fields } = estimate;
  return (
    <div className="grid gap-4">
      <p className={intro}>{t.inventoryStep.intro}</p>
      <p className="text-sm">
        <span className="text-muted-foreground">{t.inventoryStep.valuation}: </span>
        <span className="font-medium">{t.valuations[fields.settings.goodsValuation]}</span>
      </p>
      <ReviewItemList items={itemsForStage(review.items, 'inventory')} />
      <GoodsTable
        goods={fields.breakdown.goods}
        valuation={fields.settings.goodsValuation}
        countedCents={fields.breakdown.goodsCents}
      />
    </div>
  );
}

// ── 4 · Nisab ────────────────────────────────────────────────────────────────────────────────────

/** The nisab: the metal, its weight and price, the threshold they give, and the base against it. */
export function NisabStep({ review }: { review: ZakatReview }) {
  const t = messages.zakat;
  const check = review.estimate?.nisab ?? null;
  if (check === null) return <BlockedNotice items={review.items} />;
  const rows = t.nisabStep.rows;
  const Icon = check.reached ? CircleCheckIcon : CircleMinusIcon;
  return (
    <div className="grid gap-4">
      <p className={intro}>{t.nisabStep.intro}</p>
      <ReviewItemList items={itemsForStage(review.items, 'nisab')} />
      <dl className="grid gap-2 @md:grid-cols-2">
        <Fact label={rows.metal}>{t.metals[check.metal]}</Fact>
        <Fact label={rows.weight}>{t.nisabStep.grams(check.grams)}</Fact>
        <Fact label={rows.price}>
          <Money cents={check.pricePerGramCents} /> {t.perGram}
        </Fact>
        <Fact label={rows.priceDate}>
          <DateText value={check.priceDate} />
        </Fact>
        <Fact label={rows.threshold}>
          <Money cents={check.thresholdCents} />
        </Fact>
        <Fact label={rows.base}>
          <Money cents={check.baseCents} />
        </Fact>
        <Fact label={rows.difference} className="@md:col-span-2">
          <Money cents={Math.abs(check.differenceCents)} />{' '}
          <span className="text-sm font-normal text-muted-foreground">
            {check.differenceCents >= 0 ? t.nisabStep.above : t.nisabStep.below}
          </span>
        </Fact>
      </dl>
      <p className="flex items-center gap-2 font-medium">
        <Icon
          className={check.reached ? 'size-5 text-success' : 'size-5 text-muted-foreground'}
          aria-hidden
        />
        {check.reached ? t.nisabStep.reached : t.nisabStep.notReached}
      </p>
      <p className="text-sm text-muted-foreground">{t.nisabStep.checkedOnce}</p>
    </div>
  );
}

// ── 5 · Hawl ─────────────────────────────────────────────────────────────────────────────────────

/** The hawl: where it began, the one this calculation is for, today, the next, and whether it has come. */
export function HawlStep({ review }: { review: ZakatReview }) {
  const t = messages.zakat;
  const { clock } = review;
  const completed = clock.last !== null;
  const none = <span className="text-muted-foreground">{t.hawlStep.none}</span>;
  const rows = t.hawlStep.rows;
  return (
    <div className="grid gap-4">
      <p className={intro}>{t.hawlStep.intro}</p>
      <ReviewItemList items={itemsForStage(review.items, 'hawl')} />
      <dl className="grid gap-2 @md:grid-cols-2">
        <Fact label={rows.start}>
          {clock.start === null ? none : <DualDate value={clock.start} />}
        </Fact>
        <Fact label={rows.hawl}>
          {clock.last === null ? none : <DualDate value={clock.last} />}
        </Fact>
        <Fact label={rows.today}>
          <DualDate value={review.today} />
        </Fact>
        <Fact label={rows.next}>
          {clock.next === null ? none : <DualDate value={clock.next} />}
        </Fact>
        <Fact label={rows.completed} className="@md:col-span-2">
          {completed ? t.hawlStep.yes : t.hawlStep.no}
        </Fact>
      </dl>
      <p className="font-medium">
        {completed ? t.hawlStep.completedNote : t.hawlStep.notCompletedNote}
      </p>
      <p className="text-sm text-muted-foreground">{t.hawlStep.calendarNote}</p>
    </div>
  );
}

// ── 6 · Result ───────────────────────────────────────────────────────────────────────────────────

/**
 * The result: the base against the nisab and the rate. The zakat is shown only once the hawl has
 * come: before that nothing is due, whatever the base is.
 */
export function ResultStep({ review }: { review: ZakatReview }) {
  const t = messages.zakat.resultStep;
  const { estimate, clock } = review;
  if (estimate === null) return <BlockedNotice items={review.items} />;
  const { fields } = estimate;
  const completed = clock.last !== null;
  const outcome = !completed
    ? t.outcomes.hawlNotCompleted
    : estimate.nisab.reached
      ? t.outcomes.due
      : t.outcomes.belowNisab;
  return (
    <div className="grid gap-4">
      <p className={intro}>{t.intro}</p>
      <dl className="grid gap-2 @md:grid-cols-2">
        <Fact label={t.rows.base}>
          <Money cents={fields.baseCents} />
        </Fact>
        <Fact label={t.rows.nisab}>
          <Money cents={fields.nisabCents} />
        </Fact>
        <Fact label={t.rows.rate}>{t.rate(zakatRateText())}</Fact>
        {completed && (
          <Fact label={t.rows.due}>
            <Money cents={fields.zakatDueCents} />
          </Fact>
        )}
      </dl>
      <p className="font-medium">{outcome}</p>
      {completed && <p className="text-sm text-muted-foreground">{t.estimate}</p>}
    </div>
  );
}

// ── 7 · Review and confirm ───────────────────────────────────────────────────────────────────────

/**
 * What will be saved and the one thing that saves it. The button is there only for the owner, only
 * once nothing blocks the report, and only after the figures (and the items marked for review, if
 * there are any) are acknowledged. Mount it again when the figures change, so a person never
 * confirms what they did not see: the acknowledgements start over.
 */
export function ConfirmStep({
  review,
  isOwner,
  saving,
  onSave,
}: {
  review: ZakatReview;
  isOwner: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const t = messages.zakat.confirm;
  const id = useId();
  const [figuresSeen, setFiguresSeen] = useState(false);
  const [itemsSeen, setItemsSeen] = useState(false);
  const { estimate, clock, latest } = review;
  const blocks = saveBlocksOf({ isOwner, review });
  const attention = attentionItemsOf(review.items);
  const completed = clock.last !== null;
  const canSave =
    estimate !== null &&
    blocks.length === 0 &&
    figuresSeen &&
    (attention.length === 0 || itemsSeen) &&
    !saving;
  return (
    <div className="grid gap-4">
      <p className={intro}>{t.intro}</p>
      {estimate !== null && (
        <dl className="grid gap-2 @md:grid-cols-2">
          <Fact label={t.rows.hawl}>
            {clock.last === null ? (
              <span className="text-muted-foreground">{messages.zakat.hawlStep.none}</span>
            ) : (
              <DualDate value={clock.last} />
            )}
          </Fact>
          <Fact label={t.rows.base}>
            <Money cents={estimate.fields.baseCents} />
          </Fact>
          <Fact label={t.rows.nisab}>
            <Money cents={estimate.fields.nisabCents} />
          </Fact>
          {completed && (
            <Fact label={t.rows.due}>
              <Money cents={estimate.fields.zakatDueCents} />
            </Fact>
          )}
        </dl>
      )}
      {estimate !== null && completed && estimate.fields.zakatDueCents <= 0 && (
        <p className="text-sm text-muted-foreground">{t.noneDueNote}</p>
      )}
      <p className="text-sm font-medium">{t.nothingRecorded}</p>

      {blocks.length > 0 && (
        <div
          role="status"
          className="grid gap-2 rounded-lg border border-s-4 border-s-warning bg-card p-3"
        >
          <p className="font-medium">{t.blockedTitle}</p>
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {blocks.map((block) => (
              <li key={block}>{t.blocks[block]}</li>
            ))}
          </ul>
          {blocks.includes('already_saved') && latest !== null && (
            <Button asChild variant="outline" className="justify-self-start">
              <Link href={`/zakat/view?id=${latest.id}`}>{t.viewSaved}</Link>
            </Button>
          )}
        </div>
      )}

      {blocks.length === 0 && (
        <>
          <ReviewItemList items={attention} />
          <div className="grid gap-3 rounded-lg border bg-card p-3">
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-figures`}
                checked={figuresSeen}
                onCheckedChange={(checked) => {
                  setFiguresSeen(checked === true);
                }}
              />
              <FieldLabel htmlFor={`${id}-figures`}>{t.acknowledgeFigures}</FieldLabel>
            </Field>
            {attention.length > 0 && (
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-items`}
                  checked={itemsSeen}
                  onCheckedChange={(checked) => {
                    setItemsSeen(checked === true);
                  }}
                />
                <FieldLabel htmlFor={`${id}-items`}>
                  {t.acknowledgeItems(attention.length)}
                </FieldLabel>
              </Field>
            )}
          </div>
          <div>
            <Button variant="accent" size="lg" disabled={!canSave} onClick={onSave}>
              {saving ? messages.forms.saving : t.save}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
