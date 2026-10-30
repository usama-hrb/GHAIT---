'use client';

import type { ReactNode } from 'react';
import { useLiveQuery, useRepositories } from '@/local-db';
import { MoneyUnitProvider } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';

/**
 * The money_display_unit setting (SPEC §0.2), as pulled from the server: rial until a setting
 * says otherwise. Changing it from the app comes with the settings screen.
 */
export function SettingsMoneyUnitProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const unit = useLiveQuery(
    () => repositories.settings.get('money_display_unit', shopToday()),
    [repositories],
  );
  return <MoneyUnitProvider unit={unit ?? 'rial'}>{children}</MoneyUnitProvider>;
}
