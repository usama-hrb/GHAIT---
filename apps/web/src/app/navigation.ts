import {
  BanknoteIcon,
  ChartColumnIcon,
  HandCoinsIcon,
  HistoryIcon,
  HouseIcon,
  PackageIcon,
  ReceiptIcon,
  ScaleIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  UsersIcon,
} from 'lucide-react';
import type { Role } from '@fabric/contracts';
import { messages } from '@/i18n';
import type { AppShellNavItem } from '@/shared/brand';

/**
 * Shop navigation, in sidebar order (DESIGN_SYSTEM.md §3, ADR 0027), labelled in the language
 * shown now: call it while rendering, never keep its result in a module-level constant.
 * Five groups: Main (the day at the till, also the phone's four tabs), Operations, Finance,
 * Reports (with the Financial Integrity report under it) and Administration.
 */
export const shopNavigation = (): readonly AppShellNavItem[] => {
  const { groups } = messages.nav;
  const main = { group: 'main', groupLabel: groups.main } as const;
  const operations = { group: 'operations', groupLabel: groups.operations } as const;
  const finance = { group: 'finance', groupLabel: groups.finance } as const;
  // No heading: the Reports item itself says what the group is.
  const reports = { group: 'reports' } as const;
  const admin = { group: 'admin', groupLabel: groups.admin } as const;
  return [
    { href: '/home', label: messages.nav.home, icon: HouseIcon, ...main, tab: true },
    { href: '/pos', label: messages.nav.pos, icon: ShoppingCartIcon, ...main, tab: true },
    { href: '/inventory', label: messages.nav.inventory, icon: PackageIcon, ...main, tab: true },
    { href: '/customers', label: messages.nav.customers, icon: UsersIcon, ...main, tab: true },
    // What the shop buys and spends. The partners are a section of Settings (ADR 0017).
    { href: '/payables', label: messages.nav.payables, icon: BanknoteIcon, ...operations },
    { href: '/expenses', label: messages.nav.expenses, icon: ReceiptIcon, ...operations },
    // The partners' money.
    { href: '/settlements', label: messages.nav.settlements, icon: ScaleIcon, ...finance },
    { href: '/zakat', label: messages.nav.zakat, icon: HandCoinsIcon, ...finance },
    { href: '/reports', label: messages.nav.reports, icon: ChartColumnIcon, ...reports },
    {
      href: '/integrity',
      label: messages.nav.integrity,
      icon: ShieldCheckIcon,
      ...reports,
      parent: '/reports',
    },
    // The shop itself.
    { href: '/audit', label: messages.nav.audit, icon: HistoryIcon, ...admin },
    { href: '/settings', label: messages.nav.settings, icon: SettingsIcon, ...admin },
  ];
};

/**
 * What a cashier's screens are (SPEC §11, RL1): selling, the stock to sell from, the customers
 * and what they owe, and the device's own settings. Nothing about buying, costs or profit.
 */
const CASHIER_PAGES = ['/home', '/pos', '/inventory', '/customers', '/settings'] as const;

/**
 * Pages inside an allowed page that a cashier still may not open: the partners (SPEC §11) and the
 * accounts, which only the owner manages (ADR 0024).
 */
const CASHIER_REFUSED = ['/settings/partners', '/settings/accounts'] as const;

/**
 * Pages only the owner opens (ADR 0024): the audit log and the integrity report name every
 * account and every partner's money, and the accounts are the owner's to manage. The API refuses
 * a partner on each of them; the app does not offer them.
 */
const OWNER_PAGES = ['/audit', '/integrity', '/settings/accounts'] as const;

const under = (pathname: string, page: string) =>
  pathname === page || pathname.startsWith(`${page}/`);

/** Whether `role` may open the page at `pathname` (the API refuses the rest anyway). */
export function mayOpen(role: Role | undefined, pathname: string): boolean {
  if (role === 'partner') return !OWNER_PAGES.some((page) => under(pathname, page));
  if (role !== 'cashier') return true;
  return (
    CASHIER_PAGES.some((page) => under(pathname, page)) &&
    !CASHIER_REFUSED.some((page) => under(pathname, page))
  );
}

/** The navigation for `role`: a cashier sees only the pages above, a partner not the owner's. */
export function navigationFor(role: Role | undefined): readonly AppShellNavItem[] {
  return shopNavigation().filter((item) => mayOpen(role, item.href));
}
