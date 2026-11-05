'use client';

import type { SellingUnits } from '@fabric/contracts';
import { TriangleAlertIcon } from 'lucide-react';
import { useId } from 'react';
import { messages } from '@/i18n';
import { cn } from '@/shared/lib/utils';
import { Switch } from '@/shared/ui/switch';

const ORDER = ['piece', 'kg', 'meter'] as const;

/**
 * The three units a shop can work in (ADR 0023): independent switches, in the order Unit / Piece,
 * Kilogram, Meter. Nothing here presets or links them. Under them: a note when none is on (an
 * error once `showError` is set) and a warning when only Kilogram is on, since weight alone can
 * be bought and stocked but not sold. Sign-up and Settings share it.
 */
export function SellingUnitToggles({
  value,
  onChange,
  disabled = false,
  showError = false,
}: {
  value: SellingUnits;
  onChange: (next: SellingUnits) => void;
  disabled?: boolean;
  /** The owner tried to continue with none on: the note turns into an error. */
  showError?: boolean;
}) {
  const t = messages.sellingUnits;
  const id = useId();
  const none = !value.piece && !value.kg && !value.meter;
  const weightOnly = value.kg && !value.piece && !value.meter;

  return (
    <div className="grid gap-3">
      <div role="group" aria-label={t.groupLabel} className="grid gap-3">
        {ORDER.map((unit) => {
          const on = value[unit];
          return (
            <label
              key={unit}
              htmlFor={`${id}-${unit}`}
              className={cn(
                'flex cursor-pointer items-start gap-4 rounded-xl border bg-card p-4 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
                on ? 'border-primary' : 'border-input',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">{t[unit].title}</span>
                <span className="text-sm text-muted-foreground">{t[unit].description}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 pt-0.5">
                <span className="w-8 text-end text-xs font-medium text-muted-foreground">
                  {on ? t.on : t.off}
                </span>
                <Switch
                  id={`${id}-${unit}`}
                  checked={on}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    onChange({ ...value, [unit]: checked });
                  }}
                />
              </span>
            </label>
          );
        })}
      </div>
      {none && (
        <p
          role={showError ? 'alert' : 'status'}
          className={cn('text-sm', showError ? 'text-destructive' : 'text-muted-foreground')}
        >
          {t.none}
        </p>
      )}
      {weightOnly && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{t.weightOnly}</span>
        </p>
      )}
    </div>
  );
}
