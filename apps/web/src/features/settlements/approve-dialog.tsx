'use client';

import type { SettlementPreview } from '@fabric/contracts';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { ApiError, ReadOnlyError, useRepositories } from '@/local-db';
import { DateAr } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Breakdown } from './breakdown';

const t = messages.settlements;

export type ServerPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: SettlementPreview }
  | { status: 'error'; message: string };

/** The message for a failed server call: the rule it broke, or that the server is out of reach. */
export function serverErrorMessage(error: unknown): string {
  if (error instanceof ReadOnlyError) return messages.auth.readOnly;
  if (error instanceof ApiError) {
    const issue = error.issues.find((candidate) => t.issues[candidate.message]);
    if (issue) return t.issues[issue.message] ?? t.serverError;
  }
  return t.serverError;
}

/**
 * Approving a settlement: the server's figures (every device's records), the lock that follows,
 * and a confirmation. `local` is this device's preview, to say when they differ.
 */
export function ApproveDialog({
  state,
  local,
  onOpenChange,
  onRetry,
}: {
  state: ServerPreviewState | null;
  local: SettlementPreview | null;
  onOpenChange: (open: boolean) => void;
  /** Fetch the server's preview again (after the records changed). */
  onRetry: () => void;
}) {
  const repositories = useRepositories();
  const preview = state?.status === 'ready' ? state.preview : null;
  const differs =
    preview !== null &&
    local !== null &&
    JSON.stringify(preview.breakdown) !== JSON.stringify(local.breakdown);

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.confirmTitle}</DialogTitle>
          <DialogDescription>{t.confirmDescription}</DialogDescription>
        </DialogHeader>
        {state?.status === 'loading' && (
          <p className="text-muted-foreground" role="status">
            {t.loadingServer}
          </p>
        )}
        {state?.status === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        {preview && (
          <div className="grid gap-3">
            <p>
              {t.period}: <DateAr value={preview.periodStart} /> –{' '}
              <DateAr value={preview.periodEnd} />
            </p>
            <Breakdown lines={preview.breakdown} />
            {differs && (
              <Alert>
                <AlertDescription>{t.differs}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {messages.forms.cancel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!preview}
            onClick={() => {
              if (!preview) return;
              repositories.settlements
                .approve(preview.periodEnd, preview.breakdown)
                .then(() => {
                  toast.success(t.approved);
                  onOpenChange(false);
                })
                .catch((error: unknown) => {
                  toast.error(serverErrorMessage(error));
                  if (error instanceof ApiError && error.status === 409) onRetry();
                });
            }}
          >
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
