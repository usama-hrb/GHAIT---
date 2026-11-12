import type { ZakatReviewItem } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { formatDate } from '@/shared/format';
import { ReviewItemList } from './review-items';
import { ZakatSummary } from './summary-cards';
import {
  BELOW_NISAB_FIELDS,
  estimateOf,
  historyRowOf,
  LATEST,
  markup,
  occurrences,
  REPORT,
  REVIEWS,
  reviewOf,
  SAVED_AT,
  textOf,
  VOIDED_REPORT,
} from './test-support';
import { ZakatAttention } from './zakat-attention';
import { ZakatHistory } from './zakat-history';

const summary = (status: keyof typeof REVIEWS) =>
  markup(<ZakatSummary review={REVIEWS[status]} />, 'dirham');
const t = () => messages.zakat;

describe('the summary cards', () => {
  it('show the hawl, the nisab, the base and the zakat, with a bar only for the year and the nisab', () => {
    setLanguage('en', { persist: false });
    const html = summary('zakat_due');
    const text = textOf(html);
    for (const title of [
      t().cards.hawl.title,
      t().cards.nisab.title,
      t().cards.base.title,
      t().cards.due.title,
    ]) {
      expect(html).toContain(`>${title}<`);
    }
    // The nisab 59,500 dirham, the base 73,000 and the estimate 1,825, from the report fields.
    expect(text).toContain('59,500');
    expect(text).toContain('73,000');
    expect(text).toContain('1,825');
    expect(text).toContain(t().cards.nisab.reached);
    // 73,000 of 59,500 is 122%: a bar with the figure in words beside it, never alone.
    expect(html).toContain('aria-valuenow="100"');
    expect(text).toContain(t().cards.nisab.percentOf(122));
    expect(html).toContain(`aria-label="${t().cards.nisab.progress}"`);
    expect(text).toContain(t().cards.due.estimated);
  });

  it('show an estimate as an estimate and the saved report as saved', () => {
    setLanguage('en', { persist: false });
    expect(textOf(summary('zakat_due'))).toContain(t().cards.base.estimate);
    const saved = textOf(summary('calculation_completed'));
    expect(saved).toContain(t().cards.base.saved);
    expect(saved).not.toContain(t().cards.base.estimate);
    expect(saved).toContain(t().cards.due.final);
    expect(saved).not.toContain(t().cards.due.estimated);
  });

  it('show what was paid and what is left once a payment is recorded', () => {
    setLanguage('en', { persist: false });
    const text = textOf(summary('payment_recorded'));
    // 1,825 due, 1,000 paid, 825 left.
    expect(text).toContain(`${t().cards.due.final} 1,825`);
    expect(text).toContain(`${t().cards.due.paid} 1,000`);
    expect(text).toContain(`${t().cards.due.remaining} 825`);
  });

  it('show no zakat figure before the first hawl has come, however large the base is', () => {
    setLanguage('en', { persist: false });
    for (const status of ['hawl_in_progress', 'waiting_for_hawl'] as const) {
      const text = textOf(summary(status));
      expect(text).toContain(t().cards.due.notDueYet);
      expect(text).not.toContain('1,825');
      expect(text).not.toContain(t().cards.due.estimated);
    }
  });

  it('say there is nothing due when the base is below the nisab, in words and not by colour', () => {
    setLanguage('en', { persist: false });
    const text = textOf(summary('nisab_not_reached'));
    expect(text).toContain(t().cards.nisab.notReached);
    expect(text).toContain(t().cards.due.none);
    // 50,000 of 59,500 dirham is 84%.
    expect(text).toContain(t().cards.nisab.percentOf(84));
  });

  it('say what is missing instead of showing zeros when nothing can be worked out yet', () => {
    setLanguage('en', { persist: false });
    for (const status of ['not_configured', 'review_required'] as const) {
      const text = textOf(summary(status));
      expect(text).toContain(t().cards.nisab.unavailable);
      expect(text).toContain(t().cards.base.unavailable);
      expect(text).toContain(t().cards.due.unavailable);
    }
    expect(textOf(summary('not_configured'))).toContain(t().cards.hawl.notSet);
  });

  it('keep the figures of a below-nisab estimate consistent with the base card', () => {
    setLanguage('en', { persist: false });
    const html = markup(
      <ZakatSummary review={reviewOf({ estimate: estimateOf(BELOW_NISAB_FIELDS) })} />,
      'dirham',
    );
    expect(textOf(html)).toContain('50,000');
  });
});

