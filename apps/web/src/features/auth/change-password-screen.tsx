'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { messages } from '@/i18n';
import { ApiError, NetworkError, useSession } from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { FieldGroup } from '@/shared/ui/field';
import { AuthLayout } from './auth-layout';
import {
  type ChangePasswordProblem,
  changePasswordProblems,
  emptyChangePasswordDraft,
} from './change-password-model';
import { PasswordField } from './password-field';

/** Why the server refused, in words. Its issue code says which rule; anything else is generic. */
function failureText(error: unknown): string {
  const t = messages.auth.changePassword.errors;
  if (error instanceof NetworkError) return t.network;
  if (error instanceof ApiError) {
    for (const issue of error.issues) {
      if (issue.code === 'wrong_password') return t.wrong_password;
      if (issue.code === 'password_unchanged') return t.password_unchanged;
    }
  }
  return t.unknown;
}

/**
 * The page an account lands on when it signed in with the temporary password the owner gave it
 * (ADR 0024): it can do nothing else until it has chosen its own. The shop's layout sends it here;
 * once the server accepts the new password the account goes on to the shop. Needs the connection,
 * because the server checks and stores the password. Leaving without choosing is signing out.
 */
export function ChangePasswordScreen() {
  const t = messages.auth.changePassword;
  const id = useId();
  const router = useRouter();
  const session = useSession();
  const [draft, setDraft] = useState(emptyChangePasswordDraft);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A second tap before the first answer comes back must not send a second request. */
  const sendingRef = useRef(false);

  useEffect(() => {
    if (session.status === 'signed_out') router.replace('/login');
    else if (session.status === 'signed_in' && session.user && !session.user.mustChangePassword) {
      router.replace('/home');
    }
  }, [session.status, session.user, router]);

  if (session.status !== 'signed_in' || !session.user?.mustChangePassword) {
    return <LoadingState variant="spinner" />;
  }

  const problems = changePasswordProblems(draft);
  const shown = (field: keyof typeof problems) => (tried ? problems[field] : undefined);
  const text = (problem: ChangePasswordProblem | undefined, field: keyof typeof problems) => {
    if (!problem) return null;
    if (problem === 'required') {
      return field === 'currentPassword' ? t.currentRequired : messages.forms.required;
    }
    return problem === 'tooShort' ? t.short : t.mismatch;
  };

  const submit = () => {
    if (sendingRef.current) return;
    setTried(true);
    setFailure(null);
    if (Object.keys(problems).length > 0) return;
    sendingRef.current = true;
    setBusy(true);
    session
      .changePassword(draft)
      .then(() => {
        router.replace('/home');
      })
      .catch((caught: unknown) => {
        setFailure(failureText(caught));
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
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        <OfflineNotice />
        {failure && (
          <Alert variant="destructive" aria-live="assertive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <PasswordField
            id={`${id}-current`}
            label={t.current}
            value={draft.currentPassword}
            onChange={(currentPassword) => {
              setDraft((previous) => ({ ...previous, currentPassword }));
            }}
            autoComplete="current-password"
            error={text(shown('currentPassword'), 'currentPassword')}
            disabled={busy}
          />
          <PasswordField
            id={`${id}-new`}
            label={t.newPassword}
            value={draft.newPassword}
            onChange={(newPassword) => {
              setDraft((previous) => ({ ...previous, newPassword }));
            }}
            autoComplete="new-password"
            hint={t.newPasswordHint}
            error={text(shown('newPassword'), 'newPassword')}
            disabled={busy}
          />
          <PasswordField
            id={`${id}-confirm`}
            label={t.confirm}
            value={draft.confirmPassword}
            onChange={(confirmPassword) => {
              setDraft((previous) => ({ ...previous, confirmPassword }));
            }}
            autoComplete="new-password"
            error={text(shown('confirmPassword'), 'confirmPassword')}
            disabled={busy}
          />
        </FieldGroup>
        <div className="grid gap-2">
          <Button type="submit" variant="accent" size="lg" disabled={busy} aria-busy={busy}>
            {busy ? t.submitting : t.submit}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void session.logout().then(() => {
                router.replace('/login');
              });
            }}
          >
            {messages.auth.signOut}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
