import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { formatDate, moneyUnitLabel } from '@/shared/format';
import { REPORT, SAVED_AT, VOIDED_REPORT } from './test-support';
import { zakatShareText } from './zakat-share';

const t = () => messages.zakat;
const dh = (amount: string) => `${amount} ${moneyUnitLabel('dirham')}`;

describe('the report as WhatsApp text', () => {
  it('lists the figures as saved, what was paid and what is left, and ends with the note that it is not a fatwa', () => {
    setLanguage('en', { persist: false });
    const lines = zakatShareText({ report: REPORT, paidCents: 100_000, unit: 'dirham' }).split(
      '\n',
    );
    expect(lines).toEqual([
      t().share.title(formatDate(REPORT.hawlDate, 'hijri')),
      `${t().report.calculated}: ${formatDate(SAVED_AT)}`,
      `${t().lines.goods}: ${dh('2,000')}`,
      `${t().lines.cash}: ${dh('70,000')}`,
      `${t().lines.receivables}: ${dh('3,000')}`,
      `${t().lines.debts}: −${dh('2,000')}`,
      `${t().lines.base}: ${dh('73,000')}`,
      `${t().lines.nisab}: ${dh('59,500')}`,
      `${t().lines.due}: ${dh('1,825')}`,
      `${t().report.paid}: ${dh('1,000')}`,
      `${t().report.remaining}: ${dh('825')}`,
      t().notFatwa,
    ]);
  });

  it('shows the whole amount as left when nothing is paid', () => {
    setLanguage('en', { persist: false });
    const text = zakatShareText({ report: REPORT, paidCents: 0, unit: 'dirham' });
    expect(text).toContain(`${t().report.paid}: ${dh('0')}`);
    expect(text).toContain(`${t().report.remaining}: ${dh('1,825')}`);
  });

  it('says a voided report is voided and shows no payment lines', () => {
    setLanguage('en', { persist: false });
    const lines = zakatShareText({ report: VOIDED_REPORT, paidCents: 0, unit: 'dirham' }).split(
      '\n',
    );
    expect(lines[2]).toBe(t().paymentState.voided);
    expect(lines.join('\n')).not.toContain(t().report.paid);
    expect(lines.join('\n')).not.toContain(t().report.remaining);
  });

  it('shows no payment lines for a report with nothing due', () => {
    setLanguage('en', { persist: false });
    const text = zakatShareText({
      report: { ...REPORT, baseCents: 5_000_000, zakatDueCents: 0 },
      paidCents: 0,
      unit: 'dirham',
    });
    expect(text).toContain(`${t().lines.due}: ${dh('0')}`);
    expect(text).not.toContain(t().report.paid);
    expect(text).not.toContain(t().report.remaining);
  });

  it('writes the amounts in the unit the shop displays: rial where that is the setting', () => {
    setLanguage('en', { persist: false });
    const text = zakatShareText({ report: REPORT, paidCents: 0, unit: 'rial' });
    // 1,825 dirham is 36,500 rial; the base 73,000 dirham is 1,460,000 rial.
    expect(text).toContain(`${t().lines.due}: 36,500 ${moneyUnitLabel('rial')}`);
    expect(text).toContain(`${t().lines.base}: 1,460,000 ${moneyUnitLabel('rial')}`);
  });

  it('reads in the language the device uses', () => {
    setLanguage('ar', { persist: false });
    const text = zakatShareText({ report: REPORT, paidCents: 0, unit: 'dirham' });
    expect(text).toContain(messages.zakat.lines.due);
    expect(text).toContain(messages.zakat.notFatwa);
    expect(text).not.toContain('Zakat due');
    setLanguage('en', { persist: false });
  });
});
