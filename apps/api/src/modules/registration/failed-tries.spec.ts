import { describe, expect, it } from 'vitest';
import { FailedTries } from './failed-tries.js';

const WINDOW = 1000;

describe('FailedTries', () => {
  it('blocks a key only once it has used all its tries', () => {
    const tries = new FailedTries(3, WINDOW);
    expect(tries.blocked('a', 0)).toBe(false);
    tries.fail('a', 0);
    tries.fail('a', 10);
    expect(tries.blocked('a', 20)).toBe(false);
    tries.fail('a', 20);
    expect(tries.blocked('a', 30)).toBe(true);
  });

  it('counts each key on its own', () => {
    const tries = new FailedTries(1, WINDOW);
    tries.fail('a', 0);
    expect(tries.blocked('a', 1)).toBe(true);
    expect(tries.blocked('b', 1)).toBe(false);
  });

  it('lets a key try again when its window is over, and starts a new one', () => {
    const tries = new FailedTries(1, WINDOW);
    tries.fail('a', 0);
    expect(tries.blocked('a', WINDOW - 1)).toBe(true);
    expect(tries.blocked('a', WINDOW)).toBe(false);
    tries.fail('a', WINDOW + 5);
    expect(tries.blocked('a', WINDOW + 6)).toBe(true);
    expect(tries.blocked('a', 2 * WINDOW + 4)).toBe(true);
    expect(tries.blocked('a', 2 * WINDOW + 5)).toBe(false);
  });

  it('does not stretch the window with each failure', () => {
    const tries = new FailedTries(5, WINDOW);
    for (let at = 0; at < 4; at += 1) tries.fail('a', at * 400);
    // The window opened at 0, so the failure at 1200 is already in the next one.
    tries.fail('a', 1200);
    expect(tries.blocked('a', 1201)).toBe(false);
  });

  it('keeps no more keys than its capacity, dropping windows that are over and then the oldest', () => {
    const tries = new FailedTries(1, WINDOW, 3);
    tries.fail('a', 0);
    tries.fail('b', 1);
    tries.fail('c', 2);
    expect(tries.size).toBe(3);
    // Nothing is over yet: the oldest ('a') makes room.
    tries.fail('d', 3);
    expect(tries.size).toBe(3);
    expect(tries.blocked('a', 4)).toBe(false);
    expect(tries.blocked('d', 4)).toBe(true);
    // Windows that are over go first: b, c and d are all over at this time, so only e stays.
    tries.fail('e', WINDOW + 10);
    expect(tries.size).toBe(1);
    expect(tries.blocked('e', WINDOW + 11)).toBe(true);
  });
});
