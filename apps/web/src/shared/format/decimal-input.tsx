'use client';

import type { ParseError, ParseResult } from '@fabric/core';
import { CircleAlertIcon } from 'lucide-react';
import { type ComponentProps, useId, useState } from 'react';
import { FieldError } from '@/shared/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/shared/ui/input-group';

export interface DecimalInputProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'
> {
  /** Integer value (cents, cm) or null when the field is empty or invalid. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** An empty field is an error only when required. */
  required?: boolean;
  /** Show the error even before the first blur, e.g. after a submit attempt. */
  showError?: boolean;
}

interface Codec {
  parse: (text: string) => ParseResult<number>;
  format: (value: number) => string;
  /** Changes when the display unit changes, so the text is re-rendered in the new unit. */
  formatKey: string;
  addon: string;
  errors: Record<ParseError, string>;
}

/**
 * Shared engine of MoneyInput and MeterInput: keeps the typed text, parses it with
 * @fabric/core on every change and reports the integer value (never a float).
 * Errors show after the first blur, below the field, with an icon.
 */
export function DecimalInput({
  value,
  onValueChange,
  required = false,
  showError: forceError = false,
  id,
  className,
  onBlur,
  parse,
  format,
  formatKey,
  addon,
  errors,
  ...inputProps
}: DecimalInputProps & Codec) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const errorId = `${inputId}-error`;
  const [touched, setTouched] = useState(false);
  const [state, setState] = useState(() => ({
    text: value === null ? '' : format(value),
    value,
    formatKey,
  }));

  // A new value from outside (reset, unit toggle) replaces the text; our own echo does not.
  if (state.value !== value || state.formatKey !== formatKey) {
    setState({ text: value === null ? '' : format(value), value, formatKey });
  }

  const result = parse(state.text);
  const error = result.ok || (result.error === 'empty' && !required) ? null : errors[result.error];
  const showError = (touched || forceError) && error !== null;

  return (
    <div className="grid gap-1.5">
      <InputGroup className={className}>
        <InputGroupInput
          {...inputProps}
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          // Digits, sign and decimal point stay in LTR order; aligned to the RTL start edge.
          dir="ltr"
          className="text-end"
          value={state.text}
          required={required}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? errorId : undefined}
          onChange={(event) => {
            const text = event.target.value;
            const parsed = parse(text);
            const next = parsed.ok ? parsed.value : null;
            setState({ text, value: next, formatKey });
            onValueChange(next);
          }}
          onBlur={(event) => {
            setTouched(true);
            onBlur?.(event);
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{addon}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {showError && (
        <FieldError id={errorId} className="flex items-center gap-1.5">
          <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
          {error}
        </FieldError>
      )}
    </div>
  );
}
