'use client';

import { EllipsisIcon, type LucideIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { useDirection } from '@/shared/ui/direction';
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
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
  SidebarFooter,
} from '@/shared/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { DiamondBullet } from './diamond-bullet';
import { Logo } from './logo';
import { groupNav } from './nav-groups';
import { NavPalette } from './nav-palette';
import { SearchTrigger } from './search-trigger';
import { SignOutButton } from '@/features/sync';

export interface AppShellNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Items of one group sit together; groups are set apart by a dashed line. */
  group?: string;
  /** One of the 4 phone tabs; everything else goes in the "more" drawer. */
  tab?: boolean;
}

/** Who is signed in, for the card at the top of the sidebar. */
export interface AppShellAccount {
  name: string;
  detail?: string;
}

function isActive(current: string, href: string): boolean {
  return current === href || current.startsWith(`${href}/`);
}

/** Wide enough for the names; the folded rail keeps the icons large and drops only the names. */
const SIDEBAR_SIZES = {
  '--sidebar-width': '16.5rem',
  '--sidebar-width-icon': '5rem',
} as CSSProperties;

/**
 * A link of the sidebar: an icon and its name; folded, the icon alone, as large as before. The
 * active page is a burgundy pill with the gold diamond; the rest answer a hover with a soft
 * background. A tooltip names a folded icon.
 */
const NAV_LINK =
  'flex h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0';
const NAV_LINK_IDLE =
  'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:bg-foreground/[0.06] focus-visible:text-foreground';
const NAV_LINK_ACTIVE =
  'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm hover:bg-sidebar-accent/90';
/** Same size folded or not: 22 px, and 24 px on the rail, where it is all there is. */
const NAV_ICON = 'size-[22px] shrink-0 transition-transform group-data-[collapsible=icon]:size-6';

/** The label of a folded icon, on the side away from the screen's edge. */
function RailTip({ label, children }: { label: string; children: ReactNode }) {
  const { state, isMobile } = useSidebar();
  const side = useDirection() === 'rtl' ? 'left' : 'right';
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={10} hidden={state !== 'collapsed' || isMobile}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavLink({ item, active }: { item: AppShellNavItem; active: boolean }) {
  return (
    <RailTip label={item.label}>
      <Link
        href={item.href}
        // The name stays for a screen reader when the rail hides the text.
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        data-active={active}
        className={cn(NAV_LINK, active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE)}
      >
        <item.icon className={NAV_ICON} aria-hidden />
        <span className="truncate group-data-[collapsible=icon]:hidden">{item.label}</span>
        {active && (
          // `!`: the diamond's own display (brand CSS, outside the layers) would beat a plain hidden.
          <DiamondBullet className="ms-auto text-xs group-data-[collapsible=icon]:hidden!" />
        )}
      </Link>
    </RailTip>
  );
}

/** The search box at the top of the sidebar: a field when it is open, an icon on the rail. */
function SearchField({ onOpen }: { onOpen: () => void }) {
  return (
    <RailTip label={messages.shell.pagesSearch}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={messages.shell.pagesSearch}
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-10 w-full items-center gap-2 rounded-xl border bg-background px-3 text-sm text-muted-foreground transition-colors duration-150 hover:border-input hover:text-foreground focus-visible:border-input focus-visible:text-foreground group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      >
        <SearchIcon className="size-5 shrink-0 group-data-[collapsible=icon]:size-6" aria-hidden />
        <span className="flex-1 truncate text-start group-data-[collapsible=icon]:hidden">
          {messages.shell.pagesSearch}
        </span>
        <kbd
          aria-hidden
          dir="ltr"
          className="rounded border bg-muted px-1.5 font-mono text-[0.7rem] group-data-[collapsible=icon]:hidden"
        >
          Ctrl K
        </kbd>
      </button>
    </RailTip>
  );
}

/**
 * The shop's frame (DESIGN_SYSTEM.md §3).
 * Desktop: a light sidebar at the start (right in Arabic, left in English): who is signed in, a
 * page search (Ctrl K), the pages in groups set apart by dashed lines, the active one a burgundy
 * pill. The collapse button in the header folds it to a rail that keeps the icons large and
 * drops only the names. Header: title, connectivity slot.
 * Phone: no sidebar; a bottom tab bar with the 4 `tab` items + "more" (a drawer with the rest).
 */
export function AppShell({
  nav,
  title,
  status,
  actions,
  account,
  onSearch,
  activeHref,
  children,
}: {
  nav: readonly AppShellNavItem[];
  title?: ReactNode;
  /** Usually <ConnectivityStatus pendingCount={…} />. */
  status?: ReactNode;
  actions?: ReactNode;
  account?: AppShellAccount;
  /** Replaces the built-in page search (the sidebar's field and the header's button). */
  onSearch?: () => void;
  /** Defaults to the current path. */
  activeHref?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = activeHref ?? pathname;
  const side = useDirection() === 'rtl' ? 'right' : 'left';
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <SidebarProvider className="shop-sidebar" style={SIDEBAR_SIZES}>
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {messages.shell.skipToContent}
      </a>

      <Sidebar side={side} collapsible="icon">
        <SidebarHeader className="gap-3 p-3">
          <div className="flex items-center gap-3 rounded-xl border bg-background p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
            <Logo variant="mark" className="h-10 rounded-lg" priority />
            <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-heading text-sm font-semibold">
                {account?.name ?? messages.app.name}
              </span>
              {account?.detail && (
                <span className="truncate text-xs text-muted-foreground">{account.detail}</span>
              )}
            </div>
          </div>
          <SearchField
            onOpen={
              onSearch ??
              (() => {
                setSearchOpen(true);
              })
            }
          />
        </SidebarHeader>
        <SidebarContent>
          <nav
            aria-label={messages.nav.label}
            className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3"
          >
            {groupNav(nav).map((group, index) => (
              <SidebarMenu
                key={group[0]?.href}
                className={cn('gap-1', index > 0 && 'mt-3 border-t border-dashed pt-3')}
              >
                {group.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <NavLink item={item} active={isActive(current, item.href)} />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ))}
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-2 border-t border-dotted border-sidebar-border p-3">
          <SignOutButton />
        </SidebarFooter>
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
      {!onSearch && <NavPalette nav={nav} open={searchOpen} onOpenChange={setSearchOpen} />}
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
