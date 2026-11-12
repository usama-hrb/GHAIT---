import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { formatDate } from '@/shared/format';
import { type CashCountsData, CashCountsView, type CountRow } from './cash-counts-section';
import { markup, occurrences, textOf } from './test-support';

const t = () => messages.integrity;

/** A shortage of 5 dirham (100 rial): the till held 95 dirham where the records said 100. */
const SHORT: CountRow = {
  id: 'short',
  date: '2026-11-10',
  expectedCents: 10_000,
  countedCents: 9_500,
  diffCents: -500,
  note: 'Till was short after market day',
  voidedAt: null,
};
/** A surplus of 3 dirham (60 rial). */
const OVER: CountRow = {
  id: 'over',
  date: '2026-11-03',
  expectedCents: 9_000,
  countedCents: 9_300,
  diffCents: 300,
  note: 'A customer overpaid',
  voidedAt: null,
};
const MATCH: CountRow = {
  id: 'match',
  date: '2026-10-27',
  expectedCents: 8_000,
  countedCents: 8_000,
  diffCents: 0,
  note: null,
  voidedAt: null,
};

const dataOf = (counts: readonly CountRow[]): CashCountsData => ({
  expectedCents: 12_000,
  bankCents: 2_000,
  counts,
});

function view(
  data: CashCountsData | null,
  more: Partial<Parameters<typeof CashCountsView>[0]> = {},
  unit: 'rial' | 'dirham' = 'rial',
) {
  return markup(
    <CashCountsView
      data={data}
      fallback={<p>fallback shown</p>}
      lockedThrough={null}
      canCount
      onCount={() => undefined}
      onVoid={() => undefined}
      {...more}
    />,
    unit,
  );
}

/** The attributes of each button that starts a count: its label is the whole text of the button. */
const countButtons = (html: string) =>
  [...html.matchAll(/<button\b([^>]*)>Cash count<\/button>/g)].map((match) => match[1] ?? '');

/** Whether a button's attributes disable it (its class names mention `disabled:` either way). */
const isDisabled = (attributes: string | undefined) => /\sdisabled=""/.test(attributes ?? '');

describe('the cash counts: no count yet', () => {
  it('explains what a count is, with exactly one button that starts one', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([]));
    expect(html).toMatch(/<h3[^>]*>No cash count yet<\/h3>/);
    expect(textOf(html)).toContain(t().noCountsDescription);
    expect(countButtons(html)).toHaveLength(1);
    // The one button is inside the empty state, not in the header above it.
    const emptyState = html.slice(html.indexOf('No cash count yet'));
    expect(countButtons(emptyState)).toHaveLength(1);
  });

  it('shows the money per the records, the bank part, and that nothing was counted', () => {
    setLanguage('en', { persist: false });
    const text = textOf(view(dataOf([])));
    expect(text).toContain(`${t().expected} 2,400 rial`);
    expect(text).toContain(`${t().bank} 400 rial`);
    expect(text).toContain(`${t().lastCount} ${t().noCountYet}`);
    expect(text).toContain(`${t().difference} —`);
    expect(text).toContain(t().countHint);
  });

  it('has no table of counts', () => {
    setLanguage('en', { persist: false });
    expect(view(dataOf([]))).not.toContain('<table');
  });
});

describe('the cash counts: with counts', () => {
  it('puts the button in the header, once, and no empty state', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT, OVER, MATCH]));
    expect(countButtons(html)).toHaveLength(1);
    expect(html).not.toContain(t().noCountsTitle);
    expect(html.indexOf('>Cash count</button>')).toBeLessThan(html.indexOf('<table'));
  });

  it('lists each count: the day, what the records said, what was counted, and the difference', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT, OVER, MATCH]));
    const text = textOf(html);
    for (const heading of [
      t().date,
      t().recordsSaid,
      t().countedColumn,
      t().difference,
      t().reason,
    ]) {
      expect(html).toMatch(new RegExp(`<th[^>]*>${heading}</th>`));
    }
    expect(text).toContain('2,000 rial'); // SHORT: the records said 100 dirham
    expect(text).toContain('1,900 rial'); // SHORT: counted 95 dirham
    expect(text).toContain(`${t().short} 100 rial`);
    expect(text).toContain(`${t().over} 60 rial`);
    expect(text).toContain(t().matches);
    expect(text).toContain(formatDate(SHORT.date, 'medium'));
  });

  it('shows the same in dirham', () => {
    setLanguage('en', { persist: false });
    const text = textOf(view(dataOf([SHORT, OVER]), {}, 'dirham'));
    expect(text).toContain(`${t().short} 5 dh`);
    expect(text).toContain(`${t().over} 3 dh`);
    expect(text).toContain('95 dh');
  });

  it('says in words whether a difference is a surplus or a shortage, never by colour alone', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT, OVER]));
    expect(html).toMatch(/Shortage[^<]*<span[^>]*text-loss/);
    expect(html).toMatch(/Surplus[^<]*<span[^>]*text-profit/);
  });

  it('shows the latest count that stands as the last count, with its day and its result', () => {
    setLanguage('en', { persist: false });
    const text = textOf(view(dataOf([SHORT, OVER])));
    expect(text).toContain(`${t().lastCount} 1,900 rial ${formatDate(SHORT.date, 'medium')}`);
    expect(text).toContain(`${t().difference} ${t().short} 100 rial`);
  });

  it('shows the reason of a count once, in its row, and not again in the figures above', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT]));
    expect(occurrences(html, SHORT.note ?? '')).toBe(1);
  });

  it('gives each count that can be voided one button, named after its day', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT, OVER]));
    expect(occurrences(html, `aria-label="${t().voidAction} ${formatDate(SHORT.date)}"`)).toBe(1);
    expect(occurrences(html, `aria-label="${t().voidAction} ${formatDate(OVER.date)}"`)).toBe(1);
    expect(occurrences(html, `>${t().voidAction}</button>`)).toBe(2);
  });

  it('explains where to see who recorded each count, and links to the audit log', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT]));
    expect(textOf(html)).toContain(t().countedBy);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/audit"[^>]*>${t().viewAudit}</a>`));
  });
});

