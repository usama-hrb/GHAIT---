import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import type { RecentEvent } from '@/local-db';
import { formatDate } from '@/shared/format';
import { LATEST_CHANGES_ID } from './integrity-status';
import { LatestChangesView } from './latest-changes';
import { markup, occurrences, textOf } from './test-support';

const t = () => messages.integrity;

/** Saved on 12 November, for the 10th: the two dates differ, as they do for a late entry. */
const PAYMENT: RecentEvent = {
  entity: 'payment',
  id: 'p1',
  at: '2026-11-12T10:30:00.000Z',
  date: '2026-11-10',
  amountCents: 5_000,
  voided: false,
  kind: 'payment',
  href: '/customers/view?id=c1',
};

const event = (more: Partial<RecentEvent>): RecentEvent => ({ ...PAYMENT, ...more });

function view(
  events: readonly RecentEvent[] | null,
  unit: 'rial' | 'dirham' = 'rial',
  fallback: ReactNode = <p>fallback shown</p>,
) {
  return markup(<LatestChangesView events={events} fallback={fallback} />, unit);
}

describe('the latest changes', () => {
  it('is a named region the verdict’s link goes to, with a way on to the audit log', () => {
    setLanguage('en', { persist: false });
    const html = view([PAYMENT]);
    expect(html).toContain(`id="${LATEST_CHANGES_ID}"`);
    expect(html).toContain(`aria-label="${t().recentTitle}"`);
    expect(occurrences(html, 'href="/audit"')).toBe(1);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/audit"[^>]*>${t().viewAudit}</a>`));
  });

  it('says which date is which: recorded at, and the date of the transaction', () => {
    setLanguage('en', { persist: false });
    const html = view([PAYMENT]);
    for (const heading of [t().recordedAt, t().what, t().transactionDate, t().amount]) {
      expect(html).toMatch(new RegExp(`<th[^>]*>${heading}</th>`));
    }
    // The first is a moment, the second a day: both are shown, as their own value.
    expect(textOf(html)).toContain(formatDate(PAYMENT.at, 'dateTime'));
    expect(textOf(html)).toContain(formatDate(PAYMENT.date, 'medium'));
    expect(html).toContain(`dateTime="${new Date(PAYMENT.at).toISOString()}"`);
    expect(html).toContain(`dateTime="${new Date(PAYMENT.date).toISOString()}"`);
    expect(formatDate(PAYMENT.at, 'dateTime')).not.toBe(formatDate(PAYMENT.date, 'medium'));
  });

  it('explains the difference between the two dates, once', () => {
    setLanguage('en', { persist: false });
    expect(occurrences(textOf(view([PAYMENT])), t().datesHelp)).toBe(1);
  });

  it('names the change, says what it did, and opens the record when it has a page', () => {
    setLanguage('en', { persist: false });
    const html = view([PAYMENT]);
    expect(html).toMatch(/<a[^>]*href="\/customers\/view\?id=c1"[^>]*>Customer payment<\/a>/);
    expect(textOf(html)).toContain('Money received from a customer.');
  });

  it('keeps the name of a change big enough to hit with a mouse or a finger, however short it is', () => {
    // A short name is a link only a few characters wide: "Sale" measured 29 px and the Arabic "بيع"
    // 18 px, too narrow to hit, so the link has a size in both directions, for a mouse (24 px) and
    // for a finger (44 px).
    for (const language of ['en', 'ar'] as const) {
      setLanguage(language, { persist: false });
      const link = view([event({ entity: 'sale', kind: null, href: '/pos/view?id=s1' })]).match(
        /<a[^>]*href="\/pos\/view\?id=s1"[^>]*>/,
      );
      expect(link).not.toBeNull();
      for (const size of [
        'min-h-6',
        'min-w-6',
        'pointer-coarse:min-h-11',
        'pointer-coarse:min-w-11',
      ]) {
        expect(link?.[0]).toContain(size);
      }
    }
  });

  it('names a change that has no page of its own without a link', () => {
    setLanguage('en', { persist: false });
    const html = view([event({ entity: 'cash_adjustment', kind: null, href: null })]);
    expect(textOf(html)).toContain(messages.integrity.events.cashCount.label);
    expect(html).not.toContain(`>${messages.integrity.events.cashCount.label}</a>`);
    // The one link on the screen is the way on to the audit log.
    expect(occurrences(html, '<a ')).toBe(1);
  });

  it('shows what the change did to the shop’s money, signed, in the unit shown', () => {
    setLanguage('en', { persist: false });
    expect(textOf(view([PAYMENT]))).toContain('1,000 rial');
    expect(textOf(view([PAYMENT], 'dirham'))).toContain('50 dh');
    const refund = event({ entity: 'payment', kind: 'refund', amountCents: -5_000 });
    expect(textOf(view([refund]))).toContain('-1,000 rial');
    expect(textOf(view([refund], 'dirham'))).toContain('-50 dh');
  });

  it('shows a dash for a change that moved no money', () => {
    setLanguage('en', { persist: false });
    const html = view([event({ entity: 'product_stock_move', kind: 'loss', amountCents: null })]);
    expect(textOf(html)).toContain(messages.integrity.events.stockLoss.label);
    expect(html).toMatch(/>—<\/td>/);
  });

  it('shows an expense not paid yet without the minus of money going out', () => {
    setLanguage('en', { persist: false });
    const unpaid = event({
      entity: 'expense',
      kind: 'unpaid',
      amountCents: -5_000,
      href: '/expenses',
    });
    const text = textOf(view([unpaid]));
    expect(text).toContain(messages.integrity.events.expenseUnpaid.label);
    expect(text).toContain('1,000 rial');
    expect(text).not.toContain('-1,000 rial');
    const paid = event({ entity: 'expense', kind: 'paid', amountCents: -5_000, href: '/expenses' });
    expect(textOf(view([paid]))).toContain('-1,000 rial');
  });

  it('marks a voided change, and strikes its amount through', () => {
    setLanguage('en', { persist: false });
    const html = view([event({ voided: true })]);
    expect(occurrences(html, `>${t().voided}</span>`)).toBe(1);
    expect(html).toMatch(/line-through[^>]*>\s*<span data-num/);
    expect(view([PAYMENT])).not.toContain('line-through');
  });

  it('lists the changes in the order given, newest first', () => {
    setLanguage('en', { persist: false });
    const html = view([
      event({ id: 'a', entity: 'sale', kind: null, href: '/pos/view?id=a' }),
      event({ id: 'b', entity: 'purchase', kind: null, href: '/purchases/view?id=b' }),
    ]);
    expect(html.indexOf('>Sale<')).toBeGreaterThan(-1);
    expect(html.indexOf('>Sale<')).toBeLessThan(html.indexOf('>Stock purchase<'));
  });

  it('gives a cell for each column in every row, labelled for a phone', () => {
    setLanguage('en', { persist: false });
    const html = view([PAYMENT]);
    for (const label of [t().recordedAt, t().what, t().transactionDate, t().amount]) {
      expect(html).toContain(`data-label="${label}"`);
    }
  });
});

