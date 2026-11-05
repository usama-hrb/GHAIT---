'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type PartnerView, type SplitRuleRow, useLiveQuery, useRepositories } from '@/local-db';
import { DateText } from '@/shared/format';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { failureText } from './people-errors';
import { nextMonthStart, ruleInForce, rulesLeavingOut, weightFrom, weightIn } from './people-view';
import { RuleShareList } from './rule-shares';

const t = messages.partners.profitDialog;

/**
 * Gives one partner a weight in the profit split from a future date, leaving every other weight
 * as the rule in force has it (S17). A weight of 0 takes them out of the split from that date. It
 * is a profit rule like any other: it starts after today and never changes a period that began.
 */
export function ProfitShareDialog({
  target,
  partners,
  rules,
  onOpenChange,
}: {
  target: PartnerView | null;
  partners: readonly PartnerView[];
  rules: readonly SplitRuleRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const today = shopToday();
  const partnerId = target?.partner.id ?? '';
  const inForce = ruleInForce(rules);
  const [weightText, setWeightText] = useState(() =>
    String(inForce ? weightIn(inForce, { kind: 'partner', partnerId }) : 0),
  );
  const [from, setFrom] = useState(() => nextMonthStart(today));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const weight = weightFrom(weightText);
  const fromOk = from > today;
  const names = new Map(partners.map(({ partner }) => [partner.id, partner.name]));

  const preview = useLiveQuery(async () => {
    if (target === null || weight === null || !fromOk) return null;
    return (
      await repositories.settlements.previewPartnerWeight({
        partnerId,
        weight,
        effectiveFrom: from,
      })
    ).rule;
  }, [repositories, target, partnerId, weight, from, fromOk]);
  const leftOut = rulesLeavingOut(rules, partnerId, from);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (weight === null || !fromOk) {
              setError(messages.forms.invalid);
              return;
            }
            setBusy(true);
            repositories.settlements
              .setPartnerWeight({ partnerId, weight, effectiveFrom: from })
              .then(() => {
                toast.success(t.saved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((caught: unknown) => {
                setError(failureText(caught));
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description(target?.partner.name ?? '')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={weight === null || undefined}>
                <FieldLabel htmlFor={`${id}-weight`}>{t.weight}</FieldLabel>
                <Input
                  id={`${id}-weight`}
                  inputMode="numeric"
                  dir="ltr"
                  className="text-start"
                  aria-invalid={weight === null || undefined}
                  value={weightText}
                  onChange={(event) => {
                    setWeightText(event.target.value);
                  }}
                />
                <FieldDescription>{t.weightHint}</FieldDescription>
              </Field>
              <Field data-invalid={!fromOk || undefined}>
                <FieldLabel htmlFor={`${id}-from`}>{t.from}</FieldLabel>
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                  }}
                />
                {!fromOk && (
                  <FieldError>{messages.settlements.issues.split_rule_not_in_future}</FieldError>
                )}
              </Field>
            </div>
            {preview && (
              <div className="grid gap-1.5 rounded-lg bg-muted/60 p-3 text-sm">
                <p className="text-muted-foreground">{t.under}</p>
                <RuleShareList rule={preview} names={names} />
              </div>
            )}
            {leftOut.length > 0 && (
              <Alert>
                <AlertDescription className="grid gap-1">
                  <span>{t.laterRules}</span>
                  <span className="flex flex-wrap gap-x-3">
                    {leftOut.map((row) => (
                      <span key={row.effectiveFrom} className="font-medium">
                        <DateText value={row.effectiveFrom} />
                      </span>
                    ))}
                  </span>
                </AlertDescription>
              </Alert>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
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
