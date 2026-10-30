import { describe, expect, it } from 'vitest';
import { messages } from './index';

describe('Arabic plural forms', () => {
  it.each([
    [0, 'لا عمليات معلّقة'],
    [1, 'عملية معلّقة واحدة'],
    [2, 'عمليتان معلّقتان'],
    [3, '3 عمليات معلّقة'],
    [10, '10 عمليات معلّقة'],
    [11, '11 عملية معلّقة'],
    [100, '100 عملية معلّقة'],
  ])('%i → %s', (count, text) => {
    expect(messages.shell.pendingOps(count)).toBe(text);
  });
});
