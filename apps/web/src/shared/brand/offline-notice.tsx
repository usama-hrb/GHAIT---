'use client';

import { WifiOffIcon } from 'lucide-react';
import { messages } from '@/i18n';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useOnlineStatus } from './connectivity-status';

/** A screen's offline state: it keeps working, and says where the changes go. */
export function OfflineNotice({ className }: { className?: string }) {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <Alert className={className}>
      <WifiOffIcon aria-hidden />
      <AlertDescription>{messages.offline.notice}</AlertDescription>
    </Alert>
  );
}