describe('the latest changes: nothing yet, loading, unreadable', () => {
  it('says there is nothing yet, and what will appear', () => {
    setLanguage('en', { persist: false });
    const html = view([]);
    expect(html).toMatch(/<h3[^>]*>No changes yet<\/h3>/);
    expect(textOf(html)).toContain(t().noRecentDescription);
    expect(html).not.toContain('<table');
    expect(textOf(html)).not.toContain(t().datesHelp);
    // The way on to the audit log stays.
    expect(html).toContain('href="/audit"');
  });

  it('shows what the page gave in place of the list while loading or when it cannot be read', () => {
    setLanguage('en', { persist: false });
    const html = view(null);
    expect(textOf(html)).toContain('fallback shown');
    expect(html).not.toContain('<table');
    expect(html).not.toContain(t().noRecentTitle);
    expect(html).toContain(`id="${LATEST_CHANGES_ID}"`);
  });
});

describe('the latest changes: in Arabic', () => {
  it('names the columns, and the change, in Arabic', () => {
    setLanguage('ar', { persist: false });
    const html = view([PAYMENT]);
    for (const heading of [t().recordedAt, t().what, t().transactionDate, t().amount]) {
      expect(html).toMatch(new RegExp(`<th[^>]*>${heading}</th>`));
    }
    expect(textOf(html)).toContain(messages.integrity.events.payment.label);
    expect(textOf(html)).toContain('1,000 ريال');
  });
});
