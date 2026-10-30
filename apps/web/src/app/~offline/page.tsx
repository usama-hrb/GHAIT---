import { WifiOffIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { messages } from '@/i18n';
import { EmptyState } from '@/shared/brand';
import { Button } from '@/shared/ui/button';

export const metadata: Metadata = { title: messages.offline.pageTitle };

/** Served by the service worker for a page it has not cached yet. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md items-center p-4">
      <EmptyState
        icon={WifiOffIcon}
        title={messages.offline.pageTitle}
        description={messages.offline.pageDescription}
        titleAs="h1"
        action={
          <Button asChild>
            <Link href="/inventory">{messages.offline.backToApp}</Link>
          </Button>
        }
      />
    </main>
  );
}
