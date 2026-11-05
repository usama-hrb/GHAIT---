import { formatMoney, type MoneyUnit } from '@fabric/core';
import { getLanguage, messages } from '@/i18n';
import type { SupplierAccountView } from '@/local-db';
import { formatDate } from '@/shared/format';
import { statementWindow } from './supplier-view';

const t = messages.payables.statement;

/** How many of the latest movements the statement lists. */
const RECENT_MOVEMENTS = 10;

/**
 * A supplier's statement as WhatsApp text: each purchase still owed with what was paid on it, what
 * the shop owes in all (or the advance it holds), and the latest movements of the account between
 * the balance before them and the balance after. Both balances are the statement's running
 * balances, so the closing one is the account's.
 */
export function statementText(
  view: SupplierAccountView,
  shopName: string,
  unit: MoneyUnit,
  today: string,
): string {
  const language = getLanguage();
  const money = (cents: number) => formatMoney(cents, unit, language);
  const { account } = view;
  const names = new Map(view.purchases.map((row) => [row.purchase.id, row.productNames]));
  const owedPurchases = account.purchases
    .filter((purchase) => purchase.dueCents > 0)
    .map((purchase) => {
      const products = names.get(purchase.purchaseId) ?? [];
      return [
        `• ${t.purchase} ${formatDate(purchase.date, 'long')}${
          products.length > 0 ? ` (${products.join('، ')})` : ''
        }: ${t.cost} ${money(purchase.totalCents)}`,
        `${t.paid} ${money(purchase.settledCents)}`,
        `${t.remaining} ${money(purchase.dueCents)}`,
      ].join(' · ');
    });
  const window = statementWindow(view.statement, RECENT_MOVEMENTS);
  const movements = window.lines.map(
    (line) =>
      `• ${formatDate(line.date, 'long')}: ${t.kinds[line.kind]} ${money(Math.abs(line.deltaCents))} · ${t.closing} ${money(line.balanceCents)}`,
  );
  return [
    shopName,
    `${t.title} · ${view.supplier.name} · ${formatDate(today, 'long')}`,
    '',
    ...(owedPurchases.length > 0 ? [`${t.owedPurchases}:`, ...owedPurchases, ''] : []),
    account.owedCents > 0
      ? `${t.owed}: ${money(account.owedCents)}`
      : account.advanceCents > 0
        ? `${t.advance}: ${money(account.advanceCents)}`
        : t.nothing,
    ...(movements.length > 0
      ? [
          '',
          `${t.movements}:`,
          `${t.opening}: ${money(window.openingCents)}`,
          ...movements,
          `${t.closing}: ${money(window.closingCents)}`,
        ]
      : []),
    '',
    t.thanks,
  ].join('\n');
}
