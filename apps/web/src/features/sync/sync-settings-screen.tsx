'use client';

import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { messages } from '@/i18n';
import { useLiveQuery, useRepositories, useSession, useSyncStatus } from '@/local-db';
import { OfflineNotice, useOnlineStatus } from '@/shared/brand';
import { DateText } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { SyncIssues } from './sync-issues-screen';

const t = messages.syncSettings;

/**
 * The Synchronization section of Settings (ADR 0017): how this device stands with the server (the
 * connection, what waits to be sent, when it last synced), then what needs a look after syncing:
 * the changes the server refused, the conflicts it settled and the batches sold beyond what they
 * held (SyncIssues). Syncing itself runs by itself; "Sync now" only asks for it sooner.
 */
export function SyncSettingsScreen() {
  const repositories = useRepositories();
  const sync = useSyncStatus();
  const session = useSession();
  const online = useOnlineStatus();
  const toReview = useLiveQuery(() => repositories.maintenance.batchesToReview(), [repositories]);
  const syncing = sync.state === 'syncing';
  const issueCount = sync.rejectedCount + (toReview?.length ?? 0);

  const state = !online
    ? 'offline'
    : session.needsSignIn || sync.state === 'signed_out'
      ? 'signed_out'
      : sync.state === 'error'
        ? 'error'
        : syncing
          ? 'syncing'
          : 'idle';

  return (
    <div className="grid gap-4">
      <header className="grid gap-0.5">
        <h2 className="font-heading text-xl font-semibold">
          {messages.settings.sections.sync.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.description}</p>
      </header>

      <OfflineNotice />

      <Card>
        <CardHeader>
          <CardTitle>{t.status.title}</CardTitle>
          <CardDescription>{t.status.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl
            aria-label={t.status.title}
            className="grid grid-cols-2 rounded-lg border sm:grid-cols-4 [&>div]:border-s max-sm:[&>div:nth-child(n+3)]:border-t max-sm:[&>div:nth-child(odd)]:border-s-0 sm:[&>div:first-child]:border-s-0"
          >
            <Cell label={t.status.connection}>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5',
                  (state === 'offline' || state === 'error') && 'text-debt',
                )}
              >
                {t.status.states[state]}
              </span>
            </Cell>
            <Cell label={t.status.pending}>
              <span data-num>{sync.pendingCount}</span>
            </Cell>
            <Cell label={t.status.rejected}>
              <span data-num>{sync.rejectedCount}</span>
            </Cell>
            <Cell label={t.status.lastSynced}>
              {sync.lastSyncedAt ? (
                <DateText value={sync.lastSyncedAt} format="dateTime" />
              ) : (
                <span className="text-muted-foreground">{t.status.never}</span>
              )}
            </Cell>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={syncing || !online}
              onClick={() => void sync.syncNow()}
            >
              <RefreshCwIcon
                className={cn(syncing && 'animate-spin motion-reduce:animate-none')}
                aria-hidden
              />
              {syncing ? messages.sync.syncing : messages.sync.syncNow}
            </Button>
            {session.needsSignIn && (
              <Button asChild variant="outline">
                <Link href="/login">{messages.sync.signInAgain}</Link>
              </Button>
            )}
            {issueCount > 0 && (
              <Badge variant="warning">
                <TriangleAlertIcon aria-hidden />
                {t.status.needsLook(issueCount)}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <SyncIssues />
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-0.5 px-3 py-2.5 sm:px-4">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="font-heading text-base font-semibold sm:text-lg">{children}</dd>
    </div>
  );
}
