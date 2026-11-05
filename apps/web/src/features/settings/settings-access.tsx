'use client';

import { LockIcon, WifiOffIcon } from 'lucide-react';
import { messages } from '@/i18n';
import { useSession } from '@/local-db';
import { useOnlineStatus } from '@/shared/brand';
import { Alert, AlertDescription } from '@/shared/ui/alert';

/**
 * Who may change a setting, and whether it can be done now (ADR 0017). Only the owner changes
 * settings, and a change is saved on the server (which validates and audits it, and sends it to
 * every device), so it needs a connection: reading never does.
 */
export function useSettingsAccess(): { isOwner: boolean; online: boolean; canEdit: boolean } {
  const isOwner = useSession().user?.role === 'owner';
  const online = useOnlineStatus();
  return { isOwner, online, canEdit: isOwner && online };
}

/** Says why the fields are locked, when they are. Nothing when the owner is online. */
export function SettingsNotice({ isOwner, online }: { isOwner: boolean; online: boolean }) {
  const t = messages.settings;
  if (!isOwner) {
    return (
      <Alert role="status">
        <LockIcon aria-hidden />
        <AlertDescription>{t.readOnly}</AlertDescription>
      </Alert>
    );
  }
  if (!online) {
    return (
      <Alert role="status">
        <WifiOffIcon aria-hidden />
        <AlertDescription>{t.needsConnection}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
