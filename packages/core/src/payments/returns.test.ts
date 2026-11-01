import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  overpaymentCents,
  returnCreditCents,
  saleTotalAfterReturns,
  shareOfLineCents,
} from './returns.js';

describe('shareOfLineCents (RT1)', () => {
  it('is the proportion of the line, half up, the whole line exactly', () => {
    expect(shareOfLineCents(10_000, 230, 100)).toBe(4348); // T2: round(10000 × 100 / 230)
    expect(shareOfLineCents(10_000, 230, 230)).toBe(10_000);
    expect(shareOfLineCents(10_000, 230, 0)).toBe(0);
    expect(shareOfLineCents(1, 2, 1)).toBe(1); // 0.5 rounds up
  });

  it('rejects returning more than was sold, and non-integers', () => {
    expect(() => shareOfLineCents(100, 10, 11)).toThrow(RangeError);
    expect(() => shareOfLineCents(100, 0, 0)).toThrow(RangeError);
    expect(() => shareOfLineCents(100, 10, 1.5)).toThrow(RangeError);
    expect(() => shareOfLineCents(-1, 10, 1)).toThrow(RangeError);
  });

  it('property: never drifts; returns in any split add up to the line, and grow with the length', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { maxLength: 6 }),
        (amount, soldCm, cuts) => {
          let returned = 0;
          let taken = 0;
          for (const cut of cuts) {
            const next = Math.min(soldCm, returned + cut);
            const share =
              shareOfLineCents(amount, soldCm, next) - shareOfLineCents(amount, soldCm, returned);
            expect(share).toBeGreaterThanOrEqual(0);
            taken += share;
            returned = next;
          }
          expect(taken).toBe(shareOfLineCents(amount, soldCm, returned));
          expect(shareOfLineCents(amount, soldCm, soldCm)).toBe(amount);
        },
      ),
    );
  });
});

describe('saleTotalAfterReturns / returnCreditCents (RT2)', () => {
  const line = (lineTotalCents: number, soldCm: number, returnedCm = 0) => ({
    lineTotalCents,
    soldCm,
    returnedCm,
  });

  it('is the invoice total when nothing was returned', () => {
    expect(
      saleTotalAfterReturns({ lines: [line(5000, 250), line(3000, 100)], discountCents: 500 }),
    ).toBe(7500);
  });

  it('credits the proportional price of what comes back', () => {
    // 2.5 m at 20 dh: returning 1 m gives back 20 dh.
    expect(
      returnCreditCents({ lines: [{ ...line(5000, 250), returningCm: 100 }], discountCents: 0 }),
    ).toBe(2000);
  });

  it('shares the invoice discount in proportion: the customer got that much off the goods', () => {
    // 100 dh of cloth, 10 dh off: paid 90. Half back = 45.
    expect(
      returnCreditCents({
        lines: [{ ...line(10_000, 400), returningCm: 200 }],
        discountCents: 1000,
      }),
    ).toBe(4500);
  });

  it('returning everything credits the whole invoice, discount included', () => {
    const lines = [
      { ...line(5000, 250), returningCm: 250 },
      { ...line(3001, 100), returningCm: 100 },
    ];
    expect(returnCreditCents({ lines, discountCents: 501 })).toBe(7500);
  });

  it('a second return credits only what is new', () => {
    const first = returnCreditCents({
      lines: [{ ...line(5000, 250), returningCm: 100 }],
      discountCents: 0,
    });
    const second = returnCreditCents({
      lines: [{ ...line(5000, 250, 100), returningCm: 150 }],
      discountCents: 0,
    });
    expect(first + second).toBe(5000);
  });

  it('rejects a discount above the lines', () => {
    expect(() => saleTotalAfterReturns({ lines: [line(100, 10)], discountCents: 101 })).toThrow(
      RangeError,
    );
  });

  it('property: never rises as more is returned, never negative, and ends at 0', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lineTotalCents: fc.integer({ min: 0, max: 1_000_000 }),
            soldCm: fc.integer({ min: 1, max: 5000 }),
            fraction: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (rows, discountFraction) => {
          const linesCents = rows.reduce((sum, row) => sum + row.lineTotalCents, 0);
          const discountCents = Math.floor(linesCents * discountFraction);
          let previous = saleTotalAfterReturns({
            discountCents,
            lines: rows.map((row) => ({ ...row, returnedCm: 0 })),
          });
          expect(previous).toBe(linesCents - discountCents);
          for (const step of [0.25, 0.5, 0.75, 1]) {
            const total = saleTotalAfterReturns({
              discountCents,
              lines: rows.map((row) => ({
                ...row,
                returnedCm: Math.min(row.soldCm, Math.floor(row.soldCm * row.fraction * step)),
              })),
            });
            expect(total).toBeLessThanOrEqual(previous);
            expect(total).toBeGreaterThanOrEqual(0);
            previous = total;
          }
          const all = saleTotalAfterReturns({
            discountCents,
            lines: rows.map((row) => ({ ...row, returnedCm: row.soldCm })),
          });
          expect(all).toBe(0);
        },
      ),
    );
  });
});

describe('overpaymentCents (RT3)', () => {
  it('is what was paid beyond the invoice after returns, less what was handed back', () => {
    expect(overpaymentCents(7000, 10_000)).toBe(3000);
    expect(overpaymentCents(7000, 10_000, 3000)).toBe(0);
    expect(overpaymentCents(7000, 5000)).toBe(0); // still owes: the credit only reduced the debt
  });
});
