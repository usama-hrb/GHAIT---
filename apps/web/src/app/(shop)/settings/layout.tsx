import type { ReactNode } from 'react';
import { SettingsShell } from '@/features/settings';

/** Every settings page sits in the section frame (ADR 0017). */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
