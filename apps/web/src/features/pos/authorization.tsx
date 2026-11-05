import { TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Switch } from '@/shared/ui/switch';

/**
 * A rule a sale line breaks that only the owner can lift (selling under the minimum price, or
 * under the cost): one compact strip with the warning mark, what was crossed and the control to
 * confirm. It is the same strip in the line dialog and in the payment dialog, so the owner sees
 * the same thing wherever it is asked. The mark and the words carry the meaning, not the colour.
 */
export function Authorization({
  title,
  detail,
  description,
  children,
}: {
  title: string;
  /** What was crossed (the minimum price…), after the title. */
  detail?: ReactNode;
  /** A sentence under the title, when one is needed. */
  description?: string;
  /** The control that confirms it, or the words that say nobody here can. */
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-warning bg-warning/10 px-3 py-1.5"
    >
      <div className="grid min-w-0 gap-0.5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-warning" />
          <span>
            {title}
            {detail !== undefined && <span className="text-muted-foreground"> · {detail}</span>}
          </span>
        </p>
        {description !== undefined && (
          <p className="ps-6 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

/** A switch whose whole row is the tap target (44 px on a touch screen). */
export function ConfirmSwitch({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium pointer-coarse:min-h-11"
    >
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}
