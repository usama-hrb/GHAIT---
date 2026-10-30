'use client';

import { LogOutIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { messages } from '@/i18n';
import { useSession, useSyncStatus } from '@/local-db';
import { ConnectivityStatus } from '@/shared/brand';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

/**
 * Header status: online/offline with the number of changes waiting to sync, changes the server
 * refused (never silently dropped, ADR 0002), a "sign in again" link when the session expired,
 * and "sync now".
 */
export function SyncStatus() {
  const sync = useSyncStatus();
  const session = useSession();
  const syncing = sync.state === 'syncing';

  return (
    <div className="flex items-center gap-1.5">
      <ConnectivityStatus pendingCount={sync.pendingCount} />
      {sync.rejectedCount > 0 && (
        <Badge asChild variant="warning">
          <Link href="/settings/sync">
            <TriangleAlertIcon aria-hidden />
            <span className="max-sm:sr-only">{messages.sync.rejected(sync.rejectedCount)}</span>
          </Link>
        </Badge>
      )}
      {session.needsSignIn && (
        <Button asChild size="sm" variant="outline">
          <Link href="/login">{messages.sync.signInAgain}</Link>
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={syncing ? messages.sync.syncing : messages.sync.syncNow}
        disabled={syncing}
        onClick={() => void sync.syncNow()}
      >
        <RefreshCwIcon
          className={cn(syncing && 'animate-spin motion-reduce:animate-none')}
          aria-hidden
        />
      </Button>
    </div>
  );
}

/** Forgets the user on this device (its local data stays, for the next sign-in). */
export function SignOutButton() {
  const session = useSession();
  const router = useRouter();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={messages.auth.signOut}
      onClick={() => {
        void session.logout().then(() => {
          router.replace('/login');
        });
      }}
    >
      <LogOutIcon aria-hidden />
    </Button>
  );
}
