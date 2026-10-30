import { formatMoney, type MoneyUnit } from '@fabric/core';
import { messages } from '@/i18n';
import type { CustomerAccountView } from '@/local-db';
import { formatDateAr } from '@/shared/format';

const t = messages.customers.statement;

/**
 * A customer's statement as WhatsApp text (BUILD_PROMPTS 3.5): each invoice still to collect,
 * what is owed in all, and any credit the shop holds for them. Written-off debts are left out.
 */
export function statementText(
  view: CustomerAccountView,
  shopName: string,
  unit: MoneyUnit,
  today: string,
): string {
  const money = (cents: number) => formatMoney(cents, unit);
  const { account } = view;
  const invoices = account.openInvoices
    .filter((invoice) => !invoice.writtenOff)
    .map((invoice) =>
      [
        `• ${t.invoice} ${formatDateAr(invoice.date, 'long')}: ${t.total} ${money(invoice.totalCents)}`,
        `${t.paid} ${money(invoice.paidCents)}`,
        `${t.due} ${money(invoice.dueCents)}`,
        ...(invoice.dueDate ? [`${t.dueDate} ${formatDateAr(invoice.dueDate, 'long')}`] : []),
      ].join(' · '),
    );
  return [
    shopName,
    `${t.title} · ${view.customer.name} · ${formatDateAr(today, 'long')}`,
    '',
    ...(invoices.length > 0
      ? [...invoices, '', `${t.owed}: ${money(account.collectibleCents)}`]
      : [t.none]),
    ...(account.creditCents > 0 ? [`${t.credit}: ${money(account.creditCents)}`] : []),
    '',
    t.thanks,
  ].join('\n');
}
