import type { ZakatPaymentState, ZakatStatus } from '@fabric/contracts';
import {
  BadgeCheckIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  HandCoinsIcon,
  HourglassIcon,
  type LucideIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { DateText } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import type { ZakatTone } from './zakat-model';

/**
 * The small pieces the zakat screens share. A tone is a second signal only: every state is also
 * said in words and shown with an icon, never by colour alone.
 */

// Whole class names, so Tailwind finds them.
export const TONES: Record<ZakatTone, { edge: string; badge: string }> = {
  warning: { edge: 'border-s-warning', badge: 'bg-warning/10 text-warning' },
  neutral: { edge: 'border-s-muted-foreground', badge: 'bg-muted text-muted-foreground' },
  info: { edge: 'border-s-info', badge: 'bg-info/10 text-info' },
  success: { edge: 'border-s-success', badge: 'bg-success/10 text-success' },
};

export const STATUS_ICONS: Record<ZakatStatus, LucideIcon> = {
  not_configured: CircleDashedIcon,
  review_required: TriangleAlertIcon,
  waiting_for_hawl: CalendarClockIcon,
  hawl_in_progress: HourglassIcon,
  nisab_not_reached: CircleMinusIcon,
  zakat_due: HandCoinsIcon,
  calculation_completed: CheckCircle2Icon,
  payment_recorded: BadgeCheckIcon,
};

/** A label over a value, as a tile. It belongs inside a `<dl>`. */
export function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid min-w-0 content-start gap-0.5 rounded-lg bg-muted/50 px-3 py-2',
        className,
      )}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </div>
  );
}

/**
 * A day in the Gregorian calendar and, under it, the same day in the Hijri one: the hawl is a
 * Hijri year, so it is the one place the app shows both.
 */
export function DualDate({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('grid gap-0.5', className)}>
      <DateText value={value} />
      <DateText
        value={value}
        format="hijri"
        className="text-sm font-normal text-muted-foreground"
      />
    </span>
  );
}

/** Where a report stands on payment, in words, with a colour that backs the words up. */
export function PaymentStateBadge({ state }: { state: ZakatPaymentState }) {
  const variant =
    state === 'paid'
      ? 'success'
      : state === 'unpaid' || state === 'partial' || state === 'overpaid'
        ? 'warning'
        : 'outline';
  return <Badge variant={variant}>{messages.zakat.paymentState[state]}</Badge>;
}

/** The way back to the Zakat overview, from its sub-pages. */
export function BackToZakat() {
  return (
    <Button asChild variant="link" className="justify-self-start px-0">
      <Link href="/zakat">
        <ChevronLeftIcon className="rtl:rotate-180" data-icon="inline-start" />
        {messages.zakat.actions.back}
      </Link>
    </Button>
  );
}

/**
 * A titled section that opens and closes, so a long page stays short and what a person came for is
 * one tap away. The title is a heading and the button inside it says whether it is open.
 */
export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-xl border bg-card">
      <h3>
        <CollapsibleTrigger className="group/section flex w-full items-center gap-3 rounded-xl p-4 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="font-heading font-semibold">{title}</span>
            {description !== undefined && (
              <span className="text-sm font-normal text-muted-foreground">{description}</span>
            )}
          </span>
          <ChevronDownIcon
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/section:rotate-180"
            aria-hidden
          />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="grid gap-4 border-t p-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
