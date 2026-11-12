'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useRepositories, type ZakatOptions } from '@/local-db';
import { useOnlineStatus } from '@/shared/brand';
import { DateText, MoneyInput } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import { zakatSettingsErrorText } from './zakat-errors';
import {
  checkZakatSettings,
  type ZakatSettingsDraft,
  type ZakatSettingsError,
} from './zakat-model';
import { CollapsibleSection } from './zakat-ui';

const t = messages.zakat;

const draftOf = (options: ZakatOptions): ZakatSettingsDraft => ({
  hawlStart: options.hawlStart ?? '',
  nisabMetal: options.nisabMetal,
  goodsValuation: options.goodsValuation,
  includeDoubtfulDebts: options.includeDoubtfulDebts,
  goldCents: options.goldPrice?.pricePerGramCents ?? null,
  goldDate: options.goldPrice?.date ?? '',
  silverCents: options.silverPrice?.pricePerGramCents ?? null,
  silverDate: options.silverPrice?.date ?? '',
  reminderDays: String(options.reminderDays),
});

/** A price per gram and the day it was seen: both or neither, as the methodology keeps it. */
function PriceField({
  id,
  label,
  cents,
  date,
  invalid,
  disabled,
  onCents,
  onDate,
}: {
  id: string;
  label: string;
  cents: number | null;
  date: string;
  invalid: boolean;
  disabled: boolean;
  onCents: (cents: number | null) => void;
  onDate: (date: string) => void;
}) {
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="grid gap-2 @md:grid-cols-2">
        <MoneyInput
          id={id}
          value={cents}
          onValueChange={onCents}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
        />
        <Input
          aria-label={`${label}: ${t.fields.priceDate}`}
          type="date"
          value={date}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => {
            onDate(event.target.value);
          }}
        />
      </div>
      {invalid && <FieldError id={`${id}-error`}>{t.settings.errors.price}</FieldError>}
    </Field>
  );
}

/**
 * The methodology form: three groups (the hawl, the methodology, the market prices), each with what
 * its fields mean. Only the owner changes it. What is saved is only what changed, checked first:
 * a price needs its amount and its day together, the reminder a whole number of days. A change
 * reaches the calculations made after it; a saved report keeps the settings it was made with.
 */
