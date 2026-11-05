import { describe, expect, it } from 'vitest';
import type { PricedSale } from '@fabric/contracts';
import {
  type CartItem,
  heldByBill,
  needsCostConfirmationAtPayment,
  type PricedItem,
  priceKeyOf,
} from './cart';

/** A bill line: `quantity` (cm or pieces) taken from a batch. */
const take = (batchId: string, quantity: number, unit: 'meter' | 'piece' = 'meter') => ({
  batchId,
  batchCode: batchId.toUpperCase(),
  unit,
  quantity,
  price: { perUnitCents: 2000 },
  refPriceCents: 2000,
  minPriceCents: 1700,
  minOverrideBy: null,
});

const item = (
  key: string,
  productId: string,
  lines: ReturnType<typeof take>[],
  unit: 'meter' | 'piece' = 'meter',
): CartItem => ({
  key,
  product: { id: productId, name: productId },
  unit,
  batchChoice: 'auto',
  belowCostConfirmed: false,
  lines,
});

describe('what the rest of the bill holds (the POS line dialog)', () => {
  it('is nothing for an empty bill: the first line has the whole shelf', () => {
    expect(heldByBill([], 'meter').size).toBe(0);
  });

  it('keeps each product’s batches apart: a second product is added next to the first', () => {
    const bill = [item('a', 'rosa', [take('rosa-1', 50)])];
    expect(heldByBill(bill, 'meter')).toEqual(new Map([['rosa-1', 50]]));
    const two = [...bill, item('b', 'satin', [take('satin-1', 100)])];
    expect(heldByBill(two, 'meter')).toEqual(
      new Map([
        ['rosa-1', 50],
        ['satin-1', 100],
      ]),
    );
  });

  it('adds up two lines, or one split line, that take from the same batch', () => {
    const bill = [
      item('a', 'rosa', [take('rosa-1', 100), take('rosa-2', 20)]),
      item('b', 'rosa', [take('rosa-1', 150)]),
    ];
    expect(heldByBill(bill, 'meter')).toEqual(
      new Map([
        ['rosa-1', 250],
        ['rosa-2', 20],
      ]),
    );
  });

  it('counts only the unit being sold: pieces held do not take meters off a batch', () => {
    const bill = [
      item('a', 'rosa', [take('rosa-1', 100)]),
      item('b', 'rosa', [take('rosa-1', 2, 'piece')], 'piece'),
    ];
    expect(heldByBill(bill, 'meter')).toEqual(new Map([['rosa-1', 100]]));
    expect(heldByBill(bill, 'piece')).toEqual(new Map([['rosa-1', 2]]));
  });

  it('follows the bill as a line is removed or changed after another product was added', () => {
    const rosa = item('a', 'rosa', [take('rosa-1', 50)]);
    const satin = item('b', 'satin', [take('satin-1', 100)]);
    // Removing the first line frees its batch and leaves the second product’s hold alone.
    expect(heldByBill([satin], 'meter')).toEqual(new Map([['satin-1', 100]]));
    // Changing a line: the dialog is given the bill without it (its own quantity is free).
    const others = [rosa, satin].filter((entry) => entry.key !== 'b');
    expect(heldByBill(others, 'meter')).toEqual(new Map([['rosa-1', 50]]));
    // The changed line is put back with its new quantity; the other line is as it was.
    const changed = item('b', 'satin', [take('satin-1', 300)]);
    expect(heldByBill([rosa, changed], 'meter')).toEqual(
      new Map([
        ['rosa-1', 50],
        ['satin-1', 300],
      ]),
    );
    expect(rosa.lines[0]?.quantity).toBe(50);
  });
});

describe('what an owner confirmation is bound to (the POS minimum-price override)', () => {
  it('is the unit and the exact price: another price is another confirmation', () => {
    expect(priceKeyOf('meter', { perUnitCents: 1700 })).toBe(
      priceKeyOf('meter', { perUnitCents: 1700 }),
    );
    expect(priceKeyOf('meter', { perUnitCents: 1700 })).not.toBe(
      priceKeyOf('meter', { perUnitCents: 1699 }),
    );
  });

  it('tells a unit price from a whole piece price of the same cents, and a metre from a piece', () => {
    expect(priceKeyOf('meter', { perUnitCents: 1700 })).not.toBe(
      priceKeyOf('meter', { wholePieceCents: 1700 }),
    );
    expect(priceKeyOf('meter', { perUnitCents: 1700 })).not.toBe(
      priceKeyOf('piece', { perUnitCents: 1700 }),
    );
  });
});

describe('when paying still asks for the below-cost confirmation', () => {
  const priced = (entry: CartItem, belowCost: boolean): PricedItem => ({
    item: entry,
    totalCents: 1000,
    warnings: [],
    belowCost,
  });
  const split = (belowCost: boolean, discountCents: number): NonNullable<PricedSale['split']> =>
    ({ belowCost, discountCents }) as NonNullable<PricedSale['split']>;
  const confirmed = (key: string) => ({
    ...item(key, 'p', [take('a', 100)]),
    belowCostConfirmed: true,
  });
  const unconfirmed = (key: string) => item(key, 'p', [take('a', 100)]);

  it('does not, for a bill with nothing under cost', () => {
    expect(needsCostConfirmationAtPayment([priced(unconfirmed('1'), false)], split(false, 0))).toBe(
      false,
    );
  });

  it('does not, when every line under cost was confirmed where it was typed', () => {
    expect(
      needsCostConfirmationAtPayment(
        [priced(confirmed('1'), true), priced(confirmed('2'), true)],
        split(true, 0),
      ),
    ).toBe(false);
  });

  it('does, for a line under cost that nobody confirmed (the cost moved with the rest of the bill)', () => {
    expect(
      needsCostConfirmationAtPayment(
        [priced(confirmed('1'), true), priced(unconfirmed('2'), true)],
        split(true, 0),
      ),
    ).toBe(true);
  });

  it('does, when a discount takes the invoice under its cost, even with every line fine', () => {
    expect(
      needsCostConfirmationAtPayment([priced(unconfirmed('1'), false)], split(true, 500)),
    ).toBe(true);
  });

  it('does not, for a profitable invoice with a confirmed loss line and no discount', () => {
    expect(
      needsCostConfirmationAtPayment(
        [priced(confirmed('1'), true), priced(unconfirmed('2'), false)],
        split(false, 0),
      ),
    ).toBe(false);
  });

  it('does not, while the bill cannot be priced yet', () => {
    expect(needsCostConfirmationAtPayment([], null)).toBe(false);
  });
});
