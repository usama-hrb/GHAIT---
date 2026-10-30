'use client';

import { RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { messages } from '@/i18n';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

/**
 * A new version of the app took over (the service worker updates itself): this page still runs
 * the old code, so it offers a reload. Nothing is lost: every change is already in IndexedDB.
 */
export function UpdateNotice() {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // The first install also changes the controller; only a replacement is an update.
    const hadController = navigator.serviceWorker.controller !== null;
    const onChange = () => {
      if (hadController) setUpdated(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
    };
  }, []);
  if (!updated) return null;
  return (
    <Alert className="mb-4" role="status">
      <RefreshCwIcon aria-hidden />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{messages.update.available}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.location.reload();
          }}
        >
          {messages.update.reload}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
