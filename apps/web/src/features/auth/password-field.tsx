'use client';

import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { type ReactNode, type Ref, useState } from 'react';
import { messages } from '@/i18n';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/shared/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/shared/ui/input-group';

/**
 * A password input with a button that shows or hides what was typed. It is always read left to
 * right, as an email is, and a hint or an error sits under it (the error wins). `children` renders
 * between the input and that line, for a strength meter.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  autoComplete,
  error,
  hint,
  disabled,
  inputRef,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string | null;
  hint?: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  children?: ReactNode;
}) {
  const t = messages.auth;
  const [shown, setShown] = useState(false);
  const note = error ?? hint ?? null;
  return (
    <Field data-invalid={error != null}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          ref={inputRef}
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          className="text-start"
          value={value}
          disabled={disabled}
          aria-invalid={error != null}
          aria-describedby={note === null ? undefined : `${id}-note`}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onBlur={onBlur}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            className="pointer-coarse:size-10"
            disabled={disabled}
            aria-label={shown ? t.hidePassword : t.showPassword}
            onClick={() => {
              setShown((current) => !current);
            }}
          >
            {shown ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {children}
      {error != null ? (
        <FieldError id={`${id}-note`}>{error}</FieldError>
      ) : hint !== undefined ? (
        <FieldDescription id={`${id}-note`}>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}
