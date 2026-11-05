import { describe, expect, it } from 'vitest';
import { formatPermille, permilleOf } from './percent';

describe('permilleOf', () => {
  it('equal thirds are 333 thousandths each (display only: they add to 999)', () => {
    expect([1, 1, 1].map((weight) => permilleOf(weight, 3))).toEqual([333, 333, 333]);
  });

  it('basis-point weights give their own percentage', () => {
    expect([4000, 4000, 2000].map((weight) => permilleOf(weight, 10_000))).toEqual([400, 400, 200]);
  });

  it('rounds half up', () => {
    expect(permilleOf(1, 8)).toBe(125);
    expect(permilleOf(1, 16)).toBe(63); // 62.5 → 63
  });

  it('is 0 when there is nothing to divide by', () => {
    expect(permilleOf(0, 0)).toBe(0);
    expect(permilleOf(5, 0)).toBe(0);
  });
});

describe('formatPermille', () => {
  it('shows one decimal only when there is one', () => {
    expect(formatPermille(333)).toBe('33.3%');
    expect(formatPermille(500)).toBe('50%');
    expect(formatPermille(1000)).toBe('100%');
    expect(formatPermille(5)).toBe('0.5%');
    expect(formatPermille(0)).toBe('0%');
  });
});
