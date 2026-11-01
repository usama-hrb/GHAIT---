'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { messages } from '@/i18n';
import { ApiError, NetworkError, useSession } from '@/local-db';
import { Logo } from '@/shared/brand';
import { LanguageToggle } from '@/shared/language';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

const t = messages.auth;

/** Only same-app paths: `next` comes from the URL. */
function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/home';
}

function errorText(error: unknown): string {
  if (error instanceof NetworkError) return t.errors.network;
  if (error instanceof ApiError && error.code in t.errors) {
    return t.errors[error.code as keyof typeof t.errors];
  }
  return t.errors.unknown;
}

/**
 * Sign in (needs the network once per device; ADR 0004). Also where the app sends the owner
 * when the server refused the session: local work is kept and syncs after signing in.
 */
export function LoginScreen() {
  const id = useId();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const session = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status === 'signed_in' && !session.needsSignIn) router.replace(next);
  }, [session.status, session.needsSignIn, router, next]);

  const knownUser = session.user?.username;

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-burgundy-800 p-4">
      <LanguageToggle className="absolute end-3 top-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground" />
      <div className="grid w-full max-w-sm gap-6">
        <Logo className="mx-auto w-48" priority />
        <form
          noValidate
          className="grid gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-lg"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            session
              .login({ username: knownUser ?? username, password })
              .then(() => {
                router.replace(next);
              })
              .catch((caught: unknown) => {
                setError(errorText(caught));
                setBusy(false);
              });
          }}
        >
          <div className="grid gap-1.5">
            <h1 className="font-heading text-xl font-semibold">{t.title}</h1>
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
            <Field>
              <FieldLabel htmlFor={`${id}-username`}>{t.username}</FieldLabel>
              <Input
                id={`${id}-username`}
                autoComplete="username"
                autoCapitalize="none"
                dir="ltr"
                className="text-start"
                value={knownUser ?? username}
                readOnly={knownUser !== undefined}
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-password`}>{t.password}</FieldLabel>
              <Input
                id={`${id}-password`}
                type="password"
                autoComplete="current-password"
                dir="ltr"
                className="text-start"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" variant="accent" size="lg" disabled={busy || password === ''}>
            {busy ? t.submitting : t.submit}
          </Button>
        </form>
      </div>
    </main>
  );
}
