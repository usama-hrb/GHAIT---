'use client';

import type { MoneyUnit } from '@fabric/core';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useRepositories } from '@/local-db';
import { Money, useMoneyUnit } from '@/shared/format';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/shared/ui/field';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { saveFailureOf } from './save-failure';
import { SettingsNotice, useSettingsAccess } from './settings-access';

const UNITS = ['rial', 'dirham'] as const satisfies readonly MoneyUnit[];
/** Amounts to show how a figure reads: a price per metre, a balance, a day's expense (in cents). */
const SAMPLES = [
  { key: 'price', cents: 2050 },
  { key: 'expense', cents: 12_345 },
  { key: 'balance', cents: 150_000 },
] as const;

/**
 * The currency amounts are typed and shown in (ADR 0017): Moroccan rial or dirham (DH). It is the
 * `money_display_unit` setting, read by every screen through <Money/> and <MoneyInput/>. Every
 * amount is stored as whole cents whichever is chosen, so switching never changes a stored value
 * (nothing is converted, rounded or re-saved): it only changes how one is written and read. The
 * screen says so, and shows the same sample amounts in the unit being chosen before it is saved.
 */
export function RegionalScreen() {
  const t = messages.settings;
  const r = t.regional;
  const id = useId();
  const repositories = useRepositories();
  const { unit: savedUnit } = useMoneyUnit();
  const { isOwner, online, canEdit } = useSettingsAccess();
  const [draft, setDraft] = useState<MoneyUnit | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const unit = draft ?? savedUnit;
  const dirty = unit !== savedUnit;
  const other: MoneyUnit = unit === 'rial' ? 'dirham' : 'rial';

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await repositories.settings.save('money_display_unit', unit);
      setDraft(null);
      toast.success(r.saved);
    } catch (error) {
      setFailure(r.failed[saveFailureOf(error)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canEdit && dirty && !saving) void save();
      }}
    >
      <header className="grid gap-0.5">
        <h2 className="font-heading text-xl font-semibold">{t.sections.regional.title}</h2>
        <p className="text-sm text-muted-foreground">{r.description}</p>
      </header>

      <SettingsNotice isOwner={isOwner} online={online} />

      <Card>
        <CardHeader>
          <CardTitle>{r.unit.title}</CardTitle>
          <CardDescription>{r.unit.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={unit}
            aria-label={r.unit.title}
            disabled={!canEdit}
            className="grid gap-2 sm:grid-cols-2"
            onValueChange={(value) => {
              setDraft(value === 'dirham' ? 'dirham' : 'rial');
            }}
          >
            {UNITS.map((option) => (
              <FieldLabel
                key={option}
                htmlFor={`${id}-${option}`}
                className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>
                      {r.unit[option].title}
                      {savedUnit === option && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {r.unit.current}
                        </span>
                      )}
                    </FieldTitle>
                    <FieldDescription>{r.unit[option].hint}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={option} id={`${id}-${option}`} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
          <p className="mt-3 text-sm font-medium">{r.rate}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{r.example.title}</CardTitle>
          <CardDescription>{r.example.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="regional-example">
            <TableHeader>
              <TableRow>
                <TableHead>{r.example.what}</TableHead>
                <TableHead className="text-end">{r.example.shown}</TableHead>
                <TableHead className="text-end">{r.example.same}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLES.map((sample) => (
                <TableRow key={sample.key}>
                  <TableCell>{r.example.samples[sample.key]}</TableCell>
                  <TableCell className="text-end font-medium">
                    <Money cents={sample.cents} unit={unit} />
                  </TableCell>
                  <TableCell className="text-end text-muted-foreground">
                    <Money cents={sample.cents} unit={other} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Alert role="note">
        <AlertDescription>
          <span className="font-medium">{r.safe.title}</span> {r.safe.body}
        </AlertDescription>
      </Alert>

      {failure !== null && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      {isOwner && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p role="status" className="text-sm text-muted-foreground">
            {dirty ? t.unsaved : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(null);
                setFailure(null);
              }}
            >
              {t.discard}
            </Button>
            <Button type="submit" variant="accent" disabled={!canEdit || !dirty || saving}>
              {saving ? messages.forms.saving : t.save}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
