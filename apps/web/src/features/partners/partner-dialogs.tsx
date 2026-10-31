'use client';

import type { PartnerWarning } from '@fabric/core';
import { parseScaledDecimal } from '@fabric/core';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { isPeriodLocked, type PartnerView, useLiveQuery, useRepositories } from '@/local-db';
import { MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';

const t = messages.partners;

/** The two partners and their ownership (SPEC §6): set up once, edited together. */
export function PartnersForm({
  current,
  onSaved,
}: {
  current?: { owner: PartnerView; partner: PartnerView };
  onSaved?: () => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [ownerName, setOwnerName] = useState(current?.owner.partner.name ?? '');
  const [partnerName, setPartnerName] = useState(current?.partner.partner.name ?? '');
  const [share, setShare] = useState(String((current?.owner.partner.ownershipBp ?? 5000) / 100));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const parsed = parseScaledDecimal(share, 2);
  const ownerBp = parsed.ok && parsed.value <= 10_000 ? parsed.value : null;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (ownerName.trim() === '' || partnerName.trim() === '' || ownerBp === null) return;
        setBusy(true);
        repositories.partners
          .saveBoth({
            owner: { id: current?.owner.partner.id, name: ownerName, ownershipBp: ownerBp },
            partner: { id: current?.partner.partner.id, name: partnerName },
          })
          .then(() => {
            toast.success(t.saved, { description: messages.forms.saved });
            onSaved?.();
          })
          .catch((error: unknown) => {
            toast.error(
              isPeriodLocked(error) ? messages.forms.periodLocked : messages.forms.invalid,
            );
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={(attempted && ownerName.trim() === '') || undefined}>
            <FieldLabel htmlFor={`${id}-owner`}>{t.ownerName}</FieldLabel>
            <Input
              id={`${id}-owner`}
              value={ownerName}
              onChange={(event) => {
                setOwnerName(event.target.value);
              }}
            />
          </Field>
          <Field data-invalid={(attempted && partnerName.trim() === '') || undefined}>
            <FieldLabel htmlFor={`${id}-partner`}>{t.partnerName}</FieldLabel>
            <Input
              id={`${id}-partner`}
              value={partnerName}
              onChange={(event) => {
                setPartnerName(event.target.value);
              }}
            />
          </Field>
        </div>
        <Field data-invalid={(attempted && ownerBp === null) || undefined}>
          <FieldLabel htmlFor={`${id}-share`}>{t.ownerShare}</FieldLabel>
          <Input
            id={`${id}-share`}
            inputMode="decimal"
            dir="ltr"
            value={share}
            onChange={(event) => {
              setShare(event.target.value);
            }}
          />
          {ownerBp === null ? (
            attempted && <FieldError>{t.setupInvalid}</FieldError>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.partnerShareIs} <bdi data-num>{(10_000 - ownerBp) / 100}%</bdi>
            </p>
          )}
        </Field>
      </FieldGroup>
      <Button type="submit" variant="accent" className="justify-self-start" disabled={busy}>
        {busy ? messages.forms.saving : messages.forms.save}
      </Button>
    </form>
  );
}

export type MoneyMoveKind = 'contribution' | 'withdrawal' | 'draw';

/**
 * Records a contribution, a capital withdrawal or a draw for one partner (SPEC §8.4). A
 * withdrawal and a draw say why; when the core warns (capital below zero, a draw beyond the
 * undrawn share), recording needs an explicit confirmation.
 */
export function MoneyMoveDialog({
  move,
  onOpenChange,
}: {
  move: { kind: MoneyMoveKind; partner: PartnerView } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(() => shopToday());
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const lockedThrough = useLockedThrough();
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const kind = move?.kind ?? 'contribution';
  const partnerId = move?.partner.partner.id ?? '';
  const needsReason = kind !== 'contribution';

  const input = useMemo(
    () => (amount === null || amount <= 0 ? null : { amount, date, reason: reason.trim() }),
    [amount, date, reason],
  );
  const warnings = useLiveQuery(async (): Promise<PartnerWarning[]> => {
    if (!input || !move) return [];
    return kind === 'draw'
      ? repositories.partners.drawWarnings({
          partnerId,
          amountCents: input.amount,
          date: input.date,
          reason: input.reason || '-',
        })
      : repositories.partners.capitalWarnings({
          partnerId,
          kind,
          amountCents: input.amount,
          date: input.date,
          note: input.reason || '-',
        });
  }, [repositories, input, kind, partnerId, move]);
  const title =
    kind === 'contribution' ? t.contribution : kind === 'withdrawal' ? t.withdrawal : t.draw;

  return (
    <Dialog open={move !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!input || (needsReason && input.reason === '')) return;
            if ((warnings?.length ?? 0) > 0 && !confirmed) return;
            setBusy(true);
            const saving =
              kind === 'draw'
                ? repositories.partners.recordDraw(
                    {
                      partnerId,
                      amountCents: input.amount,
                      date: input.date,
                      reason: input.reason,
                    },
                    confirmed,
                  )
                : repositories.partners.recordCapitalMove(
                    {
                      partnerId,
                      kind,
                      amountCents: input.amount,
                      date: input.date,
                      note: input.reason === '' ? null : input.reason,
                    },
                    confirmed,
                  );
            saving
              .then(() => {
                toast.success(t.recorded, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((error: unknown) => {
                toast.error(
                  isPeriodLocked(error) ? messages.forms.periodLocked : messages.forms.invalid,
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {title}: {move?.partner.partner.name}
            </DialogTitle>
            <DialogDescription>{t.hints[kind]}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>{t.fields.amount}</FieldLabel>
                <MoneyInput
                  id={`${id}-amount`}
                  required
                  showError={attempted}
                  value={amount}
                  onValueChange={setAmount}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>{t.fields.date}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
                <PeriodLockHint date={date} lockedThrough={lockedThrough} />
              </Field>
            </div>
            <Field data-invalid={(attempted && needsReason && reason.trim() === '') || undefined}>
              <FieldLabel htmlFor={`${id}-reason`}>
                {needsReason ? t.fields.reason : t.fields.note}
                {!needsReason && (
                  <span className="text-muted-foreground"> ({messages.forms.optional})</span>
                )}
              </FieldLabel>
              <Input
                id={`${id}-reason`}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              {attempted && needsReason && reason.trim() === '' && (
                <FieldError>{t.reasonRequired}</FieldError>
              )}
            </Field>
            {(warnings?.length ?? 0) > 0 && (
              <Alert variant="destructive">
                <AlertDescription className="grid gap-2">
                  {warnings?.map((warning) => (
                    <span key={warning}>{t.warnings[warning]}</span>
                  ))}
                  <span className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-confirm`}
                      checked={confirmed}
                      onCheckedChange={(checked) => {
                        setConfirmed(checked === true);
                      }}
                    />
                    <label htmlFor={`${id}-confirm`} className="font-medium text-foreground">
                      {t.confirm}
                    </label>
                  </span>
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || ((warnings?.length ?? 0) > 0 && !confirmed)}>
              {busy ? messages.forms.saving : messages.forms.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
