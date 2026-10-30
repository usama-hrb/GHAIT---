import { formatLength, formatMoney, type MoneyUnit } from '@fabric/core';
import { messages } from '@/i18n';
import type { SaleView } from '@/local-db';
import { formatDateAr } from '@/shared/format';

const t = messages.sales.invoice;

/**
 * The invoice as plain text for WhatsApp (SPEC §4): shop name, date, lines, total, paid and what
 * is left. Amounts in the money_display_unit setting.
 */
export function invoiceText(view: SaleView, shopName: string, unit: MoneyUnit): string {
  const money = (cents: number) => formatMoney(cents, unit);
  const { sale, figures } = view;
  const lines = view.lines.map(({ line, fabric, variant }) => {
    const item = [fabric?.name, variant?.colorName].filter(Boolean).join(' ');
    const quantity = line.wholePiece
      ? `${t.wholePiece} (${formatLength(line.soldCm)})`
      : `${formatLength(line.soldCm)} × ${money(line.actualPricePerMeterCents)}`;
    return `• ${item}: ${quantity} = ${money(line.lineTotalCents)}`;
  });
  const totals = [
    ...(figures.discountCents > 0
      ? [
          `${t.linesTotal}: ${money(figures.linesTotalCents)}`,
          `${t.discount}: ${money(figures.discountCents)}`,
        ]
      : []),
    `${t.total}: ${money(figures.totalCents)}`,
    `${t.paid}: ${money(figures.paidCents)}`,
    `${t.remaining}: ${money(Math.max(figures.dueCents, 0))}`,
    ...(sale.dueDate && figures.dueCents > 0
      ? [`${t.dueDate} ${formatDateAr(sale.dueDate, 'long')}`]
      : []),
  ];
  return [
    shopName,
    `${t.title} · ${formatDateAr(sale.date, 'long')}`,
    ...(view.customer ? [`${t.customer}: ${view.customer.name}`] : []),
    '',
    ...lines,
    '',
    ...totals,
    '',
    t.thanks,
  ].join('\n');
}
