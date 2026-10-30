'use client';

import { formatMoneyAmount, type MoneyUnit } from '@fabric/core';
import { cn } from '@/shared/lib/utils';
import { messages } from '@/i18n';
import { useMoneyUnit } from './money-unit';

export type MoneyTone = 'profit' | 'loss' | 'debt' | 'capital' | 'estimated';

const TONE_CLASS: Record<MoneyTone, string> = {
  profit: 'text-profit',
  loss: 'text-loss',
  debt: 'text-debt',
  capital: 'text-capital',
  estimated: 'text-estimated',
};

export function moneyUnitLabel(unit: MoneyUnit): string {
  return unit === 'rial' ? messages.units.rial : messages.units.dirham;
}

/**
 * An amount stored in cents, shown in the display unit setting (or `unit`).
 * A tone only colours the figure: pair it with a word or icon, never colour alone.
 */
export function Money({
  cents,
  unit,
  tone,
  showUnit = true,
  className,
}: {
  cents: number;
  unit?: MoneyUnit;
  tone?: MoneyTone;
  showUnit?: boolean;
  className?: string;
}) {
  const { unit: settingUnit } = useMoneyUnit();
  const shownUnit = unit ?? settingUnit;
  return (
    <span data-num className={cn('whitespace-nowrap', tone && TONE_CLASS[tone], className)}>
      <bdi>{formatMoneyAmount(cents, shownUnit)}</bdi>
      {showUnit && `\u00A0${moneyUnitLabel(shownUnit)}`}
    </span>
  );
}
