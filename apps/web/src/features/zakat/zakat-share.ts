import { zakatPaymentStateOf, type ZakatReport } from '@fabric/contracts';
import { formatMoneyAmount, type MoneyUnit } from '@fabric/core';
import { messages } from '@/i18n';
import type { Local } from '@/local-db';
import { formatDate, moneyUnitLabel } from '@/shared/format';

/**
 * A saved report as text, to share on WhatsApp (there is no printing, CLAUDE.md). It is the report
 * as saved, with what has been paid on it so far, and it carries the note that the figures are a
 * calculation and not a fatwa. The rate is not in it: a report does not keep one.
 */
export function zakatShareText(input: {
  report: Local<ZakatReport>;
  paidCents: number;
  unit: MoneyUnit;
}): string {
  const t = messages.zakat;
  const { report, unit } = input;
  const { breakdown } = report;
  const money = (cents: number) => `${formatMoneyAmount(cents, unit)} ${moneyUnitLabel(unit)}`;
  const voided = report.voidedAt !== null;
  const payment = zakatPaymentStateOf({
    dueCents: report.zakatDueCents,
    paidCents: input.paidCents,
    voided,
  });
  const lines = [
    t.share.title(formatDate(report.hawlDate, 'hijri')),
    `${t.report.calculated}: ${formatDate(report.createdAt)}`,
  ];
  if (voided) lines.push(t.paymentState.voided);
  lines.push(
    `${t.lines.goods}: ${money(breakdown.goodsCents)}`,
    `${t.lines.cash}: ${money(breakdown.cashCents)}`,
    `${t.lines.receivables}: ${money(breakdown.receivablesCents)}`,
    `${t.lines.debts}: −${money(breakdown.debtsDueCents)}`,
    `${t.lines.base}: ${money(report.baseCents)}`,
    `${t.lines.nisab}: ${money(report.nisabCents)}`,
    `${t.lines.due}: ${money(report.zakatDueCents)}`,
  );
  if (!voided && payment.dueCents > 0) {
    lines.push(
      `${t.report.paid}: ${money(payment.paidCents)}`,
      `${t.report.remaining}: ${money(payment.remainingCents)}`,
    );
  }
  lines.push(t.notFatwa);
  return lines.join('\n');
}
