'use client';

import type { Account, EligiblePartner } from '@fabric/contracts';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { messages } from '@/i18n';
import { useRepositories } from '@/local-db';
import { VoidDialog } from '@/shared/brand';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';
import { type AccountFailure, accountFailure } from './account-errors';
import {
  accountName,
  accountProblems,
  type CashierDraft,
  type CashierProblem,
  emptyCashierDraft,
  trimmed,
} from './accounts-model';
import type { IssuedCredential } from './credential-dialog';

function FailureAlert({ failure }: { failure: AccountFailure | null }) {
  if (!failure) return null;
  return (
    <Alert variant="destructive" aria-live="assertive">
      <AlertDescription>{failure.message}</AlertDescription>
    </Alert>
  );
}

function problemText(problem: CashierProblem | undefined): string | null {
  const t = messages.userAccounts.cashierDialog;
  if (problem === 'usernameRequired') return t.usernameRequired;
  if (problem === 'usernameInvalid') return t.usernameInvalid;
  if (problem === 'displayNameRequired') return t.displayNameRequired;
  return null;
}

/** The two fields every new account has. A server answer about one shows under it. */
function AccountFields({
  idPrefix,
  draft,
  onChange,
  tried,
  failure,
  disabled,
}: {
  idPrefix: string;
  draft: CashierDraft;
  onChange: (patch: Partial<CashierDraft>) => void;
  tried: boolean;
  failure: AccountFailure | null;
  disabled: boolean;
}) {
  const t = messages.userAccounts.cashierDialog;
  const problems = accountProblems(draft);
  const nameError =
    (tried ? problemText(problems.displayName) : null) ?? failure?.fields.displayName ?? null;
  const usernameError =
    (tried ? problemText(problems.username) : null) ?? failure?.fields.username ?? null;
  return (
    <>
      <Field data-invalid={nameError !== null}>
        <FieldLabel htmlFor={`${idPrefix}-name`}>{t.displayName}</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          autoComplete="off"
          value={draft.displayName}
          disabled={disabled}
          maxLength={80}
          aria-invalid={nameError !== null}
          onChange={(event) => {
            onChange({ displayName: event.target.value });
          }}
        />
        {nameError === null ? (
          <FieldDescription>{t.displayNameHint}</FieldDescription>
        ) : (
          <FieldError>{nameError}</FieldError>
        )}
      </Field>
      <Field data-invalid={usernameError !== null}>
        <FieldLabel htmlFor={`${idPrefix}-username`}>{t.username}</FieldLabel>
        <Input
          id={`${idPrefix}-username`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          className="text-start"
          value={draft.username}
          disabled={disabled}
          aria-invalid={usernameError !== null}
          onChange={(event) => {
            onChange({ username: event.target.value });
          }}
        />
        {usernameError === null ? (
          <FieldDescription>{t.usernameHint}</FieldDescription>
        ) : (
          <FieldError>{usernameError}</FieldError>
        )}
      </Field>
    </>
  );
}

function FormDialog({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled = false,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {messages.forms.cancel}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="accent"
              disabled={submitDisabled}
              aria-busy={submitDisabled}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A new cashier account (ADR 0024). Two fields: the cashier is not a partner, not an employee and
 * has no role to pick, so none is asked. The server chooses the password and shows it once.
 */
export function CashierDialog({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (credential: IssuedCredential) => void;
}) {
  const t = messages.userAccounts.cashierDialog;
  const id = useId();
  const repositories = useRepositories();
  const [draft, setDraft] = useState(emptyCashierDraft);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);

  const submit = () => {
    if (busy) return;
    setTried(true);
    setFailure(null);
    if (Object.keys(accountProblems(draft)).length > 0) return;
    setBusy(true);
    repositories.userAccounts
      .createCashier(trimmed(draft))
      .then((issued) => {
        onIssued({
          mode: 'created',
          username: issued.account.username,
          temporaryPassword: issued.temporaryPassword,
        });
        onClose();
      })
      .catch((error: unknown) => {
        setFailure(accountFailure(error));
        setBusy(false);
      });
  };

  return (
    <FormDialog
      title={t.title}
      description={t.description}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={busy ? t.submitting : t.submit}
      submitDisabled={busy}
    >
      <FailureAlert failure={failure} />
      <AccountFields
        idPrefix={id}
        draft={draft}
        onChange={(patch) => {
          setDraft((previous) => ({ ...previous, ...patch }));
        }}
        tried={tried}
        failure={failure}
        disabled={busy}
      />
    </FormDialog>
  );
}

type Eligible =
  | { status: 'loading' }
  | { status: 'error'; failure: AccountFailure }
  | { status: 'ready'; partners: EligiblePartner[] };

/**
 * A login for a partner already in the shop (ADR 0024). Only partners without an active account
 * are offered, and the server checks that again when the account is made: two owners' screens, or
 * one screen opened twice, cannot give a partner two logins. No partner is created, and nothing of
 * the partner's share changes.
 */
export function PartnerDialog({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (credential: IssuedCredential) => void;
}) {
  const t = messages.userAccounts.partnerDialog;
  const id = useId();
  const repositories = useRepositories();
  const [eligible, setEligible] = useState<Eligible>({ status: 'loading' });
  const [partnerId, setPartnerId] = useState('');
  const [draft, setDraft] = useState(emptyCashierDraft);
  const [nameEdited, setNameEdited] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);

  useEffect(() => {
    let current = true;
    repositories.userAccounts
      .eligiblePartners()
      .then((partners) => {
        if (current) setEligible({ status: 'ready', partners });
      })
      .catch((error: unknown) => {
        if (current) setEligible({ status: 'error', failure: accountFailure(error) });
      });
    return () => {
      current = false;
    };
  }, [repositories]);

  const partners = eligible.status === 'ready' ? eligible.partners : [];
  const pickError =
    tried && partnerId === '' ? t.pickRequired : (failure?.fields.partnerId ?? null);

  const choose = (value: string) => {
    setPartnerId(value);
    // The partner's own name is a fair start for the name shown; typing over it is kept.
    const partner = partners.find((entry) => entry.id === value);
    if (partner && !nameEdited)
      setDraft((previous) => ({ ...previous, displayName: partner.name }));
  };

  const submit = () => {
    if (busy) return;
    setTried(true);
    setFailure(null);
    if (partnerId === '' || Object.keys(accountProblems(draft)).length > 0) return;
    setBusy(true);
    repositories.userAccounts
      .createPartner({ ...trimmed(draft), partnerId })
      .then((issued) => {
        onIssued({
          mode: 'created',
          username: issued.account.username,
          temporaryPassword: issued.temporaryPassword,
        });
        onClose();
      })
      .catch((error: unknown) => {
        setFailure(accountFailure(error));
        setBusy(false);
      });
  };

  const none = eligible.status === 'ready' && partners.length === 0;
  return (
    <FormDialog
      title={t.title}
      description={t.description}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={busy ? t.submitting : t.submit}
      submitDisabled={busy || eligible.status !== 'ready' || none}
    >
      {eligible.status === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      )}
      {eligible.status === 'error' && <FailureAlert failure={eligible.failure} />}
      {none && (
        <Alert role="status">
          <AlertDescription>
            {t.none} {t.noneHint}
          </AlertDescription>
        </Alert>
      )}
      <FailureAlert failure={failure} />
      {eligible.status === 'ready' && !none && (
        <>
          <Field data-invalid={pickError !== null}>
            <FieldLabel htmlFor={`${id}-partner`}>{t.partner}</FieldLabel>
            <Select value={partnerId} disabled={busy} onValueChange={choose}>
              <SelectTrigger id={`${id}-partner`} aria-invalid={pickError !== null}>
                <SelectValue placeholder={t.pick} />
              </SelectTrigger>
              <SelectContent>
                {partners.map((partner) => (
                  <SelectItem key={partner.id} value={partner.id}>
                    <bdi>{partner.title ? `${partner.name} · ${partner.title}` : partner.name}</bdi>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pickError !== null && <FieldError>{pickError}</FieldError>}
          </Field>
          <AccountFields
            idPrefix={id}
            draft={draft}
            onChange={(patch) => {
              if (patch.displayName !== undefined) setNameEdited(true);
              setDraft((previous) => ({ ...previous, ...patch }));
            }}
            tried={tried}
            failure={failure}
            disabled={busy}
          />
        </>
      )}
    </FormDialog>
  );
}

/**
 * Switching an account off. It asks why (the reason is kept in the audit log) and says what stays:
 * the person, the partner and every record. The account is signed out of every device at once.
 */
export function DeactivateDialog({
  account,
  onClose,
  onChanged,
}: {
  account: Account;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = messages.userAccounts.deactivateDialog;
  const repositories = useRepositories();
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  return (
    <VoidDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t.title(accountName(account))}
      description={t.description}
      confirmLabel={t.confirm}
      busyLabel={t.busy}
      onConfirm={async (reason) => {
        try {
          await repositories.userAccounts.deactivate(account.id, reason);
        } catch (error) {
          // Stays open with the reason kept; the text says what stopped it.
          setFailure(accountFailure(error));
          return;
        }
        toast.success(messages.userAccounts.toast.deactivated);
        onChanged();
        onClose();
      }}
    >
      <FailureAlert failure={failure} />
    </VoidDialog>
  );
}

/**
 * Switching an account on again, or resetting its password. Both end the same way: a new
 * temporary password, shown once, and the person chooses their own at the next sign-in. The reason
 * is optional and goes to the audit log.
 */
export function IssueDialog({
  kind,
  account,
  onClose,
  onIssued,
}: {
  kind: 'reactivate' | 'reset';
  account: Account;
  onClose: () => void;
  onIssued: (credential: IssuedCredential) => void;
}) {
  const u = messages.userAccounts;
  const t = kind === 'reactivate' ? u.reactivateDialog : u.resetDialog;
  const id = useId();
  const repositories = useRepositories();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const change = { reason: reason.trim() === '' ? null : reason.trim() };
    const request =
      kind === 'reactivate'
        ? repositories.userAccounts.reactivate(account.id, change)
        : repositories.userAccounts.resetCredentials(account.id, change);
    request
      .then((issued) => {
        onIssued({
          mode: kind === 'reactivate' ? 'reactivated' : 'reset',
          username: issued.account.username,
          temporaryPassword: issued.temporaryPassword,
        });
        onClose();
      })
      .catch((error: unknown) => {
        setFailure(accountFailure(error));
        setBusy(false);
      });
  };

  return (
    <FormDialog
      title={t.title(accountName(account))}
      description={t.description}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={busy ? t.busy : t.confirm}
      submitDisabled={busy}
    >
      <FailureAlert failure={failure} />
      <Field>
        <FieldLabel htmlFor={`${id}-reason`}>{u.reasonOptional}</FieldLabel>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </Field>
    </FormDialog>
  );
}
