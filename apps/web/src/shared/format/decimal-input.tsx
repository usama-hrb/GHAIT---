'use client';

import type { ParseError, ParseResult } from '@fabric/core';
import { CircleAlertIcon } from 'lucide-react';
import { type ComponentProps, useId, useState } from 'react';
import { cn } from '@/shared/lib/utils';
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
  onValueChange?: (value: number | null) => void;
  /** An empty field is an error only when required. */
  required?: boolean;
  /** Show the error even before the first blur, e.g. after a submit attempt. */
  showError?: boolean;
  /**
   * The typed text, kept by the parent so a keypad can edit it too (then `value` is what the
   * parent parsed from it). Without it the input keeps its own text.
   */
  text?: string;
  onTextChange?: (text: string) => void;
  /** A keypad is on screen: no system keyboard (inputMode none); a physical keyboard still types. */
  keypad?: boolean;
  /** A big figure, for a keypad. */
  large?: boolean;
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
  text: controlledText,
  onTextChange,
  keypad = false,
  large = false,
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
  const controlled = controlledText !== undefined;
  if (!controlled && (state.value !== value || state.formatKey !== formatKey)) {
    setState({ text: value === null ? '' : format(value), value, formatKey });
  }
  const text = controlledText ?? state.text;

  const result = parse(text);
  const error = result.ok || (result.error === 'empty' && !required) ? null : errors[result.error];
  const showError = (touched || forceError) && error !== null;

  return (
    <div className="grid gap-1.5">
      <InputGroup className={cn(large && 'h-16 pointer-coarse:h-16', className)}>
        <InputGroupInput
          {...inputProps}
          id={inputId}
          inputMode={keypad ? 'none' : 'decimal'}
          autoComplete="off"
          // Digits, sign and decimal point stay in LTR order; aligned to the RTL start edge.
          dir="ltr"
          className={cn(
            'text-end',
            large && 'h-full text-3xl font-semibold md:text-3xl pointer-coarse:h-full',
          )}
          value={text}
          required={required}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? errorId : undefined}
          onChange={(event) => {
            const typed = event.target.value;
            const parsed = parse(typed);
            const next = parsed.ok ? parsed.value : null;
            if (controlled) onTextChange?.(typed);
            else setState({ text: typed, value: next, formatKey });
            onValueChange?.(next);
          }}
          onBlur={(event) => {
            setTouched(true);
            onBlur?.(event);
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className={cn(large && 'text-lg')}>{addon}</InputGroupText>
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
