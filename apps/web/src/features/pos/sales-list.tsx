'use client';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  ReceiptIcon,
  SearchXIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { messages } from '@/i18n';
import { type SaleSummary, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, ErrorState, LoadingState, OfflineNotice } from '@/shared/brand';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { shopToday } from '@/shared/lib/dates';
import { Button } from '@/shared/ui/button';
import { SaleDrawer } from './sale-drawer';
import { PeriodControl, SalesFilterBar } from './sales-filter-bar';
import {
  countByPayment,
  DEFAULT_FILTER,
  filterSales,
  type HistoryFilter,
  pageOf,
  summaryOf,
} from './sales-history';
import { SalesMetrics } from './sales-metrics';
import { SalesCards, SalesTable } from './sales-results';

const t = messages.sales;
const h = messages.sales.history;

/** The table needs room for its columns; below this the sales are cards. */
const WIDE = '(min-width: 1024px)';

/**
 * The sales workspace (/pos/history): every sale on this device, narrowed by period, search and
 * payment, with the figures of what is shown, a table (cards on a narrow screen) in pages, and a
 * details drawer. It reads the device's records, so it works offline.
 */
export function SalesListScreen() {
  const repositories = useRepositories();
  const [attempt, setAttempt] = useState(0);
  const result = useLiveQuery(async () => {
    try {
      return { rows: await repositories.sales.list() };
    } catch {
      return { failed: true as const };
    }
  }, [repositories, attempt]);

  if (result === undefined) return <LoadingState />;
  if ('failed' in result) {
    return (
      <ErrorState
        title={h.errorTitle}
        description={h.errorDescription}
        onRetry={() => {
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return <SalesWorkspace rows={result.rows} />;
}

function SalesWorkspace({ rows }: { rows: readonly SaleSummary[] }) {
  const wide = useMediaQuery(WIDE);
  const [filter, setFilter] = useState<HistoryFilter>(DEFAULT_FILTER);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = shopToday();

  const change = (next: HistoryFilter) => {
    setFilter(next);
    setPage(0);
  };

  const shown = useMemo(() => filterSales(rows, filter, today), [rows, filter, today]);
  const counts = useMemo(() => countByPayment(rows, filter, today), [rows, filter, today]);
  const ledger = useMemo(() => summaryOf(shown), [shown]);
  const paged = pageOf(shown, page);

  return (
    <div className="grid w-full gap-4">
      <OfflineNotice />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="font-heading text-xl font-semibold">{t.listTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.description}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodControl filter={filter} onChange={change} />
          <Button asChild variant="accent" size="lg">
            <Link href="/pos">
              <PlusIcon data-icon="inline-start" aria-hidden />
              {h.newSale}
            </Link>
          </Button>
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title={h.emptyTitle} description={h.emptyDescription} />
      ) : (
        <>
          <SalesMetrics ledger={ledger} />
          <SalesFilterBar filter={filter} onChange={change} counts={counts} />
          {shown.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title={h.noMatchTitle}
              description={h.noMatchDescription}
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    change(DEFAULT_FILTER);
                  }}
                >
                  {h.filters.reset}
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              {wide ? (
                <SalesTable rows={paged.items} selectedId={openId} onOpen={setOpenId} />
              ) : (
                <SalesCards rows={paged.items} selectedId={openId} onOpen={setOpenId} />
              )}
              <nav
                aria-label={h.pages}
                className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2"
              >
                <p className="text-sm text-muted-foreground" aria-live="polite" data-num>
                  {h.showing(paged.first, paged.last, paged.total)}
                </p>
                {paged.pages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={paged.page === 0}
                      onClick={() => {
                        setPage(paged.page - 1);
                      }}
                    >
                      <ChevronLeftIcon
                        data-icon="inline-start"
                        className="rtl:rotate-180"
                        aria-hidden
                      />
                      {h.previous}
                    </Button>
                    <span className="text-sm text-muted-foreground max-sm:hidden" data-num>
                      {h.pageOf(paged.page + 1, paged.pages)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={paged.page >= paged.pages - 1}
                      onClick={() => {
                        setPage(paged.page + 1);
                      }}
                    >
                      {h.next}
                      <ChevronRightIcon
                        data-icon="inline-end"
                        className="rtl:rotate-180"
                        aria-hidden
                      />
                    </Button>
                  </div>
                )}
              </nav>
            </div>
          )}
        </>
      )}

      <SaleDrawer
        saleId={openId}
        onClose={() => {
          setOpenId(null);
        }}
      />
    </div>
  );
}
