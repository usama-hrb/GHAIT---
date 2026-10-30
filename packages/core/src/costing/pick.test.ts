import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { proposeRolls, type RollOnHand, rollsOldestFirst } from './pick.js';

const roll = (
  id: string,
  remainingCm: number,
  purchaseDate = '2026-10-01',
  createdAt = '2026-10-01T09:00:00.000Z',
): RollOnHand => ({ id, remainingCm, purchaseDate, createdAt, shortCode: `R-A${id}` });

describe('proposeRolls (SPEC §4)', () => {
  it('takes the oldest roll that holds enough on its own', () => {
    const rolls = [
      roll('3', 5000, '2026-10-20'),
      roll('1', 200, '2026-09-01'),
      roll('2', 4000, '2026-10-05'),
    ];
    expect(proposeRolls(rolls, 300)).toEqual({ takes: [{ rollId: '2', cm: 300 }], shortCm: 0 });
    expect(proposeRolls(rolls, 150)).toEqual({ takes: [{ rollId: '1', cm: 150 }], shortCm: 0 });
  });

  it('splits across rolls oldest first when none holds enough', () => {
    const rolls = [roll('b', 300, '2026-10-02'), roll('a', 250, '2026-10-01')];
    expect(proposeRolls(rolls, 400)).toEqual({
      takes: [
        { rollId: 'a', cm: 250 },
        { rollId: 'b', cm: 150 },
      ],
      shortCm: 0,
    });
  });

  it('breaks date ties by creation time, then code, and skips empty or oversold rolls', () => {
    const rolls = [
      roll('2', 100, '2026-10-01', '2026-10-01T10:00:00.000Z'),
      roll('1', 100, '2026-10-01', '2026-10-01T10:00:00.000Z'),
      roll('0', 100, '2026-10-01', '2026-10-01T11:00:00.000Z'),
      roll('x', 0),
      roll('y', -50),
    ];
    expect(proposeRolls(rolls, 50).takes).toEqual([{ rollId: '1', cm: 50 }]);
    expect(proposeRolls(rolls, 250).takes.map((take) => take.rollId)).toEqual(['1', '2', '0']);
    expect(rollsOldestFirst(rolls).map((r) => r.id)).toEqual(['x', 'y', '1', '2', '0']);
  });

  it('says how much the rolls cannot cover', () => {
    expect(proposeRolls([roll('a', 120)], 200)).toEqual({
      takes: [{ rollId: 'a', cm: 120 }],
      shortCm: 80,
    });
    expect(proposeRolls([], 200)).toEqual({ takes: [], shortCm: 200 });
    expect(() => proposeRolls([], 0)).toThrow(RangeError);
  });

  it('property: takes plus the shortfall make the wanted length, never more than a roll holds', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -100, max: 2000 }), { maxLength: 8 }),
        fc.integer({ min: 1, max: 10_000 }),
        (lengths, wantedCm) => {
          const rolls = lengths.map((cm, index) =>
            roll(String(index), cm, `2026-10-${String(10 + index)}`),
          );
          const { takes, shortCm } = proposeRolls(rolls, wantedCm);
          expect(takes.reduce((sum, take) => sum + take.cm, 0) + shortCm).toBe(wantedCm);
          for (const take of takes) {
            const source = rolls.find((r) => r.id === take.rollId);
            expect(take.cm).toBeGreaterThan(0);
            expect(take.cm).toBeLessThanOrEqual(source?.remainingCm ?? 0);
          }
          if (shortCm > 0) {
            expect(takes).toHaveLength(rolls.filter((r) => r.remainingCm > 0).length);
          }
        },
      ),
    );
  });
});
