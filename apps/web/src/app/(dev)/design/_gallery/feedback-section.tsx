'use client';

import { CircleAlertIcon, InfoIcon, RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { designMessages as t } from '@/i18n/ar.design';
import { EmptyState, ErrorState, LoadingState } from '@/shared/brand';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Demo, Section } from './section';

export function FeedbackSection() {
  return (
    <Section id="feedback" title={t.sections.feedback}>
      <div className="grid gap-4 md:grid-cols-2">
        <Alert>
          <InfoIcon aria-hidden />
          <AlertTitle>{t.feedback.infoTitle}</AlertTitle>
          <AlertDescription>{t.feedback.infoBody}</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>{t.feedback.errorTitle}</AlertTitle>
          <AlertDescription>{t.feedback.errorBody}</AlertDescription>
        </Alert>
      </div>
      <Demo title={t.feedback.toastButton}>
        <Button
          variant="outline"
          onClick={() => {
            toast.success(t.feedback.toastSuccess);
          }}
        >
          {t.feedback.toastSuccess}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            toast.warning(t.feedback.toastWarning);
          }}
        >
          {t.feedback.toastWarning}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            toast.error(t.feedback.toastError, {
              action: {
                label: <RefreshCwIcon className="size-4" aria-hidden />,
                onClick: () => undefined,
              },
            });
          }}
        >
          {t.feedback.toastError}
        </Button>
      </Demo>
      <div className="grid gap-4 lg:grid-cols-3">
        <EmptyState
          title={t.feedback.emptyTitle}
          description={t.feedback.emptyBody}
          titleAs="h3"
          action={<Button variant="accent">{t.feedback.emptyAction}</Button>}
        />
        <ErrorState titleAs="h3" onRetry={() => undefined} />
        <div className="space-y-4">
          <LoadingState rows={3} />
          <LoadingState variant="spinner" />
        </div>
      </div>
    </Section>
  );
}
