import {
  ChartColumnIcon,
  HandCoinsIcon,
  HandshakeIcon,
  PackageIcon,
  ReceiptIcon,
  ScaleIcon,
  SettingsIcon,
  ShoppingCartIcon,
  TruckIcon,
  UsersIcon,
} from 'lucide-react';
import { messages } from '@/i18n';
import type { AppShellNavItem } from '@/shared/brand';

/** Shop navigation, in sidebar order (DESIGN_SYSTEM.md §3). Routes arrive with each slice. */
export const shopNavigation: readonly AppShellNavItem[] = [
  { href: '/pos', label: messages.nav.pos, icon: ShoppingCartIcon, tab: true },
  { href: '/inventory', label: messages.nav.inventory, icon: PackageIcon, tab: true },
  { href: '/purchases', label: messages.nav.purchases, icon: TruckIcon, tab: true },
  { href: '/customers', label: messages.nav.customers, icon: UsersIcon, tab: true },
  { href: '/expenses', label: messages.nav.expenses, icon: ReceiptIcon },
  { href: '/partners', label: messages.nav.partners, icon: HandshakeIcon },
  { href: '/settlements', label: messages.nav.settlements, icon: ScaleIcon },
  { href: '/zakat', label: messages.nav.zakat, icon: HandCoinsIcon },
  { href: '/reports', label: messages.nav.reports, icon: ChartColumnIcon },
  { href: '/settings', label: messages.nav.settings, icon: SettingsIcon },
];
