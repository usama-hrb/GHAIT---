/**
 * Failed tries of one kind, counted for each key (a client address) in a window of time. The first
 * failure of a key opens its window; once `max` failures are in it, the key is blocked until the
 * window ends, and then it starts again. Kept in memory: it limits guessing, it is not a record,
 * and the server is one process. The table is bounded, so a flood of addresses cannot grow it
 * without end: a full table first drops the windows that are over, then the oldest.
 */
export class FailedTries {
  private readonly windows = new Map<string, { count: number; start: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly capacity = 10_000,
  ) {}

  /** Whether `key` has used its tries in the window it is in at `now` (milliseconds). */
  blocked(key: string, now: number): boolean {
    const window = this.windows.get(key);
    if (!window) return false;
    if (now - window.start >= this.windowMs) {
      this.windows.delete(key);
      return false;
    }
    return window.count >= this.max;
  }

  /** Counts one failure of `key` at `now`. */
  fail(key: string, now: number): void {
    const window = this.windows.get(key);
    if (window && now - window.start < this.windowMs) {
      window.count += 1;
      return;
    }
    // A window that is over, or none: this failure opens a new one.
    this.windows.delete(key);
    if (this.windows.size >= this.capacity) this.makeRoom(now);
    this.windows.set(key, { count: 1, start: now });
  }

  /** The number of keys held (for tests). */
  get size(): number {
    return this.windows.size;
  }

  private makeRoom(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
    // Still full: the oldest window goes. A Map keeps its keys in the order they were added.
    while (this.windows.size >= this.capacity) {
      const oldest = this.windows.keys().next();
      if (oldest.done) return;
      this.windows.delete(oldest.value);
    }
  }
}
