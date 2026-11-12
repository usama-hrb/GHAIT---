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
import { BrandMark, type BrandIdentity } from './brand-mark';
import { navSections, type NavSection } from './nav-groups';
import { NavPalette } from './nav-palette';
import { SearchTrigger } from './search-trigger';

export interface AppShellNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Items of one group sit together; groups are set apart by a dashed line. */
  group?: string;
  /** The heading above a group, taken from its first item. A group without one has no heading. */
  groupLabel?: string;
  /** One of the 4 phone tabs; everything else goes in the "more" drawer. */
  tab?: boolean;
  /** The `href` of the item this page sits under: shown indented below it, one level only. */
  parent?: string;
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
  'flex h-10 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] pointer-coarse:h-11 group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0';
const NAV_LINK_IDLE =
  'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:bg-foreground/[0.06] focus-visible:text-foreground';
/** A page of this section is open: the section's own link is darker, not a pill. */
const NAV_LINK_WITHIN =
  'text-foreground hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06]';
const NAV_LINK_ACTIVE =
  'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm hover:bg-sidebar-accent/90';
/** Same size folded or not: 22 px, and 24 px on the rail, where it is all there is. */
const NAV_ICON = 'size-[22px] shrink-0 transition-transform group-data-[collapsible=icon]:size-6';
/** A page under another one: a little smaller, so the section reads as one block. */
const SUB_LINK =
  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] pointer-coarse:h-11 group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0';
const SUB_ICON = 'size-[18px] shrink-0 group-data-[collapsible=icon]:size-5';

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

