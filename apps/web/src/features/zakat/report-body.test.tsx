import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { formatDate, moneyUnitLabel } from '@/shared/format';
import { ZakatReportBody } from './report-body';
import {
  drawOf,
  FIELDS,
  GOLD,
  markup,
  occurrences,
  REPORT,
  reportViewOf,
  SAVED_AT,
  textOf,
  VOIDED_REPORT,
} from './test-support';

const t = () => messages.zakat;
const DH = moneyUnitLabel('dirham');
const SHARE = 'https://wa.me/?text=report';

function body(
  view: Parameters<typeof ZakatReportBody>[0]['view'],
  more: { isOwner?: boolean } = {},
) {
  return markup(
    <ZakatReportBody
      view={view}
      isOwner={more.isOwner ?? true}
      shareHref={SHARE}
      onPay={() => undefined}
      onVoid={() => undefined}
    />,
    'dirham',
  );
}

describe('a saved report', () => {
  it('shows the figures as they were saved, the day it was calculated, and says they are not recalculated', () => {
    setLanguage('en', { persist: false });
    const out = body(reportViewOf());
    const text = textOf(out);
    expect(text).toContain(t().reportOf);
    expect(text).toContain(`${t().report.calculated} ${formatDate(SAVED_AT)}`);
    expect(text).toContain(t().report.asSaved);
    expect(text).toContain(`${t().resultStep.rows.base} 73,000 ${DH}`);
    expect(text).toContain(`${t().resultStep.rows.nisab} 59,500 ${DH}`);
    expect(text).toContain(`${t().resultStep.rows.due} 1,825 ${DH}`);
    expect(text).toContain(t().nisabStep.reached);
  });

  it('names the nisab reference it was measured against: the metal, its price and the day', () => {
    setLanguage('en', { persist: false });
    const text = textOf(body(reportViewOf()));
    expect(text).toContain(`${t().report.reference}: ${t().metals.gold}`);
    expect(text).toContain(`700 ${DH} ${t().perGram}`);
    expect(text).toContain(formatDate(GOLD.date));
  });

  it('shows the settings it was made with, whatever the settings are now', () => {
    setLanguage('en', { persist: false });
    const silverAtCost = {
      ...REPORT,
      settings: { nisabMetal: 'silver', goodsValuation: 'cost', includeDoubtfulDebts: true },
    } as const;
    const text = textOf(body(reportViewOf({ report: silverAtCost })));
    expect(text).toContain(t().report.methodologyTitle);
    expect(text).toContain(t().metals.silver);
    expect(text).toContain(t().valuations.cost);
    expect(text).toContain(t().settingsStep.counted);
    expect(text).not.toContain(t().metals.gold + ' ·');
  });

  it('keeps the base by category with its sources, and the inventory as saved', () => {
    setLanguage('en', { persist: false });
    const out = body(reportViewOf());
    const text = textOf(out);
    expect(text).toContain(t().report.baseTitle);
    for (const key of ['money', 'inventory', 'receivables', 'customer_credits'] as const) {
      expect(text).toContain(t().baseStep.categories[key].title);
      expect(text).toContain(t().baseStep.categories[key].source);
    }
    // A report did not keep the bills not paid: it says so instead of showing a figure.
    expect(text).toContain(t().baseStep.notes.notKept);
    expect(text).toContain(t().report.inventoryTitle);
    expect(FIELDS.breakdown.goods[0]?.label).toBe('B-A0012 · Rosa');
  });
});

