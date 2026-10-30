'use client';

import { formatMoneyAmount, type MoneyUnit, parseMoneyInput } from '@fabric/core';
import { messages } from '@/i18n';
import { DecimalInput, type DecimalInputProps } from './decimal-input';
import { moneyUnitLabel } from './money';
import { useMoneyUnit } from './money-unit';

/**
 * Amount field: the user types rial or dirham (Arabic-Indic digits accepted),
 * `onValueChange` receives integer cents, or null while empty or invalid.
 */
export function MoneyInput({
  unit,
  allowNegative = false,
  ...props
}: DecimalInputProps & { unit?: MoneyUnit; allowNegative?: boolean }) {
  const { unit: settingUnit } = useMoneyUnit();
  const shownUnit = unit ?? settingUnit;
  return (
    <DecimalInput
      {...props}
      parse={(text) => parseMoneyInput(text, shownUnit, { allowNegative })}
      format={(cents) => formatMoneyAmount(cents, shownUnit, { grouping: false })}
      formatKey={shownUnit}
      addon={moneyUnitLabel(shownUnit)}
      errors={messages.moneyInputErrors}
    />
  );
}
