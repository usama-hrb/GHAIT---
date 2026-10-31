import {
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
import { messages } from '@/i18n';
import type { AppShellNavItem } from '@/shared/brand';

/** Shop navigation, in sidebar order (DESIGN_SYSTEM.md §3). Routes arrive with each slice. */
export const shopNavigation: readonly AppShellNavItem[] = [
  { href: '/home', label: messages.nav.home, icon: HouseIcon, tab: true },
  { href: '/pos', label: messages.nav.pos, icon: ShoppingCartIcon, tab: true },
  { href: '/inventory', label: messages.nav.inventory, icon: PackageIcon, tab: true },
  { href: '/purchases', label: messages.nav.purchases, icon: TruckIcon },
  { href: '/customers', label: messages.nav.customers, icon: UsersIcon, tab: true },
  { href: '/expenses', label: messages.nav.expenses, icon: ReceiptIcon },
  { href: '/partners', label: messages.nav.partners, icon: HandshakeIcon },
  { href: '/settlements', label: messages.nav.settlements, icon: ScaleIcon },
  { href: '/integrity', label: messages.nav.integrity, icon: ShieldCheckIcon },
  { href: '/zakat', label: messages.nav.zakat, icon: HandCoinsIcon },
  { href: '/reports', label: messages.nav.reports, icon: ChartColumnIcon },
  { href: '/audit', label: messages.nav.audit, icon: HistoryIcon },
  { href: '/settings', label: messages.nav.settings, icon: SettingsIcon },
];
