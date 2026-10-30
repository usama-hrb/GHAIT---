'use client';

import { formatWeightKg, parseWeightInput } from '@fabric/core';
import { messages } from '@/i18n';
import { DecimalInput, type DecimalInputProps } from './decimal-input';

/** Weight field in kilograms to 1 g precision; `onValueChange` receives integer grams or null. */
export function WeightInput(props: DecimalInputProps) {
  return (
    <DecimalInput
      {...props}
      parse={parseWeightInput}
      format={(grams) => formatWeightKg(grams, { grouping: false })}
      formatKey="kg"
      addon={messages.units.kilogram}
      errors={messages.weightInputErrors}
    />
  );
}
