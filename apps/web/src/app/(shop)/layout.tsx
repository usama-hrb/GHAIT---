'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { SignOutButton, SyncStatus, UpdateNotice } from '@/features/sync';
import { messages } from '@/i18n';
import { useSession } from '@/local-db';
import { AppShell, LoadingState } from '@/shared/brand';
import { LanguageToggle } from '@/shared/language';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { ThemeToggle } from '@/shared/theme';
import Link from 'next/link';
import { EmptyState } from '@/shared/brand';
import { Button } from '@/shared/ui/button';
import { mayOpen, navigationFor, shopNavigation } from '../navigation';

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

  const role = session.user?.role;
  const current = shopNavigation().find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return (
    <AppShell
      nav={navigationFor(role)}
      account={{
        name: session.user?.displayName ?? messages.app.name,
        detail: role ? messages.shell.roles[role] : undefined,
      }}
      title={current?.label ?? messages.app.name}
      status={<SyncStatus />}
      actions={
        <>
          <LanguageToggle />
          <ThemeToggle />
        </>
      }
    >
      <UpdateNotice />
      {role === 'partner' && (
        <Alert className="mb-4" role="status">
          <AlertDescription>{messages.auth.readOnly}</AlertDescription>
        </Alert>
      )}
      {mayOpen(role, pathname) ? (
        children
      ) : (
        <EmptyState
          title={messages.auth.notForCashier}
          action={
            <Button asChild variant="outline">
              <Link href="/pos">{messages.auth.cashierBack}</Link>
            </Button>
          }
        />
      )}
    </AppShell>
  );
}
