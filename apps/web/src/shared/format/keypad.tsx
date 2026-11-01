'use client';

import type { MoneyUnit } from '@fabric/core';
import { DeleteIcon } from 'lucide-react';
import { useState } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'backspace';

export interface PadRules {
  /** How many digits may follow the decimal point (0 = whole numbers only). */
  maxDecimals: number;
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 9;
const SEPARATOR = /[.,٫]/;

/** Lengths are typed in metres to the centimetre: 2.75. */
export const LENGTH_PAD: PadRules = { maxDecimals: 2 };

/** Rial amounts are whole cents, so one decimal at most (869.6); dirham amounts take two. */
export const moneyPad = (unit: MoneyUnit): PadRules => ({ maxDecimals: unit === 'rial' ? 1 : 2 });

/**
 * The text after one key of the keypad: no second decimal point, no leading zero, no more
 * decimals than the unit has. Parsing it into cents or cm stays with the @fabric/core helpers.
 */
export function pressKey(text: string, key: PadKey, rules: PadRules): string {
  if (key === 'backspace') return text.slice(0, -1);
  if (key === '.') {
    if (rules.maxDecimals === 0 || SEPARATOR.test(text)) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  if (text.length >= (rules.maxLength ?? DEFAULT_MAX_LENGTH)) return text;
  const separator = text.search(SEPARATOR);
  if (separator >= 0 && text.length - separator - 1 >= rules.maxDecimals) return text;
  return text === '0' ? key : `${text}${key}`;
}

/**
 * The typed text of the fields one keypad serves, and which of them it types into. The next key
 * after a field is chosen (or filled by a quick button) replaces what it holds instead of adding
 * to it: a prefilled price is overwritten by the first digit, as on a calculator.
 */
export function usePadFields<K extends string>(
  initial: Record<K, string>,
  rules: Record<K, PadRules>,
  first: K,
) {
  const [texts, setTexts] = useState<Record<K, string>>(initial);
  const [active, setActive] = useState<K>(first);
  const [fresh, setFresh] = useState<K | null>(first);

  return {
    texts,
    active,
    /** The field the keypad types into. */
    activate: (field: K) => {
      setActive(field);
      setFresh(field);
    },
    /** One key of the keypad. */
    press: (key: PadKey) => {
      const replace = fresh === active && key !== 'backspace';
      setTexts((current) => ({
        ...current,
        [active]: pressKey(replace ? '' : current[active], key, rules[active]),
      }));
      setFresh(null);
    },
    /** What the physical keyboard typed into a field. */
    type: (field: K, text: string) => {
      setTexts((current) => ({ ...current, [field]: text }));
      setFresh(null);
    },
    /** A quick button's value; the next digit replaces it. */
    fill: (field: K, text: string) => {
      setTexts((current) => ({ ...current, [field]: text }));
      setActive(field);
      setFresh(field);
    },
  };
}

const ROWS: readonly PadKey[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '.',
  '0',
  'backspace',
];

/** Big number keys for a tablet; the field being typed in keeps the focus, so a keyboard still works. */
export function Keypad({
  onPress,
  className,
}: {
  onPress: (key: PadKey) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={messages.keypad.label}
      // Digits read left to right in Arabic too: 1 2 3 / 4 5 6, as on every phone and calculator.
      dir="ltr"
      className={cn('grid grid-cols-3 gap-2', className)}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
    >
      {ROWS.map((key) => (
        <Button
          key={key}
          type="button"
          variant="outline"
          className="h-14 touch-manipulation text-xl font-semibold select-none pointer-coarse:h-16"
          aria-label={
            key === 'backspace'
              ? messages.keypad.backspace
              : key === '.'
                ? messages.keypad.decimal
                : undefined
          }
          onClick={() => {
            onPress(key);
          }}
        >
          {key === 'backspace' ? <DeleteIcon aria-hidden /> : key}
        </Button>
      ))}
    </div>
  );
}
