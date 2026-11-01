import { describe, expect, it } from 'vitest';
import { fitWithin } from './image';

describe('fitWithin', () => {
  it('shrinks the longest side to the limit, keeping the proportions', () => {
    expect(fitWithin(2048, 2048, 480)).toEqual({ width: 480, height: 480 });
    expect(fitWithin(4000, 3000, 480)).toEqual({ width: 480, height: 360 });
    expect(fitWithin(3000, 4000, 480)).toEqual({ width: 360, height: 480 });
  });

  it('never enlarges a small picture', () => {
    expect(fitWithin(300, 200, 480)).toEqual({ width: 300, height: 200 });
  });

  it('never goes below one pixel', () => {
    expect(fitWithin(10_000, 1, 480)).toEqual({ width: 480, height: 1 });
  });
});
