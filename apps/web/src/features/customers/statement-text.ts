import { formatMoney, type MoneyUnit } from '@fabric/core';
import { getLanguage, messages } from '@/i18n';
import type { CustomerAccountView } from '@/local-db';
import { formatDate } from '@/shared/format';

const t = messages.customers.statement;

/** How many of the latest payments the statement lists. */
const RECENT_PAYMENTS = 5;

/**
 * A customer's statement as WhatsApp text (BUILD_PROMPTS 3.5): each invoice still to collect,
 * what is owed in all, the latest payments received, and any credit the shop holds for them.
 * Written-off debts are left out.
 */
export function statementText(
  view: CustomerAccountView,
  shopName: string,
  unit: MoneyUnit,
  today: string,
): string {
  const language = getLanguage();
  const money = (cents: number) => formatMoney(cents, unit, language);
  const { account } = view;
  const invoices = account.openInvoices
    .filter((invoice) => !invoice.writtenOff)
    .map((invoice) =>
      [
        `• ${t.invoice} ${formatDate(invoice.date, 'long')}: ${t.total} ${money(invoice.totalCents)}`,
        `${t.paid} ${money(invoice.paidCents)}`,
        `${t.due} ${money(invoice.dueCents)}`,
        ...(invoice.dueDate ? [`${t.dueDate} ${formatDate(invoice.dueDate, 'long')}`] : []),
      ].join(' · '),
    );
  const payments = view.payments
    .filter((payment) => payment.kind === 'payment' && payment.voidedAt === null)
    .slice(0, RECENT_PAYMENTS)
    .map((payment) => `• ${formatDate(payment.date, 'long')}: ${money(payment.amountCents)}`);
  return [
    shopName,
    `${t.title} · ${view.customer.name} · ${formatDate(today, 'long')}`,
    '',
    ...(invoices.length > 0
      ? [...invoices, '', `${t.owed}: ${money(account.collectibleCents)}`]
      : [t.none]),
    ...(payments.length > 0 ? ['', `${t.payments}:`, ...payments] : []),
    ...(account.creditCents > 0 ? [`${t.credit}: ${money(account.creditCents)}`] : []),
    '',
    t.thanks,
  ].join('\n');
}
