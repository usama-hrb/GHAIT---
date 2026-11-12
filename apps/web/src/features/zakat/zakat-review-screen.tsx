'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useGuardedQuery, useRepositories, useSession, type ZakatReview } from '@/local-db';
import { ErrorState, LoadingState, OfflineNotice, useOnlineStatus } from '@/shared/brand';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Button } from '@/shared/ui/button';
import { Progress } from '@/shared/ui/progress';
import {
  BaseStep,
  ConfirmStep,
  HawlStep,
  InventoryStep,
  NisabStep,
  ResultStep,
  SettingsStep,
} from './review-steps';
import { zakatErrorText } from './zakat-errors';
import { REVIEW_STAGES, type ReviewStage } from './zakat-model';
import { BackToZakat } from './zakat-ui';

const t = messages.zakat;

/** What identifies the figures a person is about to confirm: when it changes, they confirm again. */
function figuresKeyOf(review: ZakatReview): string {
  const { estimate } = review;
  return [
    estimate?.fields.baseCents,
    estimate?.fields.zakatDueCents,
    review.latest?.id,
    review.items.map((item) => item.key).join('|'),
  ].join(':');
}

function StepBody({
  stage,
  review,
  isOwner,
  online,
  saving,
  onSave,
}: {
  stage: ReviewStage;
  review: ZakatReview;
  isOwner: boolean;
  online: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  switch (stage) {
    case 'settings':
      return (
        <SettingsStep
          options={review.options}
          items={review.items}
          canChange={isOwner}
          online={online}
        />
      );
    case 'base':
      return <BaseStep review={review} />;
    case 'inventory':
      return <InventoryStep review={review} />;
    case 'nisab':
      return <NisabStep review={review} />;
    case 'hawl':
      return <HawlStep review={review} />;
    case 'result':
      return <ResultStep review={review} />;
    case 'confirm':
      return (
        <ConfirmStep
          key={figuresKeyOf(review)}
          review={review}
          isOwner={isOwner}
          saving={saving}
          onSave={onSave}
        />
      );
  }
}

/**
 * The seven steps, one at a time: settings, base, inventory, nisab, hawl, result, and the review
 * that confirms. Moving between them records nothing. Only the last step can save the report, with
 * the figures the person saw: if the records move meanwhile, the save is refused and the screen
 * shows the new figures to be confirmed again.
 */
function ReviewFlow({ review }: { review: ZakatReview }) {
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const online = useOnlineStatus();
  const isOwner = useSession().user?.role === 'owner';
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const movedRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  // A step change moves focus to the new step's title, so a keyboard or a screen reader follows.
  useEffect(() => {
    if (movedRef.current) headingRef.current?.focus();
  }, [index]);

  const total = REVIEW_STAGES.length;
  const stage = REVIEW_STAGES[index] ?? REVIEW_STAGES[0];
  const { estimate } = review;

  function go(to: number) {
    movedRef.current = true;
    setIndex(Math.min(Math.max(to, 0), total - 1));
  }

  function save() {
    if (estimate === null || saving) return;
    setSaving(true);
    repositories.zakat
      .save({
        baseCents: estimate.fields.baseCents,
        zakatDueCents: estimate.fields.zakatDueCents,
      })
      .then((id) => {
        toast.success(t.confirm.saved, { description: messages.forms.saved });
        navigation.push(`/zakat/view?id=${id}`);
      })
      .catch((error: unknown) => {
        toast.error(zakatErrorText(error));
        setSaving(false);
      });
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <p className="text-sm font-medium text-muted-foreground">
          {t.review.stepOf(index + 1, total)}
        </p>
        <Progress value={Math.round(((index + 1) * 100) / total)} aria-label={t.review.progress} />
      </div>

      <section aria-labelledby={headingId} className="grid gap-4">
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-lg font-semibold outline-none"
        >
          {t.review.steps[stage]}
        </h3>
        <StepBody
          stage={stage}
          review={review}
          isOwner={isOwner}
          online={online}
          saving={saving}
          onSave={save}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {index > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              go(index - 1);
            }}
          >
            <ChevronLeftIcon className="rtl:rotate-180" data-icon="inline-start" />
            {t.review.back}
          </Button>
        )}
        {index < total - 1 && (
          <Button
            type="button"
            variant="accent"
            className="ms-auto"
            onClick={() => {
              go(index + 1);
            }}
          >
            {t.review.next}
            <ChevronRightIcon className="rtl:rotate-180" data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The guided Zakat review (/zakat/review): reads this device's records and the settings, takes the
 * person through the calculation step by step and, for the owner, ends in the one confirmation
 * that saves the report. Opening it, and every step, records nothing.
 */
export function ZakatReviewScreen() {
  const repositories = useRepositories();
  const { result, retry } = useGuardedQuery(() => repositories.zakat.review(), [repositories]);
  return (
    <div className="@container mx-auto grid w-full max-w-3xl gap-5">
      <OfflineNotice />
      <BackToZakat />
      <header className="grid gap-1">
        <h2 className="font-heading text-xl font-semibold">{t.review.title}</h2>
        <p className="max-w-prose text-muted-foreground">{t.review.intro}</p>
      </header>
      {result === undefined ? (
        <LoadingState rows={3} />
      ) : !result.ok ? (
        <ErrorState onRetry={retry} />
      ) : (
        <ReviewFlow review={result.value} />
      )}
    </div>
  );
}
