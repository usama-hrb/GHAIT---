'use client';

import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  MinusCircleIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { messages } from '@/i18n';
import { Money, MoneyInput } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { PeriodLockHint } from '@/features/settlements';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Field, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import {
  type PayChoice,
  payOf,
  type Recipient,
  type SectionState,
  type TransferChoice,
  transferOf,
} from './partner-exit-model';

const t = messages.partners.exit;

/** A percentage in basis points as text: 3000 → "30%", 3333 → "33.33%". */
export const formatBp = (bp: number): string => `${String(bp / 100)}%`;

const STATE_BADGE = {
  needs: 'warning',
  ready: 'secondary',
  done: 'success',
  na: 'outline',
} as const satisfies Record<SectionState, 'warning' | 'secondary' | 'success' | 'outline'>;

function StateIcon({ state }: { state: SectionState }) {
  const className = 'size-5 shrink-0';
  if (state === 'needs')
    return <CircleAlertIcon aria-hidden className={cn(className, 'text-debt')} />;
  if (state === 'ready')
    return <CircleCheckIcon aria-hidden className={cn(className, 'text-primary')} />;
  if (state === 'done')
    return <CheckCircle2Icon aria-hidden className={cn(className, 'text-success')} />;
  return <MinusCircleIcon aria-hidden className={cn(className, 'text-muted-foreground')} />;
}

/**
 * One part of the exit: what it is, how it stands, and (while it needs the owner or waits for the
 * confirmation) its controls. A part with nothing to do shows one line and does not open.
 */
export function SectionRow({
  title,
  state,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  state: SectionState;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const expandable = state === 'needs' || state === 'ready';
  const head = (
    <>
      <StateIcon state={state} />
      <span className="grid min-w-0 flex-1 gap-0.5 text-start">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{summary}</span>
      </span>
      <Badge variant={STATE_BADGE[state]} className="shrink-0">
        {t.states[state]}
      </Badge>
      {expandable && (
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      )}
    </>
  );
  return (
    <section className="rounded-xl border bg-card" data-state={state}>
      <h3 className="font-sans text-sm font-normal">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-panel`}
            onClick={onToggle}
            className="flex w-full items-center gap-3 rounded-xl p-3 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-14"
          >
            {head}
          </button>
        ) : (
          <div className="flex w-full items-center gap-3 p-3">{head}</div>
        )}
      </h3>
      {expandable && open && (
        <div id={`${id}-panel`} className="grid gap-4 border-t p-3 sm:p-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** A small label over a figure: the three numbers a part opens with. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** A choice with its explanation, as one tappable row. */
export function ChoiceRow({ value, label, hint }: { value: string; label: string; hint?: string }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-muted pointer-coarse:min-h-14"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * What is owed and what to do about it (profit or capital): pay all or part now, on a date, or
 * leave it on their account. Choosing only prepares the payment; nothing is recorded until the
 * exit is confirmed.
 */
export function PayPanel({
  kind,
  owedCents,
  choice,
  onChange,
  today,
  lockedThrough,
  showErrors,
}: {
  kind: 'profit' | 'capital';
  owedCents: number;
  choice: PayChoice;
  onChange: (choice: PayChoice) => void;
  today: string;
  lockedThrough: string | null;
  showErrors: boolean;
}) {
  const id = useId();
  const copy = kind === 'profit' ? t.profit : t.capital;
  const paying = choice.mode === 'pay';
  const paid = payOf(choice, owedCents);
  const tooMuch = choice.mode === 'pay' && choice.cents !== null && choice.cents > owedCents;
  return (
    <div className="grid gap-4">
      <RadioGroup
        value={choice.mode === 'unset' ? '' : choice.mode}
        onValueChange={(mode) => {
          if (mode === 'pay' && !paying) onChange({ mode: 'pay', cents: owedCents, date: today });
          if (mode === 'later') onChange({ mode: 'later' });
        }}
        aria-label={copy.title}
      >
        <ChoiceRow value="pay" label={copy.payNow} hint={copy.payNowHint} />
        <ChoiceRow value="later" label={copy.later} hint={copy.laterHint} />
      </RadioGroup>
      {choice.mode === 'pay' && (
        <div className="grid gap-3 rounded-lg bg-muted p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field data-invalid={(showErrors && !paid.chosen) || undefined}>
              <FieldLabel htmlFor={`${id}-amount`}>{t.amount}</FieldLabel>
              <MoneyInput
                id={`${id}-amount`}
                value={choice.cents}
                showError={showErrors}
                onValueChange={(cents) => {
                  onChange({ ...choice, cents });
                }}
              />
              {tooMuch && <FieldError>{t.tooMuch}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-date`}>{t.payDate}</FieldLabel>
              <Input
                id={`${id}-date`}
                type="date"
                value={choice.date}
                onChange={(event) => {
                  onChange({ ...choice, date: event.target.value });
                }}
              />
              <PeriodLockHint date={choice.date} lockedThrough={lockedThrough} />
            </Field>
          </div>
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t.staysOnAccount}</span>
            <Money cents={owedCents - paid.cents} tone="debt" className="font-medium" />
          </p>
        </div>
      )}
      {choice.mode === 'later' && (
        <p className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
          <span className="text-muted-foreground">{t.staysOnAccount}</span>
          <Money cents={owedCents} tone="debt" className="font-medium" />
        </p>
      )}
    </div>
  );
}

