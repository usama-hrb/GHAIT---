'use client';

import { TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type PartnerView, useRepositories } from '@/local-db';
import { VoidDialog } from '@/shared/brand';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { failureText, issueTextsOf } from './people-errors';

const t = messages.partners.detail;

/**
 * Removing a partner (S19). Nothing is erased: the partner is cancelled with a reason and stays in
 * the books as removed. A partner who took part in anything stays, and the dialog says what holds
 * them before it asks for a reason. It is saved on the device first and reaches the server through
 * the outbox, which makes the same check again. The owner is never offered this.
 */
export function RemovePartnerDialog({
  view,
  onClose,
  onRemoved,
}: {
  view: PartnerView;
  onClose: () => void;
  /** Called once the partner is removed (the partner's own page goes back to the list). */
  onRemoved?: () => void;
}) {
  const repositories = useRepositories();
  const blocked = view.removal.length > 0;

  return (
    <VoidDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.removeTitle}
      description={t.removeDescription}
      confirmLabel={t.remove}
      confirmDisabled={blocked}
      onConfirm={async (reason) => {
        try {
          await repositories.partners.remove(view.partner.id, reason);
        } catch (error) {
          // The dialog stays open: the reason typed is kept and the text says what stops it.
          toast.error(failureText(error));
          return;
        }
        toast.success(t.removed, { description: messages.forms.saved });
        onClose();
        onRemoved?.();
      }}
    >
      <div className="rounded-lg border bg-muted p-3 text-sm font-medium">
        <bdi>{view.partner.name}</bdi>
      </div>
      {blocked && (
        <Alert variant="destructive" role="alert">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription className="grid gap-1">
            <p>{t.removeBlocked}</p>
            <ul className="grid list-disc gap-1 ps-4">
              {issueTextsOf(view.removal).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </VoidDialog>
  );
}
