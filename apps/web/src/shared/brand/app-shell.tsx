'use client';

import { EllipsisIcon, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/shared/ui/drawer';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/shared/ui/sidebar';
import { DiamondBullet } from './diamond-bullet';
import { Logo } from './logo';
import { SearchTrigger } from './search-trigger';

export interface AppShellNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One of the 4 phone tabs; everything else goes in the "more" drawer. */
  tab?: boolean;
}

function isActive(current: string, href: string): boolean {
  return current === href || current.startsWith(`${href}/`);
}

/**
 * The shop's frame (DESIGN_SYSTEM.md §3).
 * Desktop: burgundy sidebar on the right (RTL start) with the logo; the active item gets a
 * lighter background and the gold diamond. Header: title, quick search, connectivity slot.
 * Phone: no sidebar; a bottom tab bar with the 4 `tab` items + "more" (a drawer with the rest).
 */
export function AppShell({
  nav,
  title,
  status,
  actions,
  onSearch,
  activeHref,
  children,
}: {
  nav: readonly AppShellNavItem[];
  title?: ReactNode;
  /** Usually <ConnectivityStatus pendingCount={…} />. */
  status?: ReactNode;
  actions?: ReactNode;
  onSearch?: () => void;
  /** Defaults to the current path. */
  activeHref?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = activeHref ?? pathname;

  return (
    <SidebarProvider>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {messages.shell.skipToContent}
      </a>

      <Sidebar side="right" collapsible="icon">
        <SidebarHeader className="items-center py-4">
          <Logo className="w-44 group-data-[collapsible=icon]:hidden" priority />
          <Logo variant="mark" className="hidden h-9 group-data-[collapsible=icon]:inline-flex" />
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label={messages.nav.label}>
            <SidebarGroup>
              <SidebarMenu>
                {nav.map((item) => {
                  const active = isActive(current, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label} size="lg">
                        <Link href={item.href} aria-current={active ? 'page' : undefined}>
                          <item.icon aria-hidden />
                          <span>{item.label}</span>
                          {active && (
                            <DiamondBullet className="ms-auto text-xs group-data-[collapsible=icon]:hidden" />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-4">
          <SidebarTrigger className="hidden md:inline-flex" />
          <Logo variant="mark" className="h-8 md:hidden" />
          {title !== undefined && (
            <h1 className="truncate font-heading text-lg font-semibold">{title}</h1>
          )}
          <div className="ms-auto flex items-center gap-2">
            {onSearch && <SearchTrigger onSearch={onSearch} />}
            {status}
            {actions}
          </div>
        </header>
        <div id="content" tabIndex={-1} className="flex-1 p-4 pb-24 outline-none md:p-6">
          {children}
        </div>
      </SidebarInset>

      <BottomNav nav={nav} current={current} />
    </SidebarProvider>
  );
}

function BottomNav({ nav, current }: { nav: readonly AppShellNavItem[]; current: string }) {
  const tabs = nav.filter((item) => item.tab);
  const more = nav.filter((item) => !item.tab);
  const moreActive = more.some((item) => isActive(current, item.href));
  const tabClass =
    'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground outline-none focus-visible:bg-muted aria-[current=page]:text-primary data-[active=true]:text-primary';

  return (
    <nav
      aria-label={messages.nav.label}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {tabs.map((item) => {
          const active = isActive(current, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={tabClass}
              >
                <item.icon className="size-5" aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Drawer>
            <DrawerTrigger className={cn(tabClass, 'w-full')} data-active={moreActive}>
              <EllipsisIcon className="size-5" aria-hidden />
              <span>{messages.nav.more}</span>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{messages.nav.more}</DrawerTitle>
              </DrawerHeader>
              <ul className="grid gap-1 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {more.map((item) => {
                  const active = isActive(current, item.href);
                  return (
                    <li key={item.href}>
                      <DrawerClose asChild>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className="flex min-h-12 items-center gap-3 rounded-lg px-3 font-medium outline-none hover:bg-muted focus-visible:bg-muted aria-[current=page]:bg-muted"
                        >
                          <item.icon className="size-5 text-muted-foreground" aria-hidden />
                          {item.label}
                          {active && <DiamondBullet className="ms-auto text-xs" />}
                        </Link>
                      </DrawerClose>
                    </li>
                  );
                })}
              </ul>
            </DrawerContent>
          </Drawer>
        </li>
      </ul>
    </nav>
  );
}
