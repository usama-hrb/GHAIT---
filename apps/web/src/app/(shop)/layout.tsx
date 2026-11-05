'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useShopIdentity } from '@/features/settings';
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
  const identity = useShopIdentity();

  const mustChangePassword = session.user?.mustChangePassword === true;

  useEffect(() => {
    if (session.status === 'signed_out') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (session.status === 'signed_in' && mustChangePassword) {
      // An account on the password the owner gave it chooses its own before anything else (ADR 0024).
      router.replace('/change-password');
    }
  }, [session.status, mustChangePassword, router, pathname]);

  if (session.status !== 'signed_in' || mustChangePassword) {
    return <LoadingState variant="spinner" />;
  }

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
      brand={identity ?? 'loading'}
      title={current?.label ?? messages.app.name}
      status={<SyncStatus />}
      signOut={<SignOutButton />}
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
          title={role === 'cashier' ? messages.auth.notForCashier : messages.auth.ownerOnlyPage}
          action={
            <Button asChild variant="outline">
              {role === 'cashier' ? (
                <Link href="/pos">{messages.auth.cashierBack}</Link>
              ) : (
                <Link href="/home">{messages.auth.ownerOnlyBack}</Link>
              )}
            </Button>
          }
        />
      )}
    </AppShell>
  );
}
