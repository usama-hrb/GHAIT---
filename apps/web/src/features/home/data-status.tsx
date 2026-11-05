'use client';

import { messages } from '@/i18n';
import { useSyncStatus } from '@/local-db';
import { DateText } from '@/shared/format';

const t = messages.home.freshness;

/**
 * How current the figures are: this device's data, and when it last synced with the server (or
 * that it has not yet). Changes waiting to be sent are already counted in every figure; the
 * header's status says how many there are.
 */
export function DataStatus() {
  const sync = useSyncStatus();
  return (
    <p className="text-xs text-muted-foreground">
      {t.onThisDevice}
      <span aria-hidden> · </span>
      {sync.lastSyncedAt ? (
        <>
          {messages.sync.lastSynced} <DateText value={sync.lastSyncedAt} format="dateTime" />
        </>
      ) : (
        t.neverSynced
      )}
    </p>
  );
}
