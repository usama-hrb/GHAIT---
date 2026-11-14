'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { messages } from '@/i18n';
import {
  ApiError,
  NetworkError,
  useRegistrationOpen,
  useSession,
  WrongShopError,
} from '@/local-db';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { AuthLayout } from './auth-layout';
import { destinationAfterSignIn } from './change-password-model';
import { PasswordField } from './password-field';

const t = messages.auth;

/** Only same-app paths: `next` comes from the URL. */
function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/home';
}

function errorText(error: unknown): string {
  if (error instanceof NetworkError) return t.errors.network;
  if (error instanceof WrongShopError) return t.wrongShop;
  // Said only to someone who knew the password (ADR 0024).
  if (
    error instanceof ApiError &&
    error.issues.some((issue) => issue.code === 'account_deactivated')
  ) {
    return t.deactivated;
  }
  if (error instanceof ApiError && error.code in t.errors) {
    return t.errors[error.code as keyof typeof t.errors];
  }
  return t.errors.unknown;
}

/**
 * Sign in (needs the network once per device; ADR 0004). Also where the app sends the owner
 * when the server refused the session: local work is kept and syncs after signing in. While the
 * server has no owner yet, a link leads to the shop's first-owner sign-up (ADR 0023).
 */
export function LoginScreen() {
  const id = useId();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const session = useSession();
  const registration = useRegistrationOpen();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A second tap before the first answer comes back must not send a second request. */
  const sendingRef = useRef(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session.status === 'signed_in' && !session.needsSignIn) {
      router.replace(destinationAfterSignIn(session.user ?? { mustChangePassword: false }, next));
    }
  }, [session.status, session.needsSignIn, session.user, router, next]);

  const knownUser = session.user?.username;
  const typedUsername = knownUser ?? username;
  const usernameError = tried && typedUsername.trim() === '' ? t.usernameRequired : null;
  const passwordError = tried && password === '' ? t.passwordRequired : null;

  const submit = () => {
    if (sendingRef.current) return;
    setTried(true);
    setError(null);
    if (typedUsername.trim() === '') {
      usernameRef.current?.focus();
      return;
    }
    if (password === '') {
      passwordRef.current?.focus();
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    session
      .login({ username: typedUsername, password })
      .then((user) => {
        router.replace(destinationAfterSignIn(user, next));
      })
      .catch((caught: unknown) => {
        setError(errorText(caught));
        setBusy(false);
        sendingRef.current = false;
      });
  };

  return (
    <AuthLayout>
      <form
        noValidate
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-1.5">
          <h1 className="font-heading text-2xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground">
            {session.needsSignIn ? messages.sync.signInAgainDescription : t.description}
          </p>
        </div>
        {error && (
          <Alert variant="destructive" aria-live="assertive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <Field data-invalid={usernameError !== null}>
            <FieldLabel htmlFor={`${id}-username`}>{t.username}</FieldLabel>
            <Input
              ref={usernameRef}
              id={`${id}-username`}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              className="text-start"
              value={typedUsername}
              readOnly={knownUser !== undefined}
              disabled={busy}
              aria-invalid={usernameError !== null}
              aria-describedby={usernameError === null ? undefined : `${id}-username-error`}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
            />
            {usernameError !== null && (
              <FieldError id={`${id}-username-error`}>{usernameError}</FieldError>
            )}
          </Field>
          <PasswordField
            inputRef={passwordRef}
            id={`${id}-password`}
            label={t.password}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            error={passwordError}
            disabled={busy}
          />
        </FieldGroup>
        <Button type="submit" variant="accent" size="lg" disabled={busy} aria-busy={busy}>
          {busy ? t.submitting : t.submit}
        </Button>
        {registration.state === 'open' && session.status !== 'signed_in' && (
          <p className="text-center text-sm text-muted-foreground">
            {t.newShop}{' '}
            <Link
              href="/signup"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              {t.createShop}
            </Link>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
