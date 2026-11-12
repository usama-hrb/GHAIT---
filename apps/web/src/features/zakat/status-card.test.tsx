import type { ZakatStatus } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { formatDate } from '@/shared/format';
import { ZAKAT_HISTORY_ID, ZakatStatusCard } from './status-card';
import { LATEST, markup, occurrences, REVIEWS, SAVED_AT, textOf } from './test-support';

const STATUSES = Object.keys(REVIEWS) as ZakatStatus[];

function card(status: ZakatStatus, more: Partial<Parameters<typeof ZakatStatusCard>[0]> = {}) {
  const review = REVIEWS[status];
  return markup(
    <ZakatStatusCard
      status={status}
      latest={review.latest}
      lastCalculatedAt={review.lastCalculatedAt}
      canPay={false}
      onPay={() => undefined}
      {...more}
    />,
  );
}

describe('the state at the top of the overview', () => {
  it('is announced as a status with its title and meaning in words, in each of the eight states', () => {
    setLanguage('en', { persist: false });
    expect(STATUSES).toHaveLength(8);
    for (const status of STATUSES) {
      const html = card(status);
      expect(html).toContain('role="status"');
      expect(html).toContain(`>${messages.zakat.status[status].title}</h2>`);
      expect(textOf(html)).toContain(messages.zakat.status[status].description);
    }
  });

  it('leads with one gold action, to review the calculation, whatever the state', () => {
    setLanguage('en', { persist: false });
    for (const status of STATUSES) {
      const html = card(status, { canPay: true });
      expect(occurrences(html, 'data-variant="accent"')).toBe(1);
      expect(html).toMatch(
        /<a [^>]*data-variant="accent"[^>]*href="\/zakat\/review"[^>]*>Review Zakat calculation<\/a>/,
      );
    }
  });

  it('says "due" in its title for the due state only, never because a reminder came', () => {
    setLanguage('en', { persist: false });
    const dueTitles = STATUSES.filter((status) =>
      /\bdue\b/i.test(messages.zakat.status[status].title),
    );
    expect(dueTitles).toEqual(['zakat_due']);
    for (const status of STATUSES.filter((s) => s !== 'zakat_due')) {
      expect(textOf(card(status))).not.toContain(messages.zakat.status.zakat_due.title);
    }
  });

  it('says that no zakat was due on a saved report with nothing due, and when one is paid in full', () => {
    setLanguage('en', { persist: false });
    const noneDue = card('calculation_completed', {
      latest: { ...LATEST, zakatDueCents: 0, baseCents: 5_000_000 },
    });
    expect(textOf(noneDue)).toContain(
      messages.zakat.status.calculation_completed.noneDueDescription,
    );
    const paidInFull = card('payment_recorded', {
      latest: { ...LATEST, paidCents: LATEST.zakatDueCents },
    });
    expect(textOf(paidInFull)).toContain(
      messages.zakat.status.payment_recorded.paidInFullDescription,
    );
    const partly = card('payment_recorded');
    expect(textOf(partly)).toContain(messages.zakat.status.payment_recorded.description);
  });

  it('shows when the last calculation was saved, or that none was', () => {
    setLanguage('en', { persist: false });
    expect(textOf(card('zakat_due'))).toContain(messages.zakat.noCalculation);
    expect(textOf(card('zakat_due'))).not.toContain(messages.zakat.lastCalculation);
    const saved = textOf(card('calculation_completed', { lastCalculatedAt: SAVED_AT }));
    expect(saved).toContain(`${messages.zakat.lastCalculation} ${formatDate(SAVED_AT)}`);
    expect(saved).not.toContain(messages.zakat.noCalculation);
  });

  it('offers recording a payment only when the owner can pay, and it is not the gold action', () => {
    setLanguage('en', { persist: false });
    const without = card('calculation_completed', { canPay: false });
    expect(without).not.toContain(messages.zakat.actions.pay);
    const withPay = card('calculation_completed', { canPay: true });
    expect(occurrences(withPay, messages.zakat.actions.pay)).toBe(1);
    expect(withPay).toMatch(
      new RegExp(`<button [^>]*data-variant="outline"[^>]*>${messages.zakat.actions.pay}</button>`),
    );
  });

  it('keeps the methodology and the history one tap away', () => {
    setLanguage('en', { persist: false });
    const html = card('zakat_due');
    expect(html).toContain(`href="/zakat/settings"`);
    expect(html).toContain(messages.zakat.actions.methodology);
    expect(html).toContain(`href="#${ZAKAT_HISTORY_ID}"`);
    expect(html).toContain(messages.zakat.actions.history);
  });
});