describe('the attention list', () => {
  it('shows nothing when there is nothing to look at', () => {
    setLanguage('en', { persist: false });
    expect(markup(<ZakatAttention items={[]} />)).toBe('');
  });

  it('lists what blocks or needs review under one heading, each with its words', () => {
    setLanguage('en', { persist: false });
    const items: ZakatReviewItem[] = [
      { key: 'price_missing', severity: 'blocking' },
      { key: 'goods_without_price', severity: 'review', count: 2 },
    ];
    const html = markup(<ZakatAttention items={items} />);
    const text = textOf(html);
    expect(html).toContain(`>${t().attention.title}</h2>`);
    expect(text).toContain(t().items.price_missing.title);
    expect(text).toContain(t().items.goods_without_price.title);
    expect(text).toContain(t().counts.batches(2));
    expect(text).toContain(t().severity.blocking);
    expect(text).toContain(t().severity.review);
  });

  it('points to the review for notes that are only good to know, without a heading', () => {
    setLanguage('en', { persist: false });
    const html = markup(
      <ZakatAttention
        items={[
          { key: 'doubtful_debts', severity: 'info', count: 1 },
          { key: 'unpaid_expenses', severity: 'info', cents: 20_000 },
        ]}
      />,
    );
    expect(html).not.toContain(t().attention.title);
    expect(textOf(html)).toContain(t().attention.notes(2));
    expect(html).toContain('href="/zakat/review"');
    expect(html).not.toContain(t().items.doubtful_debts.title);
  });
});

describe('an item to review', () => {
  it('names how serious it is in words as well as by edge colour and icon', () => {
    setLanguage('en', { persist: false });
    const items: ZakatReviewItem[] = [
      { key: 'hawl_start_missing', severity: 'blocking' },
      { key: 'price_before_hawl', severity: 'review', date: '2026-01-05' },
      { key: 'position_not_on_hawl_day', severity: 'info', count: 0 },
    ];
    const html = markup(<ReviewItemList items={items} />);
    const text = textOf(html);
    expect(text).toContain(t().severity.blocking);
    expect(text).toContain(t().severity.review);
    expect(text).toContain(t().severity.info);
    expect(occurrences(html, 'aria-hidden="true"')).toBeGreaterThanOrEqual(3);
    expect(text).toContain(formatDate('2026-01-05'));
    expect(text).toContain(t().counts.daysAgo(0));
  });

  it('shows the count of what it is about, and a negative amount as a loss', () => {
    setLanguage('en', { persist: false });
    const html = markup(
      <ReviewItemList
        items={[
          { key: 'goods_unmeasured_at_cost', severity: 'review', count: 1 },
          { key: 'money_negative', severity: 'review', cents: -50_000 },
        ]}
      />,
      'dirham',
    );
    expect(textOf(html)).toContain(t().counts.batches(1));
    expect(textOf(html)).toMatch(/[-−]\s?500/);
  });

  it('is nothing for an empty list', () => {
    setLanguage('en', { persist: false });
    expect(markup(<ReviewItemList items={[]} />)).toBe('');
  });
});

describe('the report history', () => {
  it('says there are no reports instead of showing an empty table', () => {
    setLanguage('en', { persist: false });
    const html = markup(<ZakatHistory rows={[]} />);
    expect(html).toContain(t().history.emptyTitle);
    expect(html).not.toContain('<table');
  });

  it('shows each report as saved: hawl, calculation day, base, nisab, due, paid, left and state', () => {
    setLanguage('en', { persist: false });
    const html = markup(<ZakatHistory rows={[historyRowOf(REPORT, 100_000)]} />, 'dirham');
    const text = textOf(html);
    expect(text).toContain(`${t().history.calculated} ${formatDate(SAVED_AT)}`);
    expect(text).toContain('73,000');
    expect(text).toContain(`${t().history.columns.nisab}: 59,500`);
    expect(text).toContain('1,825');
    expect(text).toContain('1,000');
    expect(text).toContain(`${t().history.columns.remaining}: 825`);
    expect(text).toContain(t().paymentState.partial);
    expect(html).toContain(`href="/zakat/view?id=${REPORT.id}"`);
    for (const column of ['hawl', 'base', 'due', 'paid', 'status'] as const) {
      expect(html).toContain(`>${t().history.columns[column]}</th>`);
    }
  });

  it('shows a voided report struck through and as voided, so the history stays whole', () => {
    setLanguage('en', { persist: false });
    const html = markup(
      <ZakatHistory
        rows={[historyRowOf(VOIDED_REPORT), historyRowOf({ ...REPORT, id: 'other' })]}
      />,
    );
    expect(occurrences(html, 'line-through')).toBe(1);
    expect(textOf(html)).toContain(t().paymentState.voided);
    expect(textOf(html)).toContain(t().paymentState.unpaid);
  });

  it('shows a report with nothing due as having nothing due, not as unpaid', () => {
    setLanguage('en', { persist: false });
    const html = markup(
      <ZakatHistory rows={[historyRowOf({ ...REPORT, baseCents: 5_000_000, zakatDueCents: 0 })]} />,
    );
    expect(textOf(html)).toContain(t().paymentState.none_due);
    expect(textOf(html)).not.toContain(t().paymentState.unpaid);
  });

  it('keeps the latest hawl as the overview reads it', () => {
    expect(LATEST.id).toBe(REPORT.id);
    expect(LATEST.zakatDueCents).toBe(REPORT.zakatDueCents);
  });
});