describe('the cash counts: voided and locked counts', () => {
  const VOIDED: CountRow = { ...SHORT, id: 'voided', voidedAt: '2026-11-11T09:00:00.000Z' };

  it('keeps a voided count in the history, marked, with no button to void it again', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([VOIDED, OVER]));
    expect(occurrences(html, `>${t().voided}</span>`)).toBe(1);
    expect(textOf(html)).toContain(SHORT.note ?? '');
    expect(html).toContain('line-through');
    // Only the live count has a void button.
    expect(occurrences(html, `>${t().voidAction}</button>`)).toBe(1);
    expect(html).not.toContain(`aria-label="${t().voidAction} ${formatDate(VOIDED.date)}"`);
  });

  it('does not count a voided count as the last one', () => {
    setLanguage('en', { persist: false });
    const text = textOf(view(dataOf([VOIDED, OVER])));
    expect(text).toContain(`${t().lastCount} 1,860 rial ${formatDate(OVER.date, 'medium')}`);
  });

  it('says no count yet when every count is voided, and still lists them', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([VOIDED]));
    expect(textOf(html)).toContain(`${t().lastCount} ${t().noCountYet}`);
    expect(html).toContain('<table');
    // It has a history, so the empty state (and its second button) does not appear.
    expect(html).not.toContain(t().noCountsTitle);
    expect(countButtons(html)).toHaveLength(1);
  });

  it('shows a count inside a settled period as locked, with no void button', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT, OVER]), { lockedThrough: '2026-11-05' });
    // OVER (3 Nov) is settled; SHORT (10 Nov) is not.
    expect(occurrences(html, `>${t().voidAction}</button>`)).toBe(1);
    expect(html).toContain(`aria-label="${t().voidAction} ${formatDate(SHORT.date)}"`);
    expect(html).not.toContain(`aria-label="${t().voidAction} ${formatDate(OVER.date)}"`);
    expect(html).toContain(messages.periodLock.locked);
  });

  it('offers the void button while no period has been settled', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT]), { lockedThrough: null });
    expect(html).not.toContain(messages.periodLock.locked);
    expect(occurrences(html, `>${t().voidAction}</button>`)).toBe(1);
  });
});

describe('the cash counts: before the shop’s records are on the device', () => {
  it('disables the count button and says why', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT]), { canCount: false });
    expect(isDisabled(countButtons(html)[0])).toBe(true);
    expect(textOf(html)).toContain(t().countWaiting);
  });

  it('does the same in the empty state, with its one button', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([]), { canCount: false });
    expect(countButtons(html)).toHaveLength(1);
    expect(isDisabled(countButtons(html)[0])).toBe(true);
    expect(textOf(html)).toContain(t().countWaiting);
  });

  it('enables it, and says nothing of waiting, once the records are there', () => {
    setLanguage('en', { persist: false });
    const html = view(dataOf([SHORT]), { canCount: true });
    expect(isDisabled(countButtons(html)[0])).toBe(false);
    expect(textOf(html)).not.toContain(t().countWaiting);
  });
});

describe('the cash counts: loading or unreadable', () => {
  it('shows what the page gave in place of the counts, and a button that cannot be pressed yet', () => {
    setLanguage('en', { persist: false });
    const html = view(null);
    expect(textOf(html)).toContain('fallback shown');
    expect(textOf(html)).not.toContain(t().expected);
    expect(html).not.toContain('<table');
    expect(countButtons(html)).toHaveLength(1);
    expect(isDisabled(countButtons(html)[0])).toBe(true);
  });

  it('is one named region, whatever it shows', () => {
    setLanguage('en', { persist: false });
    for (const data of [null, dataOf([]), dataOf([SHORT])]) {
      expect(occurrences(view(data), `<section aria-label="${t().countsTitle}"`)).toBe(1);
    }
  });
});

describe('the cash counts: in Arabic', () => {
  it('words a matching count differently from the verdict, so the page has one of each', () => {
    setLanguage('ar', { persist: false });
    // The browser tests find the verdict by its exact text, “متطابق”: a count that matches must
    // not read the same.
    expect(t().status.balanced).toBe('متطابق');
    expect(t().matches).toBe('مطابق');
    const html = view(dataOf([SHORT, MATCH]));
    expect(html).not.toContain('>متطابق<');
    expect(textOf(html)).toContain(t().matches);
  });

  it('has one button that starts a count', () => {
    setLanguage('ar', { persist: false });
    const html = view(dataOf([SHORT, MATCH]));
    expect(occurrences(html, `>${t().count}</button>`)).toBe(1);
  });
});
