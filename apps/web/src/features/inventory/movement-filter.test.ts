import { describe, expect, it } from 'vitest';
import type { ProductMovementView } from '@/local-db';
import {
  batchesOfMovements,
  countByType,
  dayOfMovement,
  filterMovements,
  isFiltering,
  type MovementFilter,
  NO_FILTER,
  typesOfMovements,
} from './movement-filter';

let next = 0;
const move = (fields: Partial<ProductMovementView>): ProductMovementView => ({
  id: `m${String(++next)}`,
  batchId: 'b1',
  code: 'B-1',
  type: 'purchase',
  date: '2026-03-10',
  createdAt: '2026-03-10T10:00:00.000Z',
  unit: 'meter',
  amount: 1000,
  costCents: null,
  reference: null,
  note: null,
  ...fields,
});

// Newest first, as the product page hands them over.
const history: ProductMovementView[] = [
  move({
    id: 'sale-2',
    type: 'sale',
    batchId: 'b2',
    code: 'B-2',
    createdAt: '2026-03-12T09:00:00Z',
  }),
  move({ id: 'loss-1', type: 'loss', batchId: 'b1', createdAt: '2026-03-11T09:00:00Z' }),
  move({ id: 'sale-1', type: 'sale', batchId: 'b1', createdAt: '2026-03-11T08:00:00Z' }),
  move({
    id: 'buy-2',
    type: 'purchase',
    batchId: 'b2',
    code: 'B-2',
    createdAt: '2026-03-10T09:00:00Z',
  }),
  move({ id: 'buy-1', type: 'purchase', batchId: 'b1', createdAt: '2026-03-01T09:00:00Z' }),
];

const ids = (moves: readonly ProductMovementView[]) => moves.map((entry) => entry.id);
const filtered = (patch: Partial<MovementFilter>) =>
  ids(filterMovements(history, { ...NO_FILTER, ...patch }));

describe('filterMovements', () => {
  it('shows everything, in order, when nothing is chosen', () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(filtered({})).toEqual(['sale-2', 'loss-1', 'sale-1', 'buy-2', 'buy-1']);
  });

  it('does not hand back the list it was given', () => {
    expect(filterMovements(history, NO_FILTER)).not.toBe(history);
  });

  it('keeps the chosen types, one or several', () => {
    expect(filtered({ types: ['sale'] })).toEqual(['sale-2', 'sale-1']);
    expect(filtered({ types: ['sale', 'loss'] })).toEqual(['sale-2', 'loss-1', 'sale-1']);
  });

  it('keeps the movements of one batch', () => {
    expect(filtered({ batchId: 'b2' })).toEqual(['sale-2', 'buy-2']);
    expect(filtered({ batchId: 'nobody' })).toEqual([]);
  });

  it('keeps the days from, to, and between, ends included', () => {
    expect(filtered({ from: '2026-03-11' })).toEqual(['sale-2', 'loss-1', 'sale-1']);
    expect(filtered({ to: '2026-03-10' })).toEqual(['buy-2', 'buy-1']);
    expect(filtered({ from: '2026-03-10', to: '2026-03-11' })).toEqual([
      'loss-1',
      'sale-1',
      'buy-2',
    ]);
    expect(filtered({ from: '2026-03-12', to: '2026-03-11' })).toEqual([]);
  });

  it('applies every part together', () => {
    expect(
      filtered({ types: ['purchase'], batchId: 'b2', from: '2026-03-10', to: '2026-03-10' }),
    ).toEqual(['buy-2']);
    expect(filtered({ types: ['loss'], batchId: 'b2' })).toEqual([]);
  });

  it('reads the day in the shop time zone, not in UTC', () => {
    // Casablanca is one hour ahead of UTC (outside Ramadan): 23:30 UTC on the 11th is already the
    // 12th there, while 22:30 UTC is still the 11th.
    const late = move({ id: 'late', createdAt: '2026-01-11T23:30:00Z' });
    expect(dayOfMovement(late)).toBe('2026-01-12');
    expect(dayOfMovement(move({ createdAt: '2026-01-11T22:30:00Z' }))).toBe('2026-01-11');
    expect(
      ids(filterMovements([late], { ...NO_FILTER, from: '2026-01-12', to: '2026-01-12' })),
    ).toEqual(['late']);
    expect(
      ids(filterMovements([late], { ...NO_FILTER, from: '2026-01-11', to: '2026-01-11' })),
    ).toEqual([]);
  });

  it('leaves out a movement with an unreadable time only when dates are asked for', () => {
    const broken = move({ id: 'broken', createdAt: 'not a time' });
    expect(dayOfMovement(broken)).toBe('');
    expect(ids(filterMovements([broken], NO_FILTER))).toEqual(['broken']);
    expect(ids(filterMovements([broken], { ...NO_FILTER, types: ['purchase'] }))).toEqual([
      'broken',
    ]);
    expect(ids(filterMovements([broken], { ...NO_FILTER, from: '2000-01-01' }))).toEqual([]);
  });
});

describe('isFiltering', () => {
  it('is true as soon as one part is set', () => {
    expect(isFiltering({ ...NO_FILTER, types: ['sale'] })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, batchId: 'b1' })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, from: '2026-03-01' })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, to: '2026-03-01' })).toBe(true);
  });
});

describe('countByType', () => {
  it('counts each type of the history', () => {
    expect([...countByType(history, NO_FILTER)]).toEqual([
      ['sale', 2],
      ['loss', 1],
      ['purchase', 2],
    ]);
  });

  it('counts within the batch and dates, but not within the types already chosen', () => {
    const counts = countByType(history, { ...NO_FILTER, types: ['loss'], batchId: 'b2' });
    expect(Object.fromEntries(counts)).toEqual({ sale: 1, purchase: 1 });
    const dated = countByType(history, { ...NO_FILTER, from: '2026-03-11' });
    expect(Object.fromEntries(dated)).toEqual({ sale: 2, loss: 1 });
  });
});

describe('typesOfMovements', () => {
  it('lists the types present once each, in the order they are offered', () => {
    expect(typesOfMovements(history)).toEqual(['purchase', 'sale', 'loss']);
    expect(
      typesOfMovements([move({ type: 'measurement' }), move({ type: 'return' }), move({})]),
    ).toEqual(['purchase', 'return', 'measurement']);
  });

  it('has none for an empty history', () => {
    expect(typesOfMovements([])).toEqual([]);
  });
});

describe('batchesOfMovements', () => {
  it('lists each batch once, the one bought first first', () => {
    expect(batchesOfMovements(history)).toEqual([
      { batchId: 'b1', code: 'B-1' },
      { batchId: 'b2', code: 'B-2' },
    ]);
  });

  it('follows the order of purchase, not the order of the codes', () => {
    const newestFirst = [
      move({ batchId: 'later', code: 'B-A9' }),
      move({ batchId: 'later', code: 'B-A9' }),
      move({ batchId: 'first', code: 'B-Z1' }),
    ];
    expect(batchesOfMovements(newestFirst).map((batch) => batch.code)).toEqual(['B-Z1', 'B-A9']);
  });

  it('has none for an empty history', () => {
    expect(batchesOfMovements([])).toEqual([]);
  });
});
