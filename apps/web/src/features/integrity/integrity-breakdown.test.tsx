import { INTEGRITY_LINE_KEYS } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import { IntegrityBreakdown } from './integrity-breakdown';
import {
  BALANCED,
  HELD_MORE_BY_ONE_CENT,
  markup,
  NEGATIVE_LINES,
  occurrences,
  textOf,
} from './test-support';

const t = () => messages.integrity;

describe('the two sides of the check', () => {
  it('shows what the shop holds and what it belongs to and owes, each as a named region', () => {
    setLanguage('en', { persist: false });
    const html = markup(<IntegrityBreakdown report={BALANCED} />);
    expect(occurrences(html, `role="region" aria-label="${t().holdings}"`)).toBe(1);
    expect(occurrences(html, `role="region" aria-label="${t().claims}"`)).toBe(1);
    expect(html).toMatch(/<h2[^>]*>What the shop holds<\/h2>/);
  });

  it('names every line once, with what it means', () => {
    setLanguage('en', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={BALANCED} />));
    for (const key of INTEGRITY_LINE_KEYS) {
      expect(occurrences(text, t().lines[key])).toBe(1);
      expect(occurrences(text, t().helps[key])).toBe(1);
    }
  });

  it('groups the claims into what belongs to the partners and what is owed to others', () => {
    setLanguage('en', { persist: false });
    const html = markup(<IntegrityBreakdown report={BALANCED} />);
    expect(html).toMatch(/<h3[^>]*>Belongs to the partners<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>Owed to others<\/h3>/);
    // The first side has one group and so needs no heading of its own.
    expect(occurrences(html, '<h3')).toBe(2);
    const text = textOf(html);
    const partners = text.indexOf(t().partnersGroup);
    const others = text.indexOf(t().othersGroup);
    expect(partners).toBeGreaterThan(-1);
    expect(others).toBeGreaterThan(partners);
    expect(text.indexOf(t().lines.capital)).toBeGreaterThan(partners);
    expect(text.indexOf(t().lines.capital)).toBeLessThan(others);
    expect(text.indexOf(t().lines.supplier_payables)).toBeGreaterThan(others);
  });
});

describe('the amounts', () => {
  it('shows each line and each side’s total in rial', () => {
    setLanguage('en', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={BALANCED} />));
    expect(text).toContain(`${t().lines.cash} 2,000 rial`);
    expect(text).toContain(`${t().lines.stock_at_cost} 1,000 rial`);
    expect(text).toContain(`${t().lines.capital} 2,400 rial`);
    expect(text).toContain(`${t().holdingsTotal} 3,000 rial`);
    expect(text).toContain(`${t().claimsTotal} 3,000 rial`);
  });

  it('shows them in dirham when that is the display unit', () => {
    setLanguage('en', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={BALANCED} />, 'dirham'));
    expect(text).toContain(`${t().lines.cash} 100 dh`);
    expect(text).toContain(`${t().lines.unsettled_net_profit} 5 dh`);
    expect(text).toContain(`${t().holdingsTotal} 150 dh`);
    expect(text).toContain(`${t().claimsTotal} 150 dh`);
  });

  it('shows a side’s total to the cent, including the one that makes a difference', () => {
    setLanguage('en', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={HELD_MORE_BY_ONE_CENT} />, 'dirham'));
    expect(text).toContain(`${t().holdingsTotal} 150.01 dh`);
    expect(text).toContain(`${t().claimsTotal} 150 dh`);
    expect(text).toContain(`${t().lines.cash} 100.01 dh`);
  });

  it('shows a negative amount with its minus sign, in both units', () => {
    setLanguage('en', { persist: false });
    const rial = textOf(markup(<IntegrityBreakdown report={NEGATIVE_LINES} />));
    expect(rial).toContain(`${t().lines.cash} -500 rial`);
    expect(rial).toContain(`${t().lines.partner_balances} -60 rial`);
    const dirham = textOf(markup(<IntegrityBreakdown report={NEGATIVE_LINES} />, 'dirham'));
    expect(dirham).toContain(`${t().lines.cash} -25 dh`);
    expect(dirham).toContain(`${t().lines.supplier_payables} -1 dh`);
  });

  it('does not crash on a report that lacks lines: it shows the totals it has', () => {
    setLanguage('en', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={{ ...BALANCED, breakdown: [] }} />));
    expect(text).toContain(`${t().holdingsTotal} 3,000 rial`);
    expect(text).not.toContain(t().lines.cash);
  });
});

