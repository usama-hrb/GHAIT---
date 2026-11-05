'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type PartnerView, useLiveQuery, useRepositories } from '@/local-db';
import { MoneyInput } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { OwnershipFields } from './ownership-fields';
import { failureText } from './people-errors';
import { draftOf, nextMonthStart, sharesTotal, weightFrom } from './people-view';
import { RuleShareList } from './rule-shares';

const t = messages.partners;

/** Stands for the partner being added in the table of shares and in the preview of the rule. */
const NEW = 'new';

/**
 * Adds a partner, or edits one partner's details. Adding takes what the owner needs to know to
 * bring someone in: who they are, what part of the shop they own, what they put in, and how they
 * share the profit. Nothing is assumed: a new partner owns 0% and has no profit weight until the
 * owner says so, and a weight is a profit rule that starts after today (S15, S17), never earlier.
 */
export function PartnerDialog({
  target,
  partners,
  onOpenChange,
}: {
  /** 'add' for a new partner; a partner to edit their details; null while closed. */
  target: 'add' | PartnerView | null;
  /** The owner and the partners, as listed. */
  partners: readonly PartnerView[];
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const today = shopToday();
  const editing = target !== null && target !== 'add' ? target : null;
  const adding = target === 'add';
  const [name, setName] = useState(editing?.partner.name ?? '');
  const [phone, setPhone] = useState(editing?.partner.phone ?? '');
  const [title, setTitle] = useState(editing?.partner.title ?? '');
  const [startDate, setStartDate] = useState(editing ? (editing.partner.startDate ?? '') : today);
  const [notes, setNotes] = useState(editing?.partner.notes ?? '');
  const [shares, setShares] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(
      partners.map(({ partner }) => [partner.id, String(partner.ownershipBp / 100)]),
    ),
    [NEW]: '0',
  }));
  const [contribution, setContribution] = useState<number | null>(null);
  const [contributionDate, setContributionDate] = useState(today);
  const [weightText, setWeightText] = useState('');
  const [from, setFrom] = useState(() => nextMonthStart(today));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const weight = weightText.trim() === '' ? 'none' : weightFrom(weightText);
  const gives = typeof weight === 'number' && weight > 0;
  const fromOk = !gives || from > today;
  const rows = [
    ...partners.map(({ partner }) => ({
      key: partner.id,
      label: <bdi>{partner.name}</bdi>,
      value: shares[partner.id] ?? '',
    })),
    {
      key: NEW,
      label: <bdi>{name.trim() === '' ? t.form.newPartner : name.trim()}</bdi>,
      value: shares[NEW] ?? '',
    },
  ];
  const names = new Map(partners.map(({ partner }) => [partner.id, partner.name]));
  names.set(NEW, name.trim() === '' ? t.form.newPartner : name.trim());

  // What the split would become, so a weight is read as the share it makes and not as a bare number.
  const preview = useLiveQuery(async () => {
    if (!adding || !gives || !fromOk) return null;
    return (
      await repositories.settlements.previewPartnerWeight({
        partnerId: NEW,
        weight,
        effectiveFrom: from,
      })
    ).rule;
  }, [repositories, adding, gives, weight, from, fromOk]);

  const nameMissing = attempted && name.trim() === '';
  const contributionBad = attempted && contribution !== null && contribution <= 0;

  const submit = async () => {
    setAttempted(true);
    if (name.trim() === '') return;
    const details = {
      name: name.trim(),
      phone: phone.trim() === '' ? null : phone.trim(),
      title: title.trim() === '' ? null : title.trim(),
      startDate: startDate === '' ? null : startDate,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    if (editing) {
      await repositories.partners.saveAll([draftOf(editing, details)]);
      toast.success(t.saved, { description: messages.forms.saved });
      onOpenChange(false);
      return;
    }
    const { bps, exact } = sharesTotal(rows.map((row) => row.value));
    if (!exact || weight === null || !fromOk || (contribution !== null && contribution <= 0)) {
      return;
    }
    const newBp = bps[partners.length] ?? 0;
    // The others whose share changed make room for the newcomer; saveAll writes who owns less first.
    const ids = await repositories.partners.saveAll([
      ...partners.map((view, index) => draftOf(view, { ownershipBp: bps[index] ?? 0 })),
      { ...details, isOwner: false, ownershipBp: newBp },
    ]);
    const partnerId = ids.at(-1);
    if (partnerId === undefined) return;
    // The partner is saved now. What follows is written on top of it; if a step fails the partner stays.
    try {
      if (contribution !== null) {
        await repositories.partners.recordCapitalMove({
          partnerId,
          kind: 'contribution',
          amountCents: contribution,
          date: contributionDate,
          note: null,
        });
      }
      if (gives) {
        await repositories.settlements.setPartnerWeight({
          partnerId,
          weight,
          effectiveFrom: from,
        });
      }
    } catch (error: unknown) {
      toast.warning(t.form.savedPartly, { description: failureText(error) });
      onOpenChange(false);
      return;
    }
    toast.success(t.form.added, { description: messages.forms.saved });
    onOpenChange(false);
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            submit()
              .catch((error: unknown) => {
                toast.error(failureText(error));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{adding ? t.form.addTitle : t.form.editTitle}</DialogTitle>
            <DialogDescription>
              {adding ? t.form.addDescription : t.form.editDescription}
            </DialogDescription>
          </DialogHeader>

          <FieldSet>
            <FieldLegend>{t.form.details}</FieldLegend>
            <FieldGroup>
              <Field data-invalid={nameMissing || undefined}>
                <FieldLabel htmlFor={`${id}-name`}>{t.form.name}</FieldLabel>
                <Input
                  id={`${id}-name`}
                  autoComplete="off"
                  aria-invalid={nameMissing || undefined}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
                {nameMissing && <FieldError>{t.form.nameRequired}</FieldError>}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${id}-title`}>
                    {t.form.title}
                    <span className="text-muted-foreground"> ({messages.forms.optional})</span>
                  </FieldLabel>
                  <Input
                    id={`${id}-title`}
                    placeholder={t.form.titlePlaceholder}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-phone`}>
                    {t.form.phone}
                    <span className="text-muted-foreground"> ({messages.forms.optional})</span>
                  </FieldLabel>
                  <Input
                    id={`${id}-phone`}
                    type="tel"
                    dir="ltr"
                    className="text-start"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value);
                    }}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-start`}>{t.form.startDate}</FieldLabel>
                <Input
                  id={`${id}-start`}
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-notes`}>
                  {t.form.notes}
                  <span className="text-muted-foreground"> ({messages.forms.optional})</span>
                </FieldLabel>
                <Textarea
                  id={`${id}-notes`}
                  rows={2}
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                  }}
                />
              </Field>
            </FieldGroup>
          </FieldSet>

          {adding && (
            <>
              <FieldSet>
                <FieldLegend>{t.form.ownership}</FieldLegend>
                <FieldDescription>{t.form.ownershipHint}</FieldDescription>
                <OwnershipFields
                  rows={rows}
                  idPrefix={`${id}-own`}
                  showErrors={attempted}
                  onChange={(key, value) => {
                    setShares((current) => ({ ...current, [key]: value }));
                  }}
                />
              </FieldSet>

              <FieldSet>
                <FieldLegend>{t.form.contribution}</FieldLegend>
                <FieldDescription>{t.form.contributionHint}</FieldDescription>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={contributionBad || undefined}>
                    <FieldLabel htmlFor={`${id}-amount`}>{t.fields.amount}</FieldLabel>
                    <MoneyInput
                      id={`${id}-amount`}
                      showError={attempted}
                      value={contribution}
                      onValueChange={setContribution}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-contributed`}>{t.fields.date}</FieldLabel>
                    <Input
                      id={`${id}-contributed`}
                      type="date"
                      value={contributionDate}
                      onChange={(event) => {
                        setContributionDate(event.target.value);
                      }}
                    />
                    <PeriodLockHint date={contributionDate} lockedThrough={lockedThrough} />
                  </Field>
                </div>
              </FieldSet>

              <FieldSet>
                <FieldLegend>{t.form.profit}</FieldLegend>
                <FieldDescription>{t.form.profitHint}</FieldDescription>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={weight === null || undefined}>
                    <FieldLabel htmlFor={`${id}-weight`}>{t.form.weight}</FieldLabel>
                    <Input
                      id={`${id}-weight`}
                      inputMode="numeric"
                      dir="ltr"
                      className="text-start"
                      aria-invalid={weight === null || undefined}
                      placeholder={t.form.weightPlaceholder}
                      value={weightText}
                      onChange={(event) => {
                        setWeightText(event.target.value);
                      }}
                    />
                    {weight === null && <FieldError>{t.form.weightInvalid}</FieldError>}
                  </Field>
                  <Field data-invalid={!fromOk || undefined}>
                    <FieldLabel htmlFor={`${id}-from`}>{t.form.from}</FieldLabel>
                    <Input
                      id={`${id}-from`}
                      type="date"
                      value={from}
                      disabled={!gives}
                      onChange={(event) => {
                        setFrom(event.target.value);
                      }}
                    />
                    {!fromOk && (
                      <FieldError>
                        {messages.settlements.issues.split_rule_not_in_future}
                      </FieldError>
                    )}
                  </Field>
                </div>
                {!gives && (
                  <Alert>
                    <AlertDescription>{t.form.noWeightYet}</AlertDescription>
                  </Alert>
                )}
                {gives && fromOk && preview && (
                  <div className="grid gap-1.5 rounded-lg bg-muted/60 p-3 text-sm">
                    <p className="text-muted-foreground">{t.form.under}</p>
                    <RuleShareList rule={preview} names={names} />
                  </div>
                )}
              </FieldSet>
            </>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? messages.forms.saving : messages.forms.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
