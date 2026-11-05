import { useSyncExternalStore } from 'react';

/** How the Inventory lists its products: a table (the default on a tablet or desktop), or cards. */
export type InventoryView = 'cards' | 'table';

// Kept on this device only (like the language), never synced.
const KEY = 'fabric.inventoryView';
const listeners = new Set<() => void>();

function read(): InventoryView {
  try {
    return localStorage.getItem(KEY) === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInventoryView(): [InventoryView, (view: InventoryView) => void] {
  const view = useSyncExternalStore(subscribe, read, () => 'table' as const);
  const setView = (next: InventoryView) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the page is left.
    }
    for (const listener of listeners) listener();
  };
  return [view, setView];
}
