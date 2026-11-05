'use client';

import type { ReactNode } from 'react';
import { useLiveQuery, useRepositories } from '@/local-db';
import { MoneyUnitProvider } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';

/**
 * The money_display_unit setting (SPEC §0.2), as pulled from the server: rial until a setting
 * says otherwise. It is changed in Settings > Currency (RegionalScreen), which saves it on the
 * server; this device then receives it like every other.
 */
export function SettingsMoneyUnitProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const unit = useLiveQuery(
    () => repositories.settings.get('money_display_unit', shopToday()),
    [repositories],
  );
  return <MoneyUnitProvider unit={unit ?? 'rial'}>{children}</MoneyUnitProvider>;
}
