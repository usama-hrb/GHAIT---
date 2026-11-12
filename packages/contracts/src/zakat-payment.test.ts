import { describe, expect, it } from 'vitest';
import {
  idSchema,
  isDrawOfZakatPayment,
  newZakatPaymentSchema,
  ZAKAT_NOTE_MAX,
  zakatDrawIdOf,
  zakatPaymentNoteOf,
  zakatPaymentReason,
  zakatPaymentStateOf,
} from './index.js';
import { dh } from './test-shop.js';

const HAWL = '2026-10-31';

describe('where a report stands on payment', () => {
  const state = (dueCents: number, paidCents: number, voided = false) =>
    zakatPaymentStateOf({ dueCents, paidCents, voided });

  it('nothing due: nothing to pay, whatever the percentage would say', () => {
    expect(state(0, 0)).toEqual({
      state: 'none_due',
      dueCents: 0,
      paidCents: 0,
      remainingCents: 0,
      excessCents: 0,
      percent: 0,
    });
  });

  it('unpaid: all of it remains', () => {
    expect(state(dh(900), 0)).toEqual({
      state: 'unpaid',
      dueCents: dh(900),
      paidCents: 0,
      remainingCents: dh(900),
      excessCents: 0,
      percent: 0,
    });
  });

  it('partly paid: what is left, and a whole-percent progress that never reads full before it is', () => {
    expect(state(dh(900), dh(300))).toMatchObject({
      state: 'partial',
      remainingCents: dh(600),
      excessCents: 0,
      percent: 33,
    });
    // One cent short of paid is 99%, not 100%.
    expect(state(dh(900), dh(900) - 1)).toMatchObject({ state: 'partial', percent: 99 });
    expect(state(dh(900), 1)).toMatchObject({ state: 'partial', percent: 0 });
  });

  it('fully paid: exactly what is due', () => {
    expect(state(dh(900), dh(900))).toMatchObject({
      state: 'paid',
      remainingCents: 0,
      excessCents: 0,
      percent: 100,
    });
  });

  it('paid beyond what is due (two devices paid offline): the excess is shown, the bar stops at 100', () => {
    expect(state(dh(900), dh(1000))).toMatchObject({
      state: 'overpaid',
      remainingCents: 0,
      excessCents: dh(100),
      percent: 100,
    });
  });

  it('a voided report is voided, with nothing left to pay on it', () => {
    expect(state(dh(900), 0, true)).toMatchObject({ state: 'voided', remainingCents: 0 });
  });

  it('remaining plus paid is due, and paid is never more than the bar shows, across amounts', () => {
    for (const due of [1, 2, 7, 100, 12_345, 3_000_000]) {
      for (const paid of [0, 1, due - 1, due, due + 1, due * 2]) {
        if (paid < 0) continue;
        const summary = state(due, paid);
        expect(summary.remainingCents - summary.excessCents).toBe(due - paid);
        expect(summary.percent).toBeGreaterThanOrEqual(0);
        expect(summary.percent).toBeLessThanOrEqual(100);
        expect(summary.remainingCents).toBeGreaterThanOrEqual(0);
        expect(summary.excessCents).toBeGreaterThanOrEqual(0);
        if (summary.percent === 100) expect(paid).toBeGreaterThanOrEqual(due);
      }
    }
  });
});

