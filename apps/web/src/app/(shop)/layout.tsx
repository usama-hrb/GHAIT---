'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { SignOutButton, SyncStatus } from '@/features/sync';
import { messages } from '@/i18n';
import { useSession } from '@/local-db';
import { AppShell, LoadingState } from '@/shared/brand';
import { ThemeToggle } from '@/shared/theme';
import { shopNavigation } from '../navigation';

/**
 * The shop's screens. A device opens on its local data, offline too, once someone has signed
 * in on it; a device nobody signed in on goes to the login page.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === 'signed_out') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [session.status, router, pathname]);

  if (session.status !== 'signed_in') return <LoadingState variant="spinner" />;

  const current = shopNavigation.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return (
    <AppShell
      nav={shopNavigation}
      title={current?.label ?? messages.app.name}
      status={<SyncStatus />}
      actions={
        <>
          <ThemeToggle />
          <SignOutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
