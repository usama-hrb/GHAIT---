import { describe, expect, it } from 'vitest';
import { ar } from './ar';
import { en } from './en';

type Leaf = { path: string; value: string | ((...args: unknown[]) => string) };

/** Every text and text function of a catalog, with its dotted path. */
function leaves(node: unknown, path: string[] = []): Leaf[] {
  if (typeof node === 'string' || typeof node === 'function') {
    return [{ path: path.join('.'), value: node as Leaf['value'] }];
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, child]) => leaves(child, [...path, key]));
  }
  throw new TypeError(`${path.join('.')} is neither a text nor a function`);
}

const arabic = leaves(ar);
const english = leaves(en);
const ARABIC_LETTER = /\p{Script=Arabic}/u;

describe('the catalogs', () => {
  it('have the same texts and functions, under the same keys', () => {
    expect(english.map((leaf) => leaf.path)).toEqual(arabic.map((leaf) => leaf.path));
    english.forEach((leaf, index) => {
      expect(typeof leaf.value, leaf.path).toBe(typeof arabic[index]?.value);
    });
  });

  it('give each function the same parameters in both languages', () => {
    english.forEach((leaf, index) => {
      const other = arabic[index]?.value;
      if (typeof leaf.value === 'function' && typeof other === 'function') {
        expect(leaf.value.length, leaf.path).toBe(other.length);
      }
    });
  });

  it('have no empty text', () => {
    for (const leaf of [...arabic, ...english]) {
      if (typeof leaf.value === 'string') expect(leaf.value.trim(), leaf.path).not.toBe('');
    }
  });

  it('keep Arabic out of the English texts', () => {
    for (const leaf of english) {
      if (typeof leaf.value === 'string') expect(leaf.value, leaf.path).not.toMatch(ARABIC_LETTER);
    }
  });

  it('give a text from every function, for a count of any size', () => {
    for (const catalog of [arabic, english]) {
      for (const leaf of catalog) {
        if (typeof leaf.value !== 'function') continue;
        for (const count of [0, 1, 2, 3, 11, 100]) {
          const text = leaf.value(...Array<unknown>(leaf.value.length).fill(count));
          expect(typeof text, `${leaf.path}(${String(count)})`).toBe('string');
          expect(text.trim(), `${leaf.path}(${String(count)})`).not.toBe('');
        }
      }
    }
  });

  it('write the number of a counted noun in the English text', () => {
    expect(en.shell.pendingOps(0)).toBe('No pending changes');
    expect(en.shell.pendingOps(1)).toBe('1 pending change');
    expect(en.shell.pendingOps(2)).toBe('2 pending changes');
    expect(en.inventory.rollsCount(12)).toBe('12 rolls');
    expect(en.customers.ageDays(1)).toBe('1 day ago');
  });
});
