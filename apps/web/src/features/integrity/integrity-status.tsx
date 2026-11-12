import type { IntegrityReport } from '@fabric/contracts';
import { CheckCircle2Icon, CircleHelpIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { DateText, Money } from '@/shared/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardFooter } from '@/shared/ui/card';
import type { IntegrityStatus } from './integrity-model';

/** The element the verdict's "review the latest changes" button scrolls to. */
export const LATEST_CHANGES_ID = 'integrity-latest-changes';

// Whole class names, so Tailwind finds them: the colour is only a second signal, the words and the
// icon say the same thing.
const TONES = {
  balanced: {
    edge: 'border-s-success',
    badge: 'bg-success/10 text-success',
  },
  difference: {
    edge: 'border-s-destructive',
    badge: 'bg-destructive/10 text-destructive',
  },
  unable: {
    edge: 'border-s-warning',
    badge: 'bg-warning/10 text-warning',
  },
} as const;

/** One figure of the comparison: what is held, what it belongs to and owes, and what is left over. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-heading text-lg font-semibold">{children}</dd>
    </div>
  );
}

/**
 * The first thing on the screen: whether the shop's records agree (SPEC §9). The answer is one of
 * three, each in words, with an icon and an edge colour as second signals:
 * - Balanced: what the shop holds equals what belongs to the partners and what it owes, to the cent;
 * - Difference detected: they differ by an exact amount, with where to look;
 * - Unable to verify: this device cannot say (it has not received the shop's records, or holds
 *   incomplete ones), so it never pretends the shop is balanced.
 * Under it, when there is a check, the two totals and their difference, and when it was worked out.
 */
export function IntegrityVerdict({
  status,
  report,
  receivedAt,
  calculatedAt,
  pendingCount = 0,
  onRetry,
}: {
  status: IntegrityStatus;
  /** The check this answer comes from; null when the check could not run. */
  report: IntegrityReport | null;
  /** When this device last finished receiving the shop's records; null if it never has. */
  receivedAt: string | null;
  /** When the check was worked out (an ISO time). */
  calculatedAt: string;
  /** Changes made on this device and not yet sent to the server. */
  pendingCount?: number;
  onRetry?: () => void;
}) {
  const t = messages.integrity;
  const tone = TONES[status.kind];
  const Icon =
    status.kind === 'balanced'
      ? CheckCircle2Icon
      : status.kind === 'difference'
        ? TriangleAlertIcon
        : CircleHelpIcon;
  const title =
    status.kind === 'balanced'
      ? t.status.balanced
      : status.kind === 'difference'
        ? t.status.difference
        : t.status.unable;

  return (
    <Card role="status" className={cn('border-s-4', tone.edge)}>
      <CardContent className="grid gap-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              tone.badge,
            )}
          >
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="grid min-w-0 gap-1">
            <h2 className="font-heading text-xl leading-snug font-semibold">{title}</h2>
            {status.kind === 'balanced' && (
              <p className="text-muted-foreground">{t.status.balancedDescription}</p>
            )}
            {status.kind === 'difference' && (
              <>
                <p className="font-medium">
                  {status.diffCents > 0 ? t.status.heldMore : t.status.heldLess}
                </p>
                <p className="text-muted-foreground">{t.status.differenceHelp}</p>
              </>
            )}
            {status.kind === 'unable' && (
              <p className="text-muted-foreground">
                {status.reason === 'notReceived'
                  ? t.status.unableNotReceived
                  : t.status.unableIncomplete}
              </p>
            )}
          </div>
        </div>

        {report !== null && status.kind !== 'unable' && (
          <dl className="grid gap-2 @xl:grid-cols-3">
            <Figure label={t.holdingsTotal}>
              <Money cents={report.holdingsCents} />
            </Figure>
            <Figure label={t.claimsTotal}>
              <Money cents={report.claimsCents} />
            </Figure>
            <Figure label={t.status.gap}>
              {status.kind === 'balanced' ? (
                <Money cents={0} />
              ) : (
                <Money cents={Math.abs(status.diffCents)} tone="loss" />
              )}
            </Figure>
          </dl>
        )}

        {status.kind === 'difference' && (
          <div>
            <Button asChild variant="outline">
              <a href={`#${LATEST_CHANGES_ID}`}>{t.status.reviewChanges}</a>
            </Button>
          </div>
        )}
        {status.kind === 'unable' && onRetry !== undefined && (
          <div>
            <Button variant="outline" onClick={onRetry}>
              {t.status.checkAgain}
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p>
          {t.status.calculated} <DateText value={calculatedAt} format="dateTime" />
        </p>
        {receivedAt !== null && (
          <p>
            {t.status.received} <DateText value={receivedAt} format="dateTime" />
          </p>
        )}
        {pendingCount > 0 && <p>{messages.shell.pendingOps(pendingCount)}</p>}
        {status.kind !== 'unable' && <p>{t.status.basis}</p>}
      </CardFooter>
    </Card>
  );
}