export interface RecipientOption {
  key: Recipient;
  label: string;
}

function RecipientSelect({
  id,
  value,
  options,
  onChange,
  label,
  taken,
}: {
  id: string;
  value: Recipient | '';
  options: readonly RecipientOption[];
  onChange: (value: Recipient) => void;
  label: string;
  taken?: ReadonlySet<string>;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        onChange(next as Recipient);
      }}
    >
      <SelectTrigger id={id} aria-label={label} className="w-full min-w-0">
        <SelectValue placeholder={t.transfer.choose} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.key}
            value={option.key}
            disabled={taken?.has(option.key) === true && option.key !== value}
          >
            <bdi>{option.label}</bdi>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Who takes over a part (their ownership of the shop, or their share of the profit): one person,
 * several in parts that must come to all of it, or (profit only) no one in particular. `totalBp`
 * is what is handed over: shown as it is, and the parts are checked against it.
 */
export function TransferEditor({
  heading,
  totalBp,
  options,
  choice,
  onChange,
  allowSpread,
  rowsHint,
  showErrors,
  children,
}: {
  heading: string;
  totalBp: number;
  options: readonly RecipientOption[];
  choice: TransferChoice;
  onChange: (choice: TransferChoice) => void;
  allowSpread: boolean;
  rowsHint: string;
  showErrors: boolean;
  /** What the choice leads to, shown under it as soon as it is complete. */
  children?: ReactNode;
}) {
  const id = useId();
  const parts = transferOf(choice, totalBp);
  const taken = new Set(
    choice.mode === 'several' ? choice.rows.map((row) => row.to).filter((to) => to !== '') : [],
  );
  return (
    <div className="grid content-start gap-3">
      <p className="font-medium">{heading}</p>
      <RadioGroup
        value={choice.mode === 'unset' ? '' : choice.mode}
        onValueChange={(mode) => {
          if (mode === 'one') onChange({ mode: 'one', to: '' });
          if (mode === 'several') onChange({ mode: 'several', rows: [{ to: '', text: '' }] });
          if (mode === 'spread') onChange({ mode: 'spread' });
        }}
        aria-label={heading}
      >
        <ChoiceRow value="one" label={t.transfer.modeOne} />
        <ChoiceRow value="several" label={t.transfer.modeSeveral} />
        {allowSpread && (
          <ChoiceRow value="spread" label={t.transfer.modeSpread} hint={t.transfer.spreadHint} />
        )}
      </RadioGroup>
      {choice.mode === 'one' && (
        <Field data-invalid={(showErrors && choice.to === '') || undefined}>
          <FieldLabel htmlFor={`${id}-to`}>{t.transfer.goesTo}</FieldLabel>
          <RecipientSelect
            id={`${id}-to`}
            value={choice.to}
            options={options}
            label={t.transfer.goesTo}
            onChange={(to) => {
              onChange({ mode: 'one', to });
            }}
          />
        </Field>
      )}
      {choice.mode === 'several' && (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">{rowsHint}</p>
          {choice.rows.map((row, index) => (
            <div
              // The rows are the owner's drafts, in order, and are only added at the end or removed.
              // eslint-disable-next-line @eslint-react/no-array-index-key
              key={index}
              className="grid grid-cols-[1fr_6.5rem_auto] items-end gap-2"
            >
              <Field>
                <FieldLabel htmlFor={`${id}-to-${String(index)}`} className="sr-only">
                  {t.transfer.goesTo}
                </FieldLabel>
                <RecipientSelect
                  id={`${id}-to-${String(index)}`}
                  value={row.to}
                  options={options}
                  taken={taken}
                  label={t.transfer.goesTo}
                  onChange={(to) => {
                    onChange({
                      mode: 'several',
                      rows: choice.rows.map((current, at) =>
                        at === index ? { ...current, to } : current,
                      ),
                    });
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-part-${String(index)}`} className="sr-only">
                  {t.transfer.part}
                </FieldLabel>
                <Input
                  id={`${id}-part-${String(index)}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="%"
                  aria-label={t.transfer.part}
                  value={row.text}
                  onChange={(event) => {
                    onChange({
                      mode: 'several',
                      rows: choice.rows.map((current, at) =>
                        at === index ? { ...current, text: event.target.value } : current,
                      ),
                    });
                  }}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t.transfer.removePerson}
                disabled={choice.rows.length === 1}
                onClick={() => {
                  onChange({ mode: 'several', rows: choice.rows.filter((_, at) => at !== index) });
                }}
              >
                <XIcon aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={choice.rows.length >= options.length}
              onClick={() => {
                onChange({ mode: 'several', rows: [...choice.rows, { to: '', text: '' }] });
              }}
            >
              <PlusIcon aria-hidden />
              {t.transfer.addPerson}
            </Button>
            <p
              className={cn(
                'text-sm',
                parts.leftBp === 0 ? 'text-muted-foreground' : 'font-medium text-debt',
              )}
              role={showErrors && !parts.chosen ? 'alert' : undefined}
            >
              {t.transfer.left(formatBp(parts.leftBp))}
            </p>
          </div>
        </div>
      )}
      {parts.chosen && children}
    </div>
  );
}
