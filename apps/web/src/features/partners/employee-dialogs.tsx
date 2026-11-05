'use client';

import { monthOf } from '@fabric/core';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { type EmployeeSummary, useLiveQuery, useRepositories } from '@/local-db';
import { formatDate, Money, MoneyInput } from '@/shared/format';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';
import { PeriodLockHint, useLockedThrough } from '@/features/settlements';
import { failureText } from './people-errors';
import { rateStartOptions, thisMonthStart, nextMonthStart } from './people-view';

const t = messages.partners.employees;

export type EmployeeRecord = EmployeeSummary['employee'];

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The first-of-month dates to choose from, shown as month names. */
function MonthSelect({
  id,
  value,
  options,
  label,
  onChange,
}: {
  id: string;
  value: string;
  options: readonly string[];
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {formatDate(option, 'month')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Adds an employee, or edits one (ADR 0022). An employee is not a partner: no share of the
 * profit, no capital. Adding can set the first monthly salary and the month it starts in; the
 * salary of someone already here changes through the salary dialog, never in this form.
 */
export function EmployeeDialog({
  target,
  onOpenChange,
}: {
  target: 'add' | EmployeeRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const today = shopToday();
  const editing = target === null || target === 'add' ? null : target;
  const [name, setName] = useState(editing?.name ?? '');
  const [position, setPosition] = useState(editing?.position ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [startDate, setStartDate] = useState(editing?.startDate ?? today);
  const [endDate, setEndDate] = useState(editing?.endDate ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [salary, setSalary] = useState<number | null>(null);
  const [salaryFrom, setSalaryFrom] = useState(() => thisMonthStart(today));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startedIn = monthOf(isDate(startDate) ? startDate : today);
  const options = rateStartOptions({ today, startedIn, hasRate: false });
  // The month kept when the start date moves past it: this month, or the first one offered.
  const fallback = options.includes(thisMonthStart(today))
    ? thisMonthStart(today)
    : (options[0] ?? thisMonthStart(today));
  const salaryStart = options.includes(salaryFrom) ? salaryFrom : fallback;
  const endBeforeStart = endDate !== '' && isDate(startDate) && endDate < startDate;
  const nameMissing = name.trim() === '';
  const startMissing = !isDate(startDate);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (nameMissing || startMissing || endBeforeStart) return;
            setBusy(true);
            setError(null);
            const save = async () => {
              const employeeId = await repositories.employees.save(
                {
                  name: name.trim(),
                  position: position.trim() === '' ? null : position.trim(),
                  phone: phone.trim() === '' ? null : phone.trim(),
                  startDate,
                  endDate: endDate === '' ? null : endDate,
                  notes: notes.trim() === '' ? null : notes.trim(),
                },
                editing?.id,
              );
              if (!editing && salary !== null && salary > 0) {
                try {
                  await repositories.employees.setSalary({
                    employeeId,
                    effectiveFrom: salaryStart,
                    amountCents: salary,
                  });
                } catch (caught) {
                  toast.warning(t.form.savedPartly, { description: failureText(caught) });
                  return;
                }
              }
              toast.success(editing ? t.form.saved : t.form.added, {
                description: messages.forms.saved,
              });
            };
            save()
              .then(() => {
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
            <DialogTitle>{editing ? t.form.editTitle : t.form.addTitle}</DialogTitle>
            <DialogDescription>
              {editing ? t.form.editDescription : t.form.addDescription}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={(attempted && nameMissing) || undefined}>
                <FieldLabel htmlFor={`${id}-name`}>{t.form.name}</FieldLabel>
                <Input
                  id={`${id}-name`}
                  autoComplete="off"
                  aria-invalid={(attempted && nameMissing) || undefined}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
                {attempted && nameMissing && <FieldError>{t.form.nameRequired}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-position`}>{t.form.position}</FieldLabel>
                <Input
                  id={`${id}-position`}
                  autoComplete="off"
                  placeholder={t.form.positionPlaceholder}
                  value={position}
                  onChange={(event) => {
                    setPosition(event.target.value);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-phone`}>{t.form.phone}</FieldLabel>
                <Input
                  id={`${id}-phone`}
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  className="text-start"
                  autoComplete="off"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value);
                  }}
                />
              </Field>
              <Field data-invalid={(attempted && startMissing) || undefined}>
                <FieldLabel htmlFor={`${id}-start`}>{t.form.startDate}</FieldLabel>
                <Input
                  id={`${id}-start`}
                  type="date"
                  aria-invalid={(attempted && startMissing) || undefined}
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                  }}
                />
              </Field>
            </div>
            {editing && (
              <Field data-invalid={endBeforeStart || undefined}>
                <FieldLabel htmlFor={`${id}-end`}>{t.form.endDate}</FieldLabel>
                <Input
                  id={`${id}-end`}
                  type="date"
                  aria-invalid={endBeforeStart || undefined}
                  value={endDate}
                  onChange={(event) => {
                    setEndDate(event.target.value);
                  }}
                />
                {endBeforeStart ? (
                  <FieldError>{t.form.endBeforeStart}</FieldError>
                ) : (
                  <FieldDescription>{t.form.endDateHint}</FieldDescription>
                )}
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`${id}-notes`}>
                {t.form.notes}{' '}
                <span className="text-muted-foreground">({messages.forms.optional})</span>
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
            {!editing && (
              <div className="grid gap-4 rounded-lg bg-muted/60 p-3 sm:grid-cols-2">
                <p className="text-sm font-medium sm:col-span-2">{t.form.salaryHeading}</p>
                <Field>
                  <FieldLabel htmlFor={`${id}-salary`}>{t.form.salary}</FieldLabel>
                  <MoneyInput
                    id={`${id}-salary`}
                    value={salary}
                    onValueChange={setSalary}
                    showError={attempted}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-from`}>{t.form.salaryFrom}</FieldLabel>
                  <MonthSelect
                    id={`${id}-from`}
                    label={t.form.salaryFrom}
                    value={salaryStart}
                    options={options}
                    onChange={setSalaryFrom}
                  />
                </Field>
                <FieldDescription className="sm:col-span-2">{t.form.salaryHint}</FieldDescription>
              </div>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
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

/** Who gets a new salary, and what they earn now (0 before the first). */
export interface SalaryRateTarget {
  employee: EmployeeRecord;
  /** Whether a salary has been set before: the first one may start in a past month, a raise may not. */
  hasRate: boolean;
  currentSalaryCents: number;
}

/**
 * A new monthly salary from the first day of a month (PY2, PY4). The old one stays as it was for
 * the months before; a salary already paid is never rewritten. 0 stops the salary from that month.
 */
export function SalaryRateDialog({
  target,
  onOpenChange,
}: {
  target: SalaryRateTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const today = shopToday();
  const hasRate = target?.hasRate ?? false;
  const options = rateStartOptions({
    today,
    startedIn: monthOf(target?.employee.startDate ?? today),
    hasRate,
  });
  const preferred = hasRate ? nextMonthStart(today) : thisMonthStart(today);
  const [amount, setAmount] = useState<number | null>(null);
  const [from, setFrom] = useState(preferred);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = options.includes(from) ? from : (options[0] ?? preferred);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!target || amount === null) return;
            setBusy(true);
            setError(null);
            repositories.employees
              .setSalary({
                employeeId: target.employee.id,
                effectiveFrom: start,
                amountCents: amount,
              })
              .then(() => {
                toast.success(t.rate.saved, { description: messages.forms.saved });
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
            <DialogTitle>{t.rate.title(target?.employee.name ?? '')}</DialogTitle>
            <DialogDescription>{t.rate.description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {target?.hasRate && (
              <p className="flex items-baseline justify-between gap-2 rounded-lg bg-muted/60 p-3 text-sm">
                <span className="text-muted-foreground">{t.rate.current}</span>
                <Money cents={target.currentSalaryCents} />
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>{t.rate.amount}</FieldLabel>
                <MoneyInput
                  id={`${id}-amount`}
                  required
                  showError={attempted}
                  value={amount}
                  onValueChange={setAmount}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-from`}>{t.rate.from}</FieldLabel>
                <MonthSelect
                  id={`${id}-from`}
                  label={t.rate.from}
                  value={start}
                  options={options}
                  onChange={setFrom}
                />
              </Field>
            </div>
            <FieldDescription>{t.rate.hint}</FieldDescription>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
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

/** A salary to pay: whose, which month, and where that month stands. */
export interface SalaryPaymentTarget {
  employee: EmployeeRecord;
  /** The month it pays (YYYY-MM). */
  month: string;
  dueCents: number;
  paidCents: number;
}

/**
 * Pays a salary, or part of it (PY3): recorded as an expense in the wages category on the day it
 * is paid, for the month it pays. Paying less leaves the rest owed; paying more than the month
 * is due asks for an explicit confirmation. It is never a partner's draw.
 */
export function SalaryPaymentDialog({
  target,
  onOpenChange,
}: {
  target: SalaryPaymentTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const repositories = useRepositories();
  const lockedThrough = useLockedThrough();
  const remaining = target ? Math.max(0, target.dueCents - target.paidCents) : 0;
  const [amount, setAmount] = useState<number | null>(remaining > 0 ? remaining : null);
  const [paidDate, setPaidDate] = useState(() => shopToday());
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const employeeId = target?.employee.id ?? '';
  const month = target?.month ?? '';

  const input = useMemo(
    () =>
      amount === null || amount <= 0 || paidDate === ''
        ? null
        : {
            employeeId,
            month,
            amountCents: amount,
            paidDate,
            note: note.trim() === '' ? null : note.trim(),
          },
    [employeeId, month, amount, paidDate, note],
  );
  const warnings = useLiveQuery(
    async () => (input ? repositories.employees.paymentWarnings(input) : []),
    [repositories, input],
  );
  const warning = warnings?.[0];

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (!input || (warning && !confirmed)) return;
            setBusy(true);
            setError(null);
            repositories.employees
              .recordPayment(input, confirmed)
              .then(() => {
                toast.success(t.payment.recorded, { description: messages.forms.saved });
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
            <DialogTitle>{t.payment.title(target?.employee.name ?? '')}</DialogTitle>
            <DialogDescription>
              {t.payment.description(target ? formatDate(`${target.month}-01`, 'month') : '')}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-3 text-sm">
              <div className="grid gap-0.5">
                <dt className="text-muted-foreground">{t.payment.due}</dt>
                <dd>
                  <Money cents={target?.dueCents ?? 0} />
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted-foreground">{t.payment.paid}</dt>
                <dd>
                  <Money cents={target?.paidCents ?? 0} />
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted-foreground">{t.payment.remaining}</dt>
                <dd>
                  <Money cents={remaining} tone={remaining > 0 ? 'debt' : undefined} />
                </dd>
              </div>
            </dl>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>{t.payment.amount}</FieldLabel>
                <MoneyInput
                  id={`${id}-amount`}
                  required
                  showError={attempted}
                  value={amount}
                  onValueChange={setAmount}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>{t.payment.date}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={paidDate}
                  onChange={(event) => {
                    setPaidDate(event.target.value);
                  }}
                />
                <PeriodLockHint date={paidDate} lockedThrough={lockedThrough} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-note`}>
                {t.payment.note}{' '}
                <span className="text-muted-foreground">({messages.forms.optional})</span>
              </FieldLabel>
              <Input
                id={`${id}-note`}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </Field>
            <FieldDescription>{t.payment.hint}</FieldDescription>
            {warning && (
              <Alert variant="destructive">
                <AlertDescription className="grid gap-2">
                  <span>{t.payment.overDue}</span>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span>{t.payment.paidAfter}</span>
                    <Money cents={warning.paidAfterCents} />
                    <span>{t.payment.ofDue}</span>
                    <Money cents={warning.dueCents} />
                  </span>
                  <span className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-confirm`}
                      checked={confirmed}
                      onCheckedChange={(checked) => {
                        setConfirmed(checked === true);
                      }}
                    />
                    <label htmlFor={`${id}-confirm`} className="font-medium text-foreground">
                      {t.payment.confirm}
                    </label>
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
            <Button
              type="submit"
              variant="accent"
              disabled={busy || (warning !== undefined && !confirmed)}
            >
              {busy ? messages.forms.saving : t.payment.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
