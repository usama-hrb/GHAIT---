import { INTEGRITY_LINE_KEYS } from '@fabric/contracts';
import { describe, expect, it } from 'vitest';
import { messages, setLanguage } from '@/i18n';
import {
  hasNegativeNote,
  LINE_GROUPS,
  linesOf,
  NEGATIVE_NOTE_KEYS,
  statusOf,
} from './integrity-model';
import {
  BALANCED,
  HELD_LESS_BY_TEN_DIRHAM,
  HELD_MORE_BY_ONE_CENT,
  RECEIVED_AT,
} from './test-support';

describe('statusOf', () => {
  it('says balanced only when the check agrees to the cent', () => {
    expect(statusOf(BALANCED, RECEIVED_AT)).toEqual({ kind: 'balanced' });
  });

  it('does not round a difference away: one cent is a difference', () => {
    expect(statusOf(HELD_MORE_BY_ONE_CENT, RECEIVED_AT)).toEqual({
      kind: 'difference',
      diffCents: 1,
    });
  });

  it('keeps the sign of the difference: positive is held more, negative is held less', () => {
    expect(statusOf(HELD_LESS_BY_TEN_DIRHAM, RECEIVED_AT)).toEqual({
      kind: 'difference',
      diffCents: -1_000,
    });
  });

  it('never says balanced when the flag and the exact difference disagree', () => {
    // Not a state the check produces; the screen still refuses to call it balanced.
    expect(statusOf({ ...BALANCED, ok: true, diffCents: 1 }, RECEIVED_AT)).toEqual({
      kind: 'difference',
      diffCents: 1,
    });
  });

  it('cannot verify on a device that has never received the shop’s records', () => {
    // Its empty records would add up to nothing and look balanced: that is not a check.
    expect(statusOf(BALANCED, null)).toEqual({ kind: 'unable', reason: 'notReceived' });
    expect(statusOf(null, null)).toEqual({ kind: 'unable', reason: 'notReceived' });
  });

  it('cannot verify when the check could not run on the records the device holds', () => {
    expect(statusOf(null, RECEIVED_AT)).toEqual({ kind: 'unable', reason: 'incomplete' });
  });
});

describe('the lines of the check', () => {
  it('lays out every line the check returns, once', () => {
    const laid = [...LINE_GROUPS.holdings, ...LINE_GROUPS.partners, ...LINE_GROUPS.owed];
    expect([...laid].sort()).toEqual([...INTEGRITY_LINE_KEYS].sort());
    expect(new Set(laid).size).toBe(laid.length);
  });

  it('puts each line on the side the check puts it on', () => {
    for (const key of LINE_GROUPS.holdings) {
      expect(BALANCED.breakdown.find((line) => line.key === key)?.side).toBe('holdings');
    }
    for (const key of [...LINE_GROUPS.partners, ...LINE_GROUPS.owed]) {
      expect(BALANCED.breakdown.find((line) => line.key === key)?.side).toBe('claims');
    }
  });

  it('linesOf returns the lines in the order asked, and leaves out one the report lacks', () => {
    expect(linesOf(BALANCED, ['stock_at_cost', 'cash']).map((line) => line.key)).toEqual([
      'stock_at_cost',
      'cash',
    ]);
    const withoutCash = { ...BALANCED, breakdown: BALANCED.breakdown.slice(1) };
    expect(linesOf(withoutCash, LINE_GROUPS.holdings).map((line) => line.key)).toEqual([
      'stock_at_cost',
      'unrecovered_capital',
    ]);
    expect(linesOf({ ...BALANCED, breakdown: [] }, LINE_GROUPS.holdings)).toEqual([]);
  });

  it('keeps the amounts as the check returns them, signs included', () => {
    expect(linesOf(HELD_LESS_BY_TEN_DIRHAM, ['cash'])).toEqual([
      { side: 'holdings', key: 'cash', cents: 9_000 },
    ]);
  });
});

describe('the negative amounts that are explained', () => {
  it('names the four lines whose negative amount has a meaning of its own', () => {
    expect([...NEGATIVE_NOTE_KEYS].sort()).toEqual([
      'cash',
      'partner_balances',
      'supplier_payables',
      'unsettled_net_profit',
    ]);
    for (const key of INTEGRITY_LINE_KEYS) {
      expect(hasNegativeNote(key)).toBe((NEGATIVE_NOTE_KEYS as readonly string[]).includes(key));
    }
  });

  it('has a text for each of them in both languages', () => {
    for (const language of ['en', 'ar'] as const) {
      setLanguage(language, { persist: false });
      for (const key of NEGATIVE_NOTE_KEYS) {
        expect(messages.integrity.negatives[key].length).toBeGreaterThan(10);
      }
    }
  });
});
