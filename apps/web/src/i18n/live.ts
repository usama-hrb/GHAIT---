import { ar } from './ar';
import { en } from './en';
import type { Language } from './languages';
import { getLanguage } from './store';
import type { Messages } from './types';

const catalogs: Record<Language, Messages> = { ar, en };

function nodeAt(path: readonly string[]): unknown {
  let node: unknown = catalogs[getLanguage()];
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

const nodes = new Map<string, object>();

/**
 * A view of one object of the catalog that reads the language shown at the moment it is read, so
 * `const t = messages.sales` at the top of a file keeps working after the language changes.
 * Texts and functions come straight from the current catalog; objects are views again.
 */
function viewOf(path: readonly string[]): object {
  const id = path.join('\u0000');
  const known = nodes.get(id);
  if (known) return known;
  const view = new Proxy(Array.isArray(nodeAt(path)) ? [] : {}, {
    get(_target, key) {
      const node = nodeAt(path);
      if (typeof key === 'symbol') {
        return node !== null && typeof node === 'object'
          ? (Reflect.get(node, key) as unknown)
          : undefined;
      }
      const value = nodeAt([...path, key]);
      return value !== null && typeof value === 'object' ? viewOf([...path, key]) : value;
    },
    has(_target, key) {
      const node = nodeAt(path);
      return node !== null && typeof node === 'object' && key in node;
    },
    ownKeys() {
      const node = nodeAt(path);
      return node !== null && typeof node === 'object' ? Reflect.ownKeys(node) : [];
    },
    getOwnPropertyDescriptor(_target, key) {
      const node = nodeAt(path);
      if (node === null || typeof node !== 'object' || !(key in node)) return undefined;
      return {
        configurable: true,
        enumerable: true,
        writable: false,
        value: Reflect.get(node, key) as unknown,
      };
    },
  });
  nodes.set(id, view);
  return view;
}

/**
 * Every text of the app, in the language shown now. Read it where it is shown (in a component or a
 * function); do not keep a text in a constant that runs when the file loads, or it keeps the language
 * it was loaded in.
 */
export const messages = viewOf([]) as Messages;
