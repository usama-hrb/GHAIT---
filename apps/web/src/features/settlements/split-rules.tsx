'use client';

import { parseScaledDecimal } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type SplitRuleRow, useLiveQuery, useRepositories, ValidationError } from '@/local-db';
import { VoidDialog } from '@/shared/brand';
import { DateText } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.settlements;

/** The first day of next month: the usual start of a new rule. */
function nextMonthStart(): string {
  const [year = 2000, month = 1] = shopToday().split('-').map(Number);
  return month === 12
    ? `${String(year + 1)}-01-01`
    : `${String(year)}-${String(month + 1).padStart(2, '0')}-01`;
}

/** A weight typed by the user (Arabic-Indic digits too): a whole number 0–10000, else null. */
function weightOf(text: string): number | null {
  const parsed = parseScaledDecimal(text, 0);
  return parsed.ok && parsed.value <= 10_000 ? parsed.value : null;
}

function RuleDialog({
  editing,
  onOpenChange,
}: {
  /** The rule being changed, or 'new'. */
  editing: SplitRuleRow | 'new' | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const current = editing === 'new' ? null : editing;
  const [from, setFrom] = useState(() => current?.effectiveFrom ?? nextMonthStart());
  const [weights, setWeights] = useState(() =>
    [current?.ownerWeight ?? 1, current?.partnerWeight ?? 1, current?.shopWeight ?? 1].map(String),
  );
  const [error, setError] = useState<string | null>(null);
  const labels = [t.ownerWeight, t.partnerWeight, t.shopWeight];
  const parsed = weights.map(weightOf);

  return (
    <Dialog open={editing !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const [ownerWeight, partnerWeight, shopWeight] = parsed;
            if (ownerWeight == null || partnerWeight == null || shopWeight == null) {
              setError(messages.forms.invalid);
              return;
            }
            repositories.settlements
              .saveSplitRule(
                { effectiveFrom: from, ownerWeight, partnerWeight, shopWeight },
                current?.rule?.id,
              )
              .then(() => {
                toast.success(t.ruleSaved, { description: messages.forms.saved });
                onOpenChange(false);
              })
              .catch((caught: unknown) => {
                const issue = caught instanceof ValidationError ? caught.issues[0] : undefined;
                setError((issue && t.issues[issue.message]) ?? messages.forms.invalid);
              });
          }}
        >
          <DialogHeader>
            <DialogTitle>{current ? t.editRule : t.addRule}</DialogTitle>
            <DialogDescription>{t.rulesDescription}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-from`}>{t.ruleFrom}</FieldLabel>
              <Input
                id={`${id}-from`}
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                }}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              {labels.map((label, index) => (
                <Field key={label} data-invalid={parsed[index] === null || undefined}>
                  <FieldLabel htmlFor={`${id}-w${String(index)}`}>{label}</FieldLabel>
                  <Input
                    id={`${id}-w${String(index)}`}
                    inputMode="numeric"
                    dir="ltr"
                    value={weights[index]}
                    onChange={(event) => {
                      setWeights(weights.map((w, i) => (i === index ? event.target.value : w)));
                    }}
                  />
                </Field>
              ))}
            </div>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button type="submit">{messages.forms.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The profit split rules (SPEC §8.3, BUILD_PROMPTS 4.3): equal thirds since the start, then the
 * rules entered, each for a future date; one changes or goes only before it takes effect.
 */
export function SplitRules() {
  const repositories = useRepositories();
  const rows = useLiveQuery(() => repositories.settlements.splitRules(), [repositories]);
  const [editing, setEditing] = useState<SplitRuleRow | 'new' | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);

  return (
    <section aria-label={t.rulesTitle} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading font-semibold">{t.rulesTitle}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing('new');
          }}
        >
          {t.addRule}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t.rulesDescription}</p>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.ruleFrom}</TableHead>
              <TableHead>{t.owner}</TableHead>
              <TableHead>{t.partner}</TableHead>
              <TableHead>{t.shop}</TableHead>
              <TableHead>{t.columns.status}</TableHead>
              <TableHead>
                <span className="sr-only">{messages.forms.edit}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((row) => (
              <TableRow key={row.rule?.id ?? 'default'}>
                <TableCell>
                  {row.rule ? <DateText value={row.effectiveFrom} /> : t.defaultRule}
                </TableCell>
                {(
                  [
                    ['owner', row.ownerWeight],
                    ['partner', row.partnerWeight],
                    ['shop', row.shopWeight],
                  ] as const
                ).map(([who, weight]) => (
                  <TableCell key={who}>
                    <bdi data-num>{weight}</bdi>
                  </TableCell>
                ))}
                <TableCell>
                  <Badge variant={row.future ? 'outline' : 'secondary'}>
                    {row.future ? t.future : t.inEffect}
                  </Badge>
                </TableCell>
                <TableCell className="text-end">
                  {row.future && row.rule && (
                    <span className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(row);
                        }}
                      >
                        {messages.forms.edit}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setVoiding(row.rule?.id ?? null);
                        }}
                      >
                        {t.voidAction}
                      </Button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RuleDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : (editing.rule?.id ?? '')}
        editing={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={t.ruleVoidTitle}
        description={t.ruleVoidDescription}
        onConfirm={async (reason) => {
          if (voiding) await repositories.settlements.voidSplitRule(voiding, reason);
          setVoiding(null);
          toast.success(t.ruleVoided, { description: messages.forms.saved });
        }}
      />
    </section>
  );
}
