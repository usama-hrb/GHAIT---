import type { SalesLedger } from '@fabric/core';
import { messages } from '@/i18n';
import { Money } from '@/shared/format';

const h = messages.sales.history;

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-0.5 bg-card px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-heading text-xl font-semibold">{children}</dd>
    </div>
  );
}

/**
 * The figures of the sales shown: how many, what they are worth, what has been collected on them
 * and what is still outstanding. All from `salesLedger`; a voided sale is in none of them.
 */
export function SalesMetrics({ ledger }: { ledger: SalesLedger }) {
  return (
    <section aria-label={h.metrics.label} className="grid gap-1.5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        <Metric label={h.metrics.sales}>
          <span data-num>{ledger.count}</span>
        </Metric>
        <Metric label={h.metrics.total}>
          <Money cents={ledger.totalCents} />
        </Metric>
        <Metric label={h.metrics.collected}>
          <Money cents={ledger.paidCents} />
        </Metric>
        <Metric label={h.metrics.outstanding}>
          <Money
            cents={ledger.outstandingCents}
            tone={ledger.outstandingCents > 0 ? 'debt' : undefined}
          />
        </Metric>
      </dl>
      <p className="text-xs text-muted-foreground">
        {h.metrics.hint}
        {ledger.writtenOffCents > 0 && (
          <>
            {' '}
            <Money cents={ledger.writtenOffCents} /> {h.metrics.writtenOff}
          </>
        )}
        {ledger.voidedCount > 0 && <> {h.metrics.voided(ledger.voidedCount)}.</>}
      </p>
    </section>
  );
}
