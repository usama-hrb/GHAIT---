import type { ShopDatabase } from './db';

const DEVICE_ID = 'deviceId';

/**
 * What repositories, the session and the sync engine share: the database, this device's id,
 * the clock, and a signal that the outbox has something new.
 */
export class LocalStore {
  private deviceIdPromise: Promise<string> | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly db: ShopDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  now(): Date {
    return this.clock();
  }

  /** Generated once per device (browser profile) and kept: every record and op carries it. */
  deviceId(): Promise<string> {
    this.deviceIdPromise ??= this.db.transaction('rw', this.db.meta, async () => {
      const stored = await this.db.meta.get(DEVICE_ID);
      if (typeof stored?.value === 'string') return stored.value;
      const id = crypto.randomUUID();
      await this.db.meta.put({ key: DEVICE_ID, value: id });
      return id;
    });
    return this.deviceIdPromise;
  }

  async getMeta(key: string): Promise<unknown> {
    return (await this.db.meta.get(key))?.value;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  /** A local write queued an op: the sync engine pushes soon. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(): void {
    for (const listener of this.listeners) listener();
  }
}
