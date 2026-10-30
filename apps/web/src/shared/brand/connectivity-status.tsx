'use client';

import { WifiIcon, WifiOffIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** navigator.onLine as React state (assumed online during server rendering). */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Header badge: online/offline plus the number of operations waiting to sync.
 * Icon + text, never colour alone. `pendingCount` comes from the sync outbox (BUILD_PROMPTS 3.1).
 */
export function ConnectivityStatus({
  pendingCount = 0,
  online: forcedOnline,
  className,
}: {
  pendingCount?: number;
  /** Override the browser's state (previews, tests). */
  online?: boolean;
  className?: string;
}) {
  const browserOnline = useOnlineStatus();
  const online = forcedOnline ?? browserOnline;
  const Icon = online ? WifiIcon : WifiOffIcon;
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        online ? 'border-border' : 'border-warning/50 bg-warning/10',
        className,
      )}
    >
      <Icon className={cn('size-3.5', online ? 'text-profit' : 'text-debt')} aria-hidden />
      {/* Phones: icon + count only; the words stay available to screen readers. */}
      <span className="max-sm:sr-only">
        {online ? messages.shell.online : messages.shell.offline}
      </span>
      {pendingCount > 0 && (
        <>
          <span className="text-muted-foreground max-sm:sr-only" data-num>
            · {messages.shell.pendingOps(pendingCount)}
          </span>
          <span aria-hidden className="sm:hidden" data-num>
            {pendingCount}
          </span>
        </>
      )}
    </span>
  );
}
