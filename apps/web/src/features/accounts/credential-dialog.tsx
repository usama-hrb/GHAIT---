'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { messages } from '@/i18n';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

export type CredentialMode = 'created' | 'reset' | 'reactivated';

export interface IssuedCredential {
  mode: CredentialMode;
  username: string;
  temporaryPassword: string;
}

/**
 * The temporary password of an account just made, reset or switched on (ADR 0024). The server
 * shows it once and keeps only its hash, so this dialog is the only place it exists: it cannot be
 * closed by a stray tap outside or by Escape, only by saying it has been handed over, and nothing
 * on the page remembers it afterwards.
 */
export function CredentialDialog({
  credential,
  onDone,
}: {
  credential: IssuedCredential | null;
  onDone: () => void;
}) {
  const t = messages.userAccounts.credential;
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copyPassword = async () => {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <Dialog open={credential !== null}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{credential ? t[credential.mode] : ''}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {credential && (
          <dl className="grid gap-3 rounded-lg border bg-muted/40 p-3">
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{t.username}</dt>
              <dd
                data-testid="credential-username"
                dir="ltr"
                className="font-medium wrap-anywhere text-start"
              >
                {credential.username}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{t.password}</dt>
              <dd
                data-testid="credential-password"
                dir="ltr"
                className="font-mono text-lg font-semibold tracking-wider wrap-anywhere text-start select-all"
              >
                {credential.temporaryPassword}
              </dd>
            </div>
          </dl>
        )}
        {copy === 'failed' && (
          <Alert role="status">
            <AlertDescription>{t.copyFailed}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void copyPassword();
            }}
          >
            {copy === 'copied' ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copy === 'copied' ? t.copied : t.copy}
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => {
              setCopy('idle');
              onDone();
            }}
          >
            {t.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
