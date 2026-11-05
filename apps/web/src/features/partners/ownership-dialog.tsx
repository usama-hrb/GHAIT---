'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type PartnerView, useRepositories } from '@/local-db';
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
import { OwnershipFields } from './ownership-fields';
import { failureText } from './people-errors';
import { draftOf, sharesTotal } from './people-view';

const t = messages.partners.ownershipFields;

/**
 * Who owns what part of the shop (S4): every person's percentage, saved together so the table
 * always adds up to exactly 100%. Nobody is removed: a partner who leaves owns 0%.
 */
export function OwnershipDialog({
  open,
  partners,
  onOpenChange,
}: {
  open: boolean;
  /** The owner and the partners, as listed. */
  partners: readonly PartnerView[];
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      partners.map(({ partner }) => [partner.id, String(partner.ownershipBp / 100)]),
    ),
  );
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = partners.map(({ partner }) => ({
    key: partner.id,
    label: <bdi>{partner.name}</bdi>,
    value: values[partner.id] ?? '',
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            const { bps, exact } = sharesTotal(rows.map((row) => row.value));
            if (!exact) return;
            setBusy(true);
            repositories.partners
              .saveAll(
                partners.map((view, index) => draftOf(view, { ownershipBp: bps[index] ?? 0 })),
              )
              .then(() => {
                toast.success(messages.partners.saved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(failureText(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <OwnershipFields
            rows={rows}
            idPrefix={id}
            showErrors={attempted}
            onChange={(key, value) => {
              setValues((current) => ({ ...current, [key]: value }));
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? messages.forms.saving : messages.forms.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
