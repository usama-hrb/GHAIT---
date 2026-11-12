'use client';

import type { IntegrityReport } from '@fabric/contracts';
import { messages } from '@/i18n';
import { useGuardedQuery, useRepositories, useSyncStatus } from '@/local-db';
import { ErrorState, LoadingState, OfflineNotice } from '@/shared/brand';
import { CashCountsSection } from './cash-counts-section';
import { IntegrityBreakdown } from './integrity-breakdown';
import { statusOf } from './integrity-model';
import { IntegrityVerdict } from './integrity-status';
import { LatestChanges } from './latest-changes';

/**
 * Financial Integrity (SPEC §9, §14.11, BUILD_PROMPTS 4.4): what the shop holds against who it
 * belongs to and what it owes, to the cent, worked out from this device's records (offline too).
 * It opens with the answer (balanced, a difference, or unable to verify), then the two sides
 * line by line, the cash counts that compare the records with the money really there, and the
 * latest changes that may explain a difference. The check is the same function the server runs;
 * nothing here adds a rule of its own.
 */
export function IntegrityScreen() {
  const t = messages.integrity;
  const repositories = useRepositories();
  const sync = useSyncStatus();
  const { result, retry } = useGuardedQuery(async () => {
    const receivedAt = await repositories.maintenance.lastPulledAt();
    // Records that are incomplete (a sale that lost its cost, say) cannot be checked: that is an
    // answer for the screen to give ("unable to verify"), not a failure of the screen.
    let report: IntegrityReport | null;
    try {
      report = await repositories.integrity.report();
    } catch {
      report = null;
    }
    return { report, receivedAt, calculatedAt: new Date().toISOString() };
  }, [repositories]);

  const check = result?.ok ? result.value : null;
  const received = check?.receivedAt ?? null;
  return (
    <div className="@container mx-auto grid w-full max-w-5xl gap-8">
      <OfflineNotice />
      <p className="max-w-prose text-muted-foreground">{t.subtitle}</p>

      {result === undefined ? (
        <LoadingState rows={3} />
      ) : check === null ? (
        <ErrorState onRetry={retry} />
      ) : (
        <div className="grid gap-4">
          <IntegrityVerdict
            status={statusOf(check.report, check.receivedAt)}
            report={check.report}
            receivedAt={check.receivedAt}
            calculatedAt={check.calculatedAt}
            pendingCount={sync.pendingCount}
            onRetry={retry}
          />
          {check.report !== null && received !== null && (
            <IntegrityBreakdown report={check.report} />
          )}
        </div>
      )}

      <CashCountsSection canCount={received !== null} />
      <LatestChanges />
    </div>
  );
}
