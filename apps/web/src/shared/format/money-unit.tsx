'use client';

import type { MoneyUnit } from '@fabric/core';
import { createContext, type ReactNode, use, useMemo, useState } from 'react';

interface MoneyUnitValue {
  unit: MoneyUnit;
  setUnit: (unit: MoneyUnit) => void;
}

const MoneyUnitContext = createContext<MoneyUnitValue | null>(null);

/**
 * The `money_display_unit` setting (SPEC §0.2): rial by default, dirham on request.
 * Until local-db settings exist (BUILD_PROMPTS 3.1) the value lives in memory; pass
 * `unit` + `onUnitChange` to drive it from settings instead.
 */
export function MoneyUnitProvider({
  children,
  unit: controlledUnit,
  onUnitChange,
  defaultUnit = 'rial',
}: {
  children: ReactNode;
  unit?: MoneyUnit;
  onUnitChange?: (unit: MoneyUnit) => void;
  defaultUnit?: MoneyUnit;
}) {
  const [ownUnit, setOwnUnit] = useState<MoneyUnit>(defaultUnit);
  const unit = controlledUnit ?? ownUnit;
  const value = useMemo<MoneyUnitValue>(
    () => ({ unit, setUnit: onUnitChange ?? setOwnUnit }),
    [unit, onUnitChange],
  );
  return <MoneyUnitContext value={value}>{children}</MoneyUnitContext>;
}

export function useMoneyUnit(): MoneyUnitValue {
  const value = use(MoneyUnitContext);
  if (!value) throw new Error('useMoneyUnit must be used inside <MoneyUnitProvider>');
  return value;
}
