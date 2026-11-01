import {
  BanknoteIcon,
  ChartColumnIcon,
  HandCoinsIcon,
  HandshakeIcon,
  HistoryIcon,
  HouseIcon,
  PackageIcon,
  ReceiptIcon,
  ScaleIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  TruckIcon,
  UsersIcon,
} from 'lucide-react';
import type { Role } from '@fabric/contracts';
import { messages } from '@/i18n';
import type { AppShellNavItem } from '@/shared/brand';

/**
 * Shop navigation, in sidebar order (DESIGN_SYSTEM.md §3), labelled in the language shown now:
 * call it while rendering, never keep its result in a module-level constant.
 */
export const shopNavigation = (): readonly AppShellNavItem[] => [
  // The day at the till.
  { href: '/home', label: messages.nav.home, icon: HouseIcon, group: 'daily', tab: true },
  { href: '/pos', label: messages.nav.pos, icon: ShoppingCartIcon, group: 'daily', tab: true },
  {
    href: '/inventory',
    label: messages.nav.inventory,
    icon: PackageIcon,
    group: 'daily',
    tab: true,
  },
  { href: '/purchases', label: messages.nav.purchases, icon: TruckIcon, group: 'daily' },
  {
    href: '/customers',
    label: messages.nav.customers,
    icon: UsersIcon,
    group: 'daily',
    tab: true,
  },
  // The money, the partners and the books.
  { href: '/payables', label: messages.nav.payables, icon: BanknoteIcon, group: 'books' },
  { href: '/expenses', label: messages.nav.expenses, icon: ReceiptIcon, group: 'books' },
  { href: '/partners', label: messages.nav.partners, icon: HandshakeIcon, group: 'books' },
  { href: '/settlements', label: messages.nav.settlements, icon: ScaleIcon, group: 'books' },
  { href: '/integrity', label: messages.nav.integrity, icon: ShieldCheckIcon, group: 'books' },
  { href: '/zakat', label: messages.nav.zakat, icon: HandCoinsIcon, group: 'books' },
  { href: '/reports', label: messages.nav.reports, icon: ChartColumnIcon, group: 'books' },
  // The shop itself.
  { href: '/audit', label: messages.nav.audit, icon: HistoryIcon, group: 'system' },
  { href: '/settings', label: messages.nav.settings, icon: SettingsIcon, group: 'system' },
];

/**
 * What a cashier's screens are (SPEC §11, RL1): selling, the stock to sell from, the customers
 * and what they owe, and the device's own settings. Nothing about buying, costs or profit.
 */
const CASHIER_PAGES = ['/home', '/pos', '/inventory', '/customers', '/settings'] as const;

/** Whether `role` may open the page at `pathname` (the API refuses the rest anyway). */
export function mayOpen(role: Role | undefined, pathname: string): boolean {
  if (role !== 'cashier') return true;
  return CASHIER_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/** The navigation for `role`: a cashier sees only the pages above. */
export function navigationFor(role: Role | undefined): readonly AppShellNavItem[] {
  return shopNavigation().filter((item) => mayOpen(role, item.href));
}