describe('paying a saved report', () => {
  it('lets the owner record a payment with one gold action, and void a report nothing is paid on', () => {
    setLanguage('en', { persist: false });
    const out = body(reportViewOf());
    const text = textOf(out);
    expect(text).toContain(t().paymentState.unpaid);
    expect(text).toContain(`${t().report.due} 1,825 ${DH}`);
    expect(text).toContain(`${t().report.paid} 0 ${DH}`);
    expect(text).toContain(`${t().report.remaining} 1,825 ${DH}`);
    expect(text).toContain(t().report.noPayments);
    expect(occurrences(out, 'data-variant="accent"')).toBe(1);
    expect(out).toMatch(
      new RegExp(`<button[^>]*data-variant="accent"[^>]*>${t().actions.pay}</button>`),
    );
    expect(out).toContain(t().voidAction);
    expect(out).toContain(`href="${SHARE}"`);
  });

  it('shows a partner the report and nothing to change', () => {
    setLanguage('en', { persist: false });
    const out = body(reportViewOf(), { isOwner: false });
    expect(out).not.toContain(t().actions.pay);
    expect(out).not.toContain(t().voidAction);
    expect(out).not.toContain('data-variant="accent"');
    expect(out).toContain(`href="${SHARE}"`);
    expect(textOf(out)).toContain(`${t().report.due} 1,825 ${DH}`);
  });

  it('lists each payment with who, when and the note, and shows what is left', () => {
    setLanguage('en', { persist: false });
    const view = reportViewOf({
      paidCents: 100_000,
      payments: [
        drawOf({ partnerName: 'Owner', amountCents: 70_000 }),
        drawOf({
          id: 'second',
          partnerName: 'Partner',
          amountCents: 30_000,
          reason: 'zakat 2026-02-18',
        }),
      ],
    });
    const out = body(view);
    const text = textOf(out);
    expect(text).toContain(t().paymentState.partial);
    expect(text).toContain(`${t().report.paid} 1,000 ${DH}`);
    expect(text).toContain(`${t().report.remaining} 825 ${DH}`);
    expect(text).toContain(`Owner · ${formatDate('2026-11-12')}`);
    expect(text).toContain('Receipt 41');
    expect(text).toContain(`Partner · ${formatDate('2026-11-12')}`);
    expect(text).toContain(`700 ${DH}`);
    expect(text).toContain(`300 ${DH}`);
    // Something is left to pay, so the action stays; something is paid, so it can no longer be voided.
    expect(out).toContain(t().actions.pay);
    expect(out).not.toContain(t().voidAction);
  });

  it('shows a report paid in full as paid, with nothing left to pay', () => {
    setLanguage('en', { persist: false });
    const out = body(
      reportViewOf({ paidCents: 182_500, payments: [drawOf({ amountCents: 182_500 })] }),
    );
    expect(textOf(out)).toContain(t().paymentState.paid);
    expect(textOf(out)).toContain(`${t().report.remaining} 0 ${DH}`);
    expect(out).not.toContain(t().actions.pay);
    expect(out).not.toContain('data-variant="accent"');
  });

  it('shows more than was due as an excess, never hides it', () => {
    setLanguage('en', { persist: false });
    const out = body(
      reportViewOf({ paidCents: 190_000, payments: [drawOf({ amountCents: 190_000 })] }),
    );
    expect(textOf(out)).toContain(t().paymentState.overpaid);
    expect(textOf(out)).toContain(`${t().report.excess} 75 ${DH}`);
  });

  it('says there is no payment to make when nothing was due', () => {
    setLanguage('en', { persist: false });
    const none = { ...REPORT, baseCents: 5_000_000, zakatDueCents: 0 };
    const out = body(reportViewOf({ report: none }));
    expect(textOf(out)).toContain(t().cards.due.none);
    expect(textOf(out)).not.toContain(t().report.remaining);
    expect(out).not.toContain(t().actions.pay);
  });
});

describe('a voided report', () => {
  it('stays readable, is marked voided in words, and offers nothing to change', () => {
    setLanguage('en', { persist: false });
    const out = body(reportViewOf({ report: VOIDED_REPORT }));
    expect(out).toContain('role="status"');
    expect(textOf(out)).toContain(t().report.voidedBanner);
    expect(textOf(out)).toContain(t().paymentState.voided);
    expect(out).not.toContain(t().actions.pay);
    expect(out).not.toContain(t().voidAction);
    // The figures are still those that were saved.
    expect(textOf(out)).toContain(`${t().resultStep.rows.base} 73,000 ${DH}`);
  });

  it('strikes a voided payment through and marks it, without counting it', () => {
    setLanguage('en', { persist: false });
    const view = reportViewOf({
      paidCents: 0,
      payments: [drawOf({ voidedAt: '2026-11-13T09:00:00.000Z' })],
    });
    const out = body(view);
    expect(occurrences(out, 'line-through')).toBe(2);
    expect(textOf(out)).toContain(t().paymentState.voided);
    expect(textOf(out)).toContain(`${t().report.paid} 0 ${DH}`);
  });
});
