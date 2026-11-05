'use client';

import { parseScaledDecimal } from '@fabric/core';
import { messages } from '@/i18n';
import { DecimalInput, type DecimalInputProps } from './decimal-input';

/** Pieces counted in whole numbers; `onValueChange` receives the integer or null. */
export function CountInput(props: DecimalInputProps) {
  return (
    <DecimalInput
      {...props}
      parse={(text) => parseScaledDecimal(text, 0)}
      format={(count) => String(count)}
      formatKey="pieces"
      addon={messages.units.piece}
      errors={messages.countInputErrors}
    />
  );
}
