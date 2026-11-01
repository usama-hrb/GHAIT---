'use client';

import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { designMessages as t } from '@/i18n/ar.design';
import { DateText, MeterInput, Meters, Money, MoneyInput, type MoneyTone } from '@/shared/format';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Demo, Section } from './section';

const TONES: { tone: MoneyTone; label: string }[] = [
  { tone: 'profit', label: t.format.profit },
  { tone: 'loss', label: t.format.loss },
  { tone: 'debt', label: t.format.debt },
  { tone: 'capital', label: t.format.capital },
  { tone: 'estimated', label: t.format.estimated },
];

const SAMPLE_DATE = '2026-10-29T10:30:00Z';

export function FormatSection() {
  const baseId = useId();
  const [cents, setCents] = useState<number | null>(4348);
  const [cm, setCm] = useState<number | null>(255);

  return (
    <Section id="format" title={t.sections.format}>
      <Demo title={t.format.money} className="gap-6">
        <Money cents={2050} />
        <Money cents={2050} unit="dirham" />
        <Money cents={4348} />
        <Money cents={4348} unit="dirham" />
        <Money cents={3_000_000} />
        <Money cents={-2050} />
        <Money cents={1} />
      </Demo>
      <Demo title={t.format.tones} className="gap-6">
        {TONES.map(({ tone, label }) => (
          <span key={tone} className="inline-flex items-center gap-1.5">
            {tone === 'loss' ? (
              <TrendingDownIcon className="size-4 text-loss" aria-hidden />
            ) : (
              <TrendingUpIcon className="size-4 text-profit" aria-hidden />
            )}
            <span className="text-sm">{label}</span>
            <Money cents={tone === 'loss' ? -480 : 30_000} tone={tone} />
          </span>
        ))}
      </Demo>
      <Demo title={t.format.lengths} className="gap-6">
        <Meters cm={275} />
        <Meters cm={250} />
        <Meters cm={5000} />
        <Meters cm={1} />
        <Meters cm={123_456} />
      </Demo>
      <Demo title={t.format.dates} className="gap-6">
        <DateText value={SAMPLE_DATE} format="short" />
        <DateText value={SAMPLE_DATE} />
        <DateText value={SAMPLE_DATE} format="long" />
        <DateText value={SAMPLE_DATE} format="dateTime" />
      </Demo>
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${baseId}-m`}>{t.form.price}</FieldLabel>
          <MoneyInput id={`${baseId}-m`} value={cents} onValueChange={setCents} />
          <FieldDescription>
            {t.form.valueCents}: <span data-num>{cents ?? '—'}</span>
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${baseId}-l`}>{t.form.length}</FieldLabel>
          <MeterInput id={`${baseId}-l`} value={cm} onValueChange={setCm} />
          <FieldDescription>
            {t.form.valueCents}: <span data-num>{cm ?? '—'}</span>
          </FieldDescription>
        </Field>
      </div>
    </Section>
  );
}