describe('what a negative amount means', () => {
  it('explains the negative lines that have a meaning of their own', () => {
    setLanguage('en', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={NEGATIVE_LINES} />));
    expect(text).toContain(t().negatives.cash);
    expect(text).toContain(t().negatives.partner_balances);
    expect(text).toContain(t().negatives.unsettled_net_profit);
    expect(text).toContain(t().negatives.supplier_payables);
  });

  it('says money per the records is a bookkeeping result, not a reading of the till', () => {
    setLanguage('en', { persist: false });
    expect(t().negatives.cash).toContain('not a reading of the till or the bank');
  });

  it('explains nothing when the lines are positive', () => {
    setLanguage('en', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={BALANCED} />));
    for (const note of Object.values(t().negatives)) expect(text).not.toContain(note);
  });

  it('explains nothing for a negative line that has no note of its own', () => {
    setLanguage('en', { persist: false });
    const report = {
      ...BALANCED,
      breakdown: BALANCED.breakdown.map((line) =>
        line.key === 'capital' ? { ...line, cents: -1_000 } : line,
      ),
    };
    const text = textOf(markup(<IntegrityBreakdown report={report} />));
    for (const note of Object.values(t().negatives)) expect(text).not.toContain(note);
  });

  it('keeps the minus on screen even when it is only a cent', () => {
    setLanguage('en', { persist: false });
    const report = {
      ...BALANCED,
      breakdown: BALANCED.breakdown.map((line) =>
        line.key === 'cash' ? { ...line, cents: -1 } : line,
      ),
    };
    const text = textOf(markup(<IntegrityBreakdown report={report} />, 'dirham'));
    expect(text).toContain(`${t().lines.cash} -0.01 dh`);
    expect(text).toContain(t().negatives.cash);
  });
});

describe('how the money per the records is worked out', () => {
  it('is folded away until asked for, with the button that opens it', () => {
    setLanguage('en', { persist: false });
    const html = markup(<IntegrityBreakdown report={BALANCED} />);
    expect(html).toContain('aria-expanded="false"');
    expect(textOf(html)).toContain(t().cashHow.title);
    expect(textOf(html)).not.toContain(t().cashHow.added);
  });

  it('explains what is added, what is taken away, what it covers and that it is no count', () => {
    setLanguage('en', { persist: false });
    const html = markup(<IntegrityBreakdown report={BALANCED} cashOpen />);
    const text = textOf(html);
    expect(html).toContain('aria-expanded="true"');
    expect(text).toContain(t().cashHow.added);
    expect(text).toContain(t().cashHow.removed);
    expect(text).toContain(t().cashHow.scope);
    expect(text).toContain(t().cashHow.counted);
  });

  it('is offered once, on the money line only', () => {
    setLanguage('en', { persist: false });
    const html = markup(<IntegrityBreakdown report={BALANCED} />);
    expect(occurrences(textOf(html), t().cashHow.title)).toBe(1);
  });
});

describe('in Arabic', () => {
  it('shows the same lines and totals, with Western digits', () => {
    setLanguage('ar', { persist: false });
    const text = textOf(markup(<IntegrityBreakdown report={BALANCED} />));
    for (const key of INTEGRITY_LINE_KEYS) expect(text).toContain(t().lines[key]);
    expect(text).toContain(`${t().holdingsTotal} 3,000 ريال`);
    expect(text).toContain(`${t().claimsTotal} 3,000 ريال`);
  });
});