export function ZakatSettingsForm({
  options,
  canEdit,
}: {
  options: ZakatOptions;
  canEdit: boolean;
}) {
  const id = useId();
  const repositories = useRepositories();
  const online = useOnlineStatus();
  const [draft, setDraft] = useState(() => draftOf(options));
  const [errors, setErrors] = useState<readonly ZakatSettingsError[]>([]);
  const [busy, setBusy] = useState(false);
  const disabled = !canEdit || busy;
  const groups = t.settings.groups;

  function change(patch: Partial<ZakatSettingsDraft>, fixes?: ZakatSettingsError) {
    setDraft((current) => ({ ...current, ...patch }));
    if (fixes !== undefined) setErrors((current) => current.filter((error) => error !== fixes));
  }

  function submit() {
    if (!canEdit || busy) return;
    const check = checkZakatSettings(draft);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    repositories.zakat
      .saveOptions(check.options)
      .then((changed) => {
        toast.success(changed.length === 0 ? t.settings.unchanged : t.settings.saved);
      })
      .catch((error: unknown) => {
        toast.error(zakatSettingsErrorText(error));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <CollapsibleSection
        defaultOpen
        title={groups.hawl.title}
        description={groups.hawl.description}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-start`}>{t.fields.hawlStart}</FieldLabel>
            <Input
              id={`${id}-start`}
              type="date"
              value={draft.hawlStart}
              disabled={disabled}
              onChange={(event) => {
                change({ hawlStart: event.target.value });
              }}
            />
            {draft.hawlStart !== '' && (
              <p className="text-sm text-muted-foreground">
                <DateText value={draft.hawlStart} format="hijri" />
              </p>
            )}
            <FieldDescription>{t.hints.hawlStart}</FieldDescription>
          </Field>
          <Field data-invalid={errors.includes('reminder')}>
            <FieldLabel htmlFor={`${id}-reminder`}>{t.fields.reminderDays}</FieldLabel>
            <Input
              id={`${id}-reminder`}
              inputMode="numeric"
              dir="ltr"
              value={draft.reminderDays}
              disabled={disabled}
              aria-invalid={errors.includes('reminder')}
              aria-describedby={errors.includes('reminder') ? `${id}-reminder-error` : undefined}
              onChange={(event) => {
                change({ reminderDays: event.target.value }, 'reminder');
              }}
            />
            <FieldDescription>{t.hints.reminderDays}</FieldDescription>
            {errors.includes('reminder') && (
              <FieldError id={`${id}-reminder-error`}>{t.settings.errors.reminder}</FieldError>
            )}
          </Field>
        </FieldGroup>
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen
        title={groups.methodology.title}
        description={groups.methodology.description}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-merchant`}>{t.fields.merchant}</FieldLabel>
            <Input id={`${id}-merchant`} value={t.managing} readOnly />
            <FieldDescription>{t.managingHint}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-metal`}>{t.fields.nisabMetal}</FieldLabel>
            <Select
              value={draft.nisabMetal}
              disabled={disabled}
              onValueChange={(value) => {
                change({ nisabMetal: value === 'silver' ? 'silver' : 'gold' });
              }}
            >
              <SelectTrigger id={`${id}-metal`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gold">{t.metals.gold}</SelectItem>
                <SelectItem value="silver">{t.metals.silver}</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>{t.hints.nisabMetal}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-valuation`}>{t.fields.valuation}</FieldLabel>
            <Select
              value={draft.goodsValuation}
              disabled={disabled}
              onValueChange={(value) => {
                change({ goodsValuation: value === 'cost' ? 'cost' : 'market' });
              }}
            >
              <SelectTrigger
                id={`${id}-valuation`}
                className="text-start whitespace-normal data-[size=default]:h-auto data-[size=default]:min-h-8 pointer-coarse:data-[size=default]:h-auto pointer-coarse:data-[size=default]:min-h-11 *:data-[slot=select-value]:line-clamp-none"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">{t.valuations.market}</SelectItem>
                <SelectItem value="cost">{t.valuations.cost}</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>{t.hints.valuation}</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch
              id={`${id}-doubtful`}
              checked={draft.includeDoubtfulDebts}
              disabled={disabled}
              onCheckedChange={(checked) => {
                change({ includeDoubtfulDebts: checked });
              }}
            />
            <div className="grid gap-0.5">
              <FieldLabel htmlFor={`${id}-doubtful`}>{t.fields.doubtful}</FieldLabel>
              <FieldDescription>{t.hints.doubtful}</FieldDescription>
            </div>
          </Field>
        </FieldGroup>
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen
        title={groups.prices.title}
        description={groups.prices.description}
      >
        <FieldGroup>
          <PriceField
            id={`${id}-gold`}
            label={t.fields.goldPrice}
            cents={draft.goldCents}
            date={draft.goldDate}
            invalid={errors.includes('gold')}
            disabled={disabled}
            onCents={(goldCents) => {
              change({ goldCents }, 'gold');
            }}
            onDate={(goldDate) => {
              change({ goldDate }, 'gold');
            }}
          />
          <PriceField
            id={`${id}-silver`}
            label={t.fields.silverPrice}
            cents={draft.silverCents}
            date={draft.silverDate}
            invalid={errors.includes('silver')}
            disabled={disabled}
            onCents={(silverCents) => {
              change({ silverCents }, 'silver');
            }}
            onDate={(silverDate) => {
              change({ silverDate }, 'silver');
            }}
          />
          <FieldDescription>{t.hints.price}</FieldDescription>
        </FieldGroup>
      </CollapsibleSection>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="accent" disabled={busy || !online}>
            {busy ? messages.forms.saving : t.settings.save}
          </Button>
          {!online && <span className="text-sm text-muted-foreground">{t.settings.offline}</span>}
        </div>
      )}
    </form>
  );
}
