import { lockedThroughOf, periodLockIssues } from '@fabric/contracts';
import type { ShopDatabase } from './db';
import { ReadOnlyError, ValidationError } from './errors';

const DEVICE_ID = 'deviceId';

/**
 * What repositories, the session and the sync engine share: the database, this device's id,
 * the clock, and a signal that the outbox has something new.
 */
export class LocalStore {
  private deviceIdPromise: Promise<string> | undefined;
  private readonly listeners = new Set<() => void>();
  private readOnly = false;

  constructor(
    readonly db: ShopDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {
    // Every change goes with an outbox op in the same transaction: refusing the op refuses the
    // change, whichever repository makes it (a partner's account is read-only, BUILD_PROMPTS 4.2).
    db.outbox.hook('creating', () => {
      this.assertWritable();
    });
  }

  /** Set by the session from the signed-in user's role. */
  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
  }

  /** Every write starts here: a read-only account gets a ReadOnlyError before anything is saved. */
  assertWritable(): void {
    if (this.readOnly) throw new ReadOnlyError();
  }

  /**
   * A change dated inside a settled period is refused until that period is unlocked
   * (BUILD_PROMPTS 4.3); the server checks it again. In a transaction, include db.settlements.
   */
  async assertPeriodOpen(dates: readonly (string | null)[]): Promise<void> {
    if (dates.every((date) => date === null)) return;
    const issues = periodLockIssues(dates, lockedThroughOf(await this.db.settlements.toArray()));
    if (issues.length > 0) throw new ValidationError(issues);
  }

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
