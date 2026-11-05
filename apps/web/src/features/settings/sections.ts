import type { Role } from '@fabric/contracts';
import {
  DatabaseIcon,
  HandshakeIcon,
  type LucideIcon,
  RefreshCwIcon,
  StoreIcon,
  WalletIcon,
} from 'lucide-react';
import { messages } from '@/i18n';

export type SettingsSectionKey = 'profile' | 'regional' | 'partners' | 'sync' | 'data';

export interface SettingsSection {
  key: SettingsSectionKey;
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

/** The sections, in the order they are listed, and the pages that belong to each. */
const SECTIONS: readonly { key: SettingsSectionKey; href: string; icon: LucideIcon }[] = [
  { key: 'profile', href: '/settings', icon: StoreIcon },
  { key: 'regional', href: '/settings/regional', icon: WalletIcon },
  { key: 'partners', href: '/settings/partners', icon: HandshakeIcon },
  { key: 'sync', href: '/settings/sync', icon: RefreshCwIcon },
  { key: 'data', href: '/settings/data', icon: DatabaseIcon },
];

/** Whether `role` is shown the section: a cashier never sees the partners (SPEC §11, RL1). */
export function mayOpenSection(role: Role | undefined, key: SettingsSectionKey): boolean {
  return key !== 'partners' || role === 'owner' || role === 'partner';
}

/**
 * The sections `role` is shown, in the language shown now: call it while rendering, never keep
 * its result in a module-level constant.
 */
export function settingsSections(role: Role | undefined): SettingsSection[] {
  return SECTIONS.filter((section) => mayOpenSection(role, section.key)).map((section) => ({
    ...section,
    title: messages.settings.sections[section.key].title,
    description: messages.settings.sections[section.key].description,
  }));
}

/**
 * The section a path belongs to and whether it is one of its inner pages (`/settings/partners/view`
 * is the partners section, one level down). The business profile owns `/settings` itself only.
 */
export function sectionOfPath(pathname: string): { key: SettingsSectionKey; inner: boolean } {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const section of SECTIONS.slice(1)) {
    if (path === section.href) return { key: section.key, inner: false };
    if (path.startsWith(`${section.href}/`)) return { key: section.key, inner: true };
  }
  return { key: 'profile', inner: false };
}