function NavLink({
  item,
  active,
  within = false,
}: {
  item: AppShellNavItem;
  active: boolean;
  /** A page that sits under this one is the open page. */
  within?: boolean;
}) {
  return (
    <RailTip label={item.label}>
      <Link
        href={item.href}
        // The name stays for a screen reader when the rail hides the text.
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        data-active={active}
        data-within={within || undefined}
        className={cn(
          NAV_LINK,
          active ? NAV_LINK_ACTIVE : within ? NAV_LINK_WITHIN : NAV_LINK_IDLE,
        )}
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

/** A page under another one (Financial Integrity under Reports): the same link, smaller. */
function SubNavLink({ item, active }: { item: AppShellNavItem; active: boolean }) {
  return (
    <RailTip label={item.label}>
      <Link
        href={item.href}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        data-active={active}
        className={cn(SUB_LINK, active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE)}
      >
        <item.icon className={SUB_ICON} aria-hidden />
        <span className="truncate group-data-[collapsible=icon]:hidden">{item.label}</span>
        {active && (
          <DiamondBullet className="ms-auto text-xs group-data-[collapsible=icon]:hidden!" />
        )}
      </Link>
    </RailTip>
  );
}

/**
 * One group of the sidebar: its heading (the rail folds it away), its pages, and the pages that
 * sit under them. The dashed line above sets it apart from the group before.
 */
function NavGroup({
  section,
  current,
  separated,
}: {
  section: NavSection<AppShellNavItem>;
  current: string;
  separated: boolean;
}) {
  return (
    <div className={cn(separated && 'mt-2 border-t border-dashed pt-2')}>
      {section.label && (
        // The list carries the name for a screen reader; the heading is for the eyes.
        <p
          aria-hidden
          className="px-3 pb-1.5 text-xs font-medium text-muted-foreground group-data-[collapsible=icon]:hidden"
        >
          {section.label}
        </p>
      )}
      <SidebarMenu aria-label={section.label} className="gap-1">
        {section.nodes.map(({ item, children }) => (
          <SidebarMenuItem key={item.href}>
            <NavLink
              item={item}
              active={isActive(current, item.href)}
              within={children.some((child) => isActive(current, child.href))}
            />
            {children.length > 0 && (
              <ul className="mt-1 ms-6 grid gap-1 border-s ps-3 group-data-[collapsible=icon]:ms-0.5 group-data-[collapsible=icon]:border-s-0 group-data-[collapsible=icon]:ps-0">
                {children.map((child) => (
                  <li key={child.href}>
                    <SubNavLink item={child} active={isActive(current, child.href)} />
                  </li>
                ))}
              </ul>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </div>
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
        className="flex h-10 w-full items-center gap-2 rounded-xl border bg-background px-3 text-sm text-muted-foreground pointer-coarse:h-11 transition-colors duration-150 hover:border-input hover:text-foreground focus-visible:border-input focus-visible:text-foreground group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
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
 * page search (Ctrl K), the pages in groups with a heading each and set apart by dashed lines, a
 * page that sits under another (`parent`) indented below it, the active one a burgundy pill. The
 * collapse button in the header folds it to a rail that keeps the icons large and drops only the
 * names and the headings. Header: title, connectivity slot.
 * Phone: no sidebar; a bottom tab bar with the 4 `tab` items + "more" (a drawer with the rest,
 * in the same groups and with the same nesting).
 */
export function AppShell({
  nav,
  title,
  status,
  actions,
  signOut,
  account,
  brand,
  onSearch,
  activeHref,
  children,
}: {
  nav: readonly AppShellNavItem[];
  title?: ReactNode;
  /** Usually <ConnectivityStatus pendingCount={…} />. */
  status?: ReactNode;
  actions?: ReactNode;
  /** The sign-out control at the foot of the sidebar (shared cannot import the feature that owns it). */
  signOut?: ReactNode;
  account?: AppShellAccount;
  /**
   * The shop's own name and logo (ADR 0017); "loading" while the device reads them. Without it the
   * built-in brand mark and the app's name show.
   */
  brand?: BrandIdentity | 'loading';
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
  const who = [account?.name, account?.detail].filter(Boolean).join(' · ');
  const loadingBrand = brand === 'loading';
  const identity: BrandIdentity =
    brand === undefined || brand === 'loading' ? { name: messages.app.name, logoSrc: null } : brand;

  return (
    <SidebarProvider
      className="shop-sidebar [--bottom-nav:calc(4rem+env(safe-area-inset-bottom))] has-[input:focus]:[--bottom-nav:0px] has-[textarea:focus]:[--bottom-nav:0px] md:[--bottom-nav:0px]"
      style={SIDEBAR_SIZES}
    >
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-accent px-3 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {messages.shell.skipToContent}
      </a>

      <Sidebar side={side} collapsible="icon">
        <SidebarHeader className="gap-3 p-3">
          <div className="flex items-center gap-3 rounded-xl border bg-background p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
            <BrandMark
              logoSrc={identity.logoSrc}
              loading={loadingBrand}
              className="h-10"
              priority
            />
            <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-heading text-sm font-semibold">{identity.name}</span>
              {who && <span className="truncate text-xs text-muted-foreground">{who}</span>}
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
            className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3 [scrollbar-color:var(--sidebar-border)_transparent] [scrollbar-width:thin]"
          >
            {navSections(nav).map((section, index) => (
              <NavGroup
                key={section.nodes[0]?.item.href}
                section={section}
                current={current}
                separated={index > 0}
              />
            ))}
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-2 border-t border-dotted border-sidebar-border p-3">
          {signOut}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-4">
          <SidebarTrigger className="hidden md:inline-flex" />
          <BrandMark
            logoSrc={identity.logoSrc}
            loading={loadingBrand}
            alt={identity.name}
            className="h-8 md:hidden"
          />
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

      <BottomNav nav={nav} current={current} account={account} signOut={signOut} />
      {!onSearch && <NavPalette nav={nav} open={searchOpen} onOpenChange={setSearchOpen} />}
    </SidebarProvider>
  );
}

/**
 * A page in the phone's "more" drawer: choosing it closes the drawer. 44 px tall, the touch size of
 * the sidebar's rows, so that the whole list (headings included) fits a phone of 812 px.
 */
function MoreLink({ item, active }: { item: AppShellNavItem; active: boolean }) {
  return (
    <DrawerClose asChild>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium outline-none hover:bg-muted focus-visible:bg-muted aria-[current=page]:bg-muted"
      >
        <item.icon className="size-5 text-muted-foreground" aria-hidden />
        {item.label}
        {active && <DiamondBullet className="ms-auto text-xs" />}
      </Link>
    </DrawerClose>
  );
}

function BottomNav({
  nav,
  current,
  account,
  signOut,
}: {
  nav: readonly AppShellNavItem[];
  current: string;
  account?: AppShellAccount;
  signOut?: ReactNode;
}) {
  const tabs = nav.filter((item) => item.tab);
  const more = nav.filter((item) => !item.tab);
  const moreActive = more.some((item) => isActive(current, item.href));
  const tabClass =
    'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground outline-none focus-visible:bg-muted aria-[current=page]:text-primary data-[active=true]:text-primary';

  return (
    <nav
      aria-label={messages.nav.label}
      // Hidden while a field has the keyboard: the page above it is what the person is typing into.
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur group-has-[input:focus]/sidebar-wrapper:hidden group-has-[textarea:focus]/sidebar-wrapper:hidden md:hidden"
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
            {/* 88svh, not the primitive's 80vh: the list is every page that is not a tab (ADR 0027). */}
            <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[88svh]">
              <DrawerHeader>
                <DrawerTitle>{messages.nav.more}</DrawerTitle>
              </DrawerHeader>
              <div className="grid min-h-0 gap-3 overflow-y-auto px-4">
                {navSections(more).map((section) => (
                  <div key={section.nodes[0]?.item.href}>
                    {section.label && (
                      <p
                        aria-hidden
                        className="px-3 pb-1 text-xs font-medium text-muted-foreground"
                      >
                        {section.label}
                      </p>
                    )}
                    <ul aria-label={section.label} className="grid gap-1">
                      {section.nodes.map(({ item, children }) => (
                        <li key={item.href}>
                          <MoreLink item={item} active={isActive(current, item.href)} />
                          {children.length > 0 && (
                            <ul className="mt-1 ms-6 grid gap-1 border-s ps-3">
                              {children.map((child) => (
                                <li key={child.href}>
                                  <MoreLink item={child} active={isActive(current, child.href)} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid gap-2 border-t px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {account && (
                  <p className="truncate text-sm text-muted-foreground">
                    {[account.name, account.detail].filter(Boolean).join(' · ')}
                  </p>
                )}
                {signOut}
              </div>
            </DrawerContent>
          </Drawer>
        </li>
      </ul>
    </nav>
  );
}
