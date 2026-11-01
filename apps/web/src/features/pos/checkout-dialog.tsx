'use client';

import type { Customer, NewSaleInput } from '@fabric/contracts';
import { formatMoneyAmount, parseMoneyInput } from '@fabric/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { messages } from '@/i18n';
import { type Local, useLiveQuery, useRepositories } from '@/local-db';
import { Keypad, Money, MoneyInput, moneyPad, useMoneyUnit, usePadFields } from '@/shared/format';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { CustomerPicker } from './customer-picker';

const t = messages.pos;
type Mode = 'full' | 'credit';

const issueText = (message: string | undefined) =>
  (message && t.issues[message]) ?? messages.forms.invalid;

/**
 * Taking the payment (SPEC §4.1): paid in full, or a part now with the rest as the customer's
 * debt (a customer is then required). The amount paid is typed on the keypad. The sale is
 * priced again here with the payment, so what the repository will refuse shows before the tap.
 */
export function CheckoutDialog({
  base,
  total,
  customers,
  customerId,
  onCustomer,
  onAddCustomer,
  requiresConfirmation,
  saving,
  onComplete,
  onClose,
  initialMode,
}: {
  /** The bill as a sale, unpaid. */
  base: NewSaleInput;
  total: number;
  customers: readonly Local<Customer>[];
  customerId: string | null;
  onCustomer: (id: string | null) => void;
  onAddCustomer: () => void;
  /** The bill is under cost somewhere: it needs the explicit confirmation. */
  requiresConfirmation: boolean;
  saving: boolean;
  onComplete: (input: NewSaleInput) => void;
  onClose: () => void;
  initialMode?: 'full' | 'credit';
}) {
  const id = useId();
  const repositories = useRepositories();
  const { unit } = useMoneyUnit();
  const [mode, setMode] = useState<Mode>(initialMode ?? 'full');
  const pad = usePadFields({ paid: '' }, { paid: moneyPad(unit) }, 'paid');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const typed = parseMoneyInput(pad.texts.paid, unit);
  const typedCents = typed.ok ? typed.value : null;
  const paidCents = mode === 'full' ? total : typedCents;

  const input = useMemo(
    (): NewSaleInput | null =>
      paidCents === null
        ? null
        : {
            ...base,
            customerId,
            paidCents,
            dueDate: mode === 'credit' && dueDate !== '' ? dueDate : null,
            confirmedBelowCost: confirmed,
            note: note.trim() === '' ? null : note,
          },
    [base, customerId, paidCents, mode, dueDate, confirmed, note],
  );
  const priced = useLiveQuery(async () => {
    if (!input) return null;
    try {
      return await repositories.sales.preview(input);
    } catch {
      return null;
    }
  }, [repositories, input]);

  const issue = priced?.issues[0]?.message;
  const creditWithoutCustomer = mode === 'credit' && customerId === null;
  const format = (cents: number) => formatMoneyAmount(cents, unit, { grouping: false });
  const quick = [
    [t.payment.quickNone, 0],
    [t.payment.quickHalf, Math.floor(total / 10) * 5],
    [t.payment.quickAll, total],
  ] as const;

  const summary = (
    <dl className="grid gap-1.5 rounded-lg bg-muted p-3">
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">{t.total}</dt>
        <dd>
          <Money cents={total} />
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">{t.fields.paid}</dt>
        <dd>{paidCents === null ? '—' : <Money cents={paidCents} />}</dd>
      </div>
      <div className="flex justify-between gap-2 text-lg font-semibold">
        <dt>{t.remaining}</dt>
        <dd>
          {paidCents === null || paidCents > total ? (
            '—'
          ) : (
            <Money cents={total - paidCents} tone={paidCents < total ? 'debt' : undefined} />
          )}
        </dd>
      </div>
    </dl>
  );
  const noteField = (
    <Field>
      <FieldLabel htmlFor={`${id}-note`}>
        {t.fields.note} <span className="text-muted-foreground">({messages.forms.optional})</span>
      </FieldLabel>
      <Input
        id={`${id}-note`}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
    </Field>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100svh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-xl md:max-w-3xl"
      >
        <DialogHeader className="flex-row items-baseline justify-between gap-4 pe-10">
          <DialogTitle>{t.payment.title}</DialogTitle>
          <span className="text-2xl font-semibold">
            <Money cents={total} />
          </span>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(next) => {
            setMode(next as Mode);
            if (next === 'credit') pad.activate('paid');
          }}
        >
          <TabsList className="w-full group-data-horizontal/tabs:h-12">
            {(['full', 'credit'] as const).map((option) => (
              <TabsTrigger key={option} value={option} className="h-auto flex-1 text-base">
                {t.payment[option]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          <div
            className={
              mode === 'credit' ? 'grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem]' : 'grid gap-4'
            }
          >
            <FieldGroup>
              <Field data-invalid={creditWithoutCustomer || undefined}>
                <FieldLabel htmlFor={`${id}-customer`}>{t.fields.customer}</FieldLabel>
                <CustomerPicker
                  id={`${id}-customer`}
                  customers={customers}
                  customerId={customerId}
                  onCustomer={onCustomer}
                  onAdd={onAddCustomer}
                />
                {creditWithoutCustomer && (
                  <p className="text-sm text-destructive">{t.issues.sale_credit_needs_customer}</p>
                )}
              </Field>

              {mode === 'credit' ? (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${id}-paid`}>{t.fields.paid}</FieldLabel>
                    <MoneyInput
                      id={`${id}-paid`}
                      keypad
                      large
                      value={typedCents}
                      text={pad.texts.paid}
                      onTextChange={(text) => {
                        pad.type('paid', text);
                      }}
                      onFocus={() => {
                        pad.activate('paid');
                      }}
                    />
                    <div
                      role="group"
                      aria-label={t.payment.quick}
                      className="flex flex-wrap gap-2"
                      onPointerDown={(event) => {
                        event.preventDefault();
                      }}
                    >
                      {quick.map(([label, cents]) => (
                        <Button
                          key={label}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="touch-manipulation pointer-coarse:h-11 pointer-coarse:px-4"
                          onClick={() => {
                            pad.fill('paid', format(cents));
                            document.getElementById(`${id}-paid`)?.focus();
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`${id}-due`}>
                        {t.fields.dueDate}{' '}
                        <span className="text-muted-foreground">({messages.forms.optional})</span>
                      </FieldLabel>
                      <Input
                        id={`${id}-due`}
                        type="date"
                        value={dueDate}
                        onChange={(event) => {
                          setDueDate(event.target.value);
                        }}
                      />
                    </Field>
                    {noteField}
                  </div>
                </>
              ) : (
                noteField
              )}

              {requiresConfirmation && (
                <Alert variant="destructive">
                  <TriangleAlertIcon aria-hidden />
                  <AlertTitle>{t.belowCostTitle}</AlertTitle>
                  <AlertDescription className="grid gap-2">
                    <span>{t.belowCostDescription}</span>
                    <span className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-confirm`}
                        checked={confirmed}
                        onCheckedChange={(checked) => {
                          setConfirmed(checked === true);
                        }}
                      />
                      <label htmlFor={`${id}-confirm`} className="font-medium text-foreground">
                        {t.confirmBelowCost}
                      </label>
                    </span>
                  </AlertDescription>
                </Alert>
              )}
              {issue && issue !== 'sale_credit_needs_customer' && (
                <p role="alert" className="text-sm text-destructive">
                  {issueText(issue)}
                </p>
              )}
              {mode === 'full' && summary}
            </FieldGroup>

            {mode === 'credit' && (
              <div className="grid content-start gap-3">
                <Keypad onPress={pad.press} />
                {summary}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {messages.forms.cancel}
          </Button>
          <Button
            type="button"
            variant="accent"
            disabled={
              saving ||
              input === null ||
              issue !== undefined ||
              (requiresConfirmation && !confirmed)
            }
            onClick={() => {
              if (input) onComplete(input);
            }}
          >
            {saving ? messages.forms.saving : t.payment.complete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
