'use client';

import { formatLengthMeters, parseLengthInput } from '@fabric/core';
import { messages } from '@/i18n';
import { DecimalInput, type DecimalInputProps } from './decimal-input';

/** Length field in metres to 1 cm precision; `onValueChange` receives integer cm or null. */
export function MeterInput({
  allowNegative = false,
  ...props
}: DecimalInputProps & { allowNegative?: boolean }) {
  return (
    <DecimalInput
      {...props}
      parse={(text) => parseLengthInput(text, { allowNegative })}
      format={(cm) => formatLengthMeters(cm, { grouping: false })}
      formatKey="m"
      addon={messages.units.meter}
      errors={messages.lengthInputErrors}
    />
  );
}
