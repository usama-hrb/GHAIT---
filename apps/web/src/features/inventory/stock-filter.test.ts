import { describe, expect, it } from 'vitest';
import { stockFilterOf } from './stock-filter';

describe('the stock filter a link asks for', () => {
  it('opens the filter named, and every product for anything else', () => {
    expect(stockFilterOf('low')).toBe('low');
    expect(stockFilterOf('out')).toBe('out');
    expect(stockFilterOf('awaiting')).toBe('awaiting');
    expect(stockFilterOf('in_stock')).toBe('in_stock');
    expect(stockFilterOf(null)).toBe('all');
    expect(stockFilterOf('LOW')).toBe('all');
    expect(stockFilterOf('everything')).toBe('all');
  });
});
