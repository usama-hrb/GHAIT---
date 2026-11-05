'use client';

import { useMemo } from 'react';
import { messages } from '@/i18n';
import {
  useCanSeeCosts,
  useLiveQuery,
  useRepositories,
  useSession,
  useSyncStatus,
} from '@/local-db';
import { LoadingState, OfflineNotice } from '@/shared/brand';
import { ActivityPanel } from './activity-panel';
import { AttentionPanel } from './attention-panel';
import { attentionItems } from './attention';
import { DataStatus } from './data-status';
import { HomeHeader } from './home-header';
import { KpiRow } from './kpi-cards';
import { SalesChart } from './sales-chart';
import { SectionBoundary } from './section-boundary';
import { useShopToday } from './use-shop-today';

const t = messages.home;

/** Business figures. Each figure is its own live query, so a sale re-reads sales and not the stock. */
function Overview({ today, seesCosts }: { today: string; seesCosts: boolean }) {
  const repositories = useRepositories();
  const sales = useLiveQuery(() => repositories.home.sales(today, 7), [repositories, today]);
  // Cost and profit are never read on a cashier's device (SPEC §11).
  const profit = useLiveQuery(
    () => (seesCosts ? repositories.home.grossProfitToday(today) : null),
    [repositories, today, seesCosts],
  );
  const receivables = useLiveQuery(() => repositories.home.receivables(), [repositories]);
  const payables = useLiveQuery(
    () => (seesCosts ? repositories.home.payables() : null),
    [repositories, seesCosts],
  );
  return (
    <KpiRow
      seesCosts={seesCosts}
      sales={sales}
      profit={profit}
      receivables={receivables}
      payables={payables}
    />
  );
}

/** What needs doing: stock, late debts, bills, zakat and refused changes, ranked. */
function Attention({ today, seesCosts }: { today: string; seesCosts: boolean }) {
  const repositories = useRepositories();
  const { rejectedCount } = useSyncStatus();
  const stock = useLiveQuery(() => repositories.home.stock(), [repositories]);
  const receivables = useLiveQuery(() => repositories.home.receivables(), [repositories]);
  const dues = useLiveQuery(
    () => (seesCosts ? repositories.home.dues(today) : null),
    [repositories, today, seesCosts],
  );
  const items = useMemo(
    () =>
      stock === undefined || receivables === undefined || dues === undefined
        ? undefined
        : attentionItems({ stock, receivables, dues, rejectedCount, seesCosts }),
    [stock, receivables, dues, rejectedCount, seesCosts],
  );
  return <AttentionPanel items={items} />;
}

function Activity({ seesCosts }: { seesCosts: boolean }) {
  const repositories = useRepositories();
  const events = useLiveQuery(
    () => repositories.home.recent(10, seesCosts),
    [repositories, seesCosts],
  );
  return <ActivityPanel events={events} />;
}

/**
 * The home screen (SPEC §14.1, ADR 0018): how the shop is doing (today's figures and a sales
 * chart), what needs the owner (ranked), and what just happened, with the three things done most
 * one tap away. Everything comes from this device's data and works offline.
 *
 * Small screens stack by priority: actions, figures, what needs attention, sales, activity. From a
 * container width of 56rem the activity moves to a column beside the sales and the attention list.
 */
export function HomeScreen() {
  const repositories = useRepositories();
  const session = useSession();
  // A cashier's home is the till: no buying, bills, zakat, profit or what the shop owes.
  const seesCosts = useCanSeeCosts();
  const today = useShopToday();
  const pulled = useLiveQuery(() => repositories.maintenance.pulledOnce(), [repositories]);

  if (today === null || pulled === undefined) return <LoadingState />;
  return (
    <div className="@container mx-auto grid w-full max-w-[90rem] gap-5">
      <OfflineNotice />
      <HomeHeader name={session.user?.displayName} today={today} seesCosts={seesCosts} />
      {pulled ? (
        <>
          <SectionBoundary>
            <Overview today={today} seesCosts={seesCosts} />
          </SectionBoundary>
          <div className="grid items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
            <div className="@4xl:col-start-1 @4xl:row-start-2">
              <SectionBoundary>
                <Attention today={today} seesCosts={seesCosts} />
              </SectionBoundary>
            </div>
            <div className="@4xl:col-start-1 @4xl:row-start-1">
              <SectionBoundary>
                <SalesChart today={today} seesCosts={seesCosts} />
              </SectionBoundary>
            </div>
            <div className="@4xl:col-start-2 @4xl:row-span-2 @4xl:row-start-1">
              <SectionBoundary>
                <Activity seesCosts={seesCosts} />
              </SectionBoundary>
            </div>
          </div>
          <DataStatus />
        </>
      ) : (
        <LoadingState variant="spinner" label={t.freshness.waitingForSync} />
      )}
    </div>
  );
}