describe('a payment’s note travels on its draws’ reason', () => {
  it('without a note the reason is what it always was', () => {
    expect(zakatPaymentReason(HAWL, null)).toBe(`zakat ${HAWL}`);
    expect(zakatPaymentReason(HAWL, '')).toBe(`zakat ${HAWL}`);
    expect(zakatPaymentReason(HAWL, '   ')).toBe(`zakat ${HAWL}`);
  });

  it('with a note it follows the hawl, and reads back', () => {
    const reason = zakatPaymentReason(HAWL, 'Receipt 42 · Hassan');
    expect(reason).toBe(`zakat ${HAWL} · Receipt 42 · Hassan`);
    expect(zakatPaymentNoteOf(reason, HAWL)).toBe('Receipt 42 · Hassan');
  });

  it('a reason with no note, an older one, or one of another hawl, has none to read', () => {
    expect(zakatPaymentNoteOf(`zakat ${HAWL}`, HAWL)).toBeNull();
    expect(zakatPaymentNoteOf(`zakat ${HAWL} · `, HAWL)).toBeNull();
    expect(zakatPaymentNoteOf(`zakat 2025-10-20 · Receipt 1`, HAWL)).toBeNull();
    expect(zakatPaymentNoteOf('a loan', HAWL)).toBeNull();
  });

  it('the longest note still fits the 500 characters a draw’s reason may have', () => {
    const reason = zakatPaymentReason(HAWL, 'x'.repeat(ZAKAT_NOTE_MAX));
    expect(reason.length).toBeLessThanOrEqual(500);
    expect(zakatPaymentNoteOf(reason, HAWL)).toBe('x'.repeat(ZAKAT_NOTE_MAX));
  });

  it('Arabic and mixed-direction notes survive the round trip', () => {
    for (const note of ['إيصال رقم ٤٢', 'Receipt رقم 42', 'للفقير · محمد']) {
      expect(zakatPaymentNoteOf(zakatPaymentReason(HAWL, note), HAWL)).toBe(note);
    }
  });
});

describe('a payment’s identity', () => {
  const payment = '3b241101-e2bb-4255-8caf-4136c566a962';
  const owner = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const partner = '9b2d6c1a-3f4e-4d5b-8a6c-1e2f3a4b5c6d';

  it('gives the same draw id for the same payment and partner, every time', () => {
    expect(zakatDrawIdOf(payment, owner)).toBe(zakatDrawIdOf(payment, owner));
  });

  it('gives another id for another partner, and for another payment', () => {
    const ids = new Set([
      zakatDrawIdOf(payment, owner),
      zakatDrawIdOf(payment, partner),
      zakatDrawIdOf(owner, partner),
      zakatDrawIdOf(partner, owner),
    ]);
    expect(ids.size).toBe(4);
  });

  it('is a valid record id: version 5 layout, RFC 4122 variant', () => {
    const id = zakatDrawIdOf(payment, owner);
    expect(idSchema.safeParse(id).success).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is a valid id for any payment and partner (500 random pairs)', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 500; n++) {
      const id = zakatDrawIdOf(crypto.randomUUID(), crypto.randomUUID());
      expect(idSchema.safeParse(id).success).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
  });

  it('knows its own draws again: the draws of a retried payment are recognised, others are not', () => {
    const draw = { id: zakatDrawIdOf(payment, owner), partnerId: owner };
    expect(isDrawOfZakatPayment(draw, payment)).toBe(true);
    expect(isDrawOfZakatPayment(draw, crypto.randomUUID())).toBe(false);
    expect(isDrawOfZakatPayment({ id: crypto.randomUUID(), partnerId: owner }, payment)).toBe(
      false,
    );
  });
});

describe('the payment request', () => {
  const ok = { amountCents: dh(100), date: '2026-11-12' };

  it('needs only an amount and a day: the identity and the note are optional', () => {
    expect(newZakatPaymentSchema.parse(ok)).toEqual({ ...ok, note: null });
  });

  it('keeps an identity and a trimmed note', () => {
    const paymentId = crypto.randomUUID();
    expect(newZakatPaymentSchema.parse({ ...ok, paymentId, note: '  Receipt 7  ' })).toEqual({
      ...ok,
      paymentId,
      note: 'Receipt 7',
    });
  });

  it('turns a blank note into none', () => {
    expect(newZakatPaymentSchema.parse({ ...ok, note: '   ' }).note).toBeNull();
  });

  it('refuses an identity that is not an id, a note that is too long, and an amount below one cent', () => {
    expect(newZakatPaymentSchema.safeParse({ ...ok, paymentId: 'abc' }).success).toBe(false);
    expect(
      newZakatPaymentSchema.safeParse({ ...ok, note: 'x'.repeat(ZAKAT_NOTE_MAX + 1) }).success,
    ).toBe(false);
    expect(newZakatPaymentSchema.safeParse({ ...ok, amountCents: 0 }).success).toBe(false);
  });
});
