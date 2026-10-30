import type { SettingKey } from '@fabric/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { schema, TransactionHost } from '../../database/index.js';

export type SettingRow = typeof schema.setting.$inferSelect;

@Injectable()
export class SettingsRepository {
  constructor(private readonly tx: TransactionHost) {}

  /** Live rows (not voided), of one key or of all. */
  list(key?: SettingKey): Promise<SettingRow[]> {
    const { setting } = schema;
    return this.tx.db
      .select()
      .from(setting)
      .where(and(isNull(setting.voidedAt), key === undefined ? undefined : eq(setting.key, key)));
  }

  /** For sync pull: rows with server_seq > since, oldest first (voided included). */
  pull(since: number, limit: number): Promise<SettingRow[]> {
    return this.tx.db
      .select()
      .from(schema.setting)
      .where(gt(schema.setting.serverSeq, since))
      .orderBy(asc(schema.setting.serverSeq))
      .limit(limit);
  }

  /** The row for this key and start date, locked for the update that follows. */
  async findForUpdate(
    key: SettingKey,
    effectiveFrom: string | null,
  ): Promise<SettingRow | undefined> {
    const { setting } = schema;
    const [row] = await this.tx.db
      .select()
      .from(setting)
      .where(
        and(
          eq(setting.key, key),
          effectiveFrom === null
            ? isNull(setting.effectiveFrom)
            : eq(setting.effectiveFrom, effectiveFrom),
          isNull(setting.voidedAt),
        ),
      )
      .for('update');
    return row;
  }

  async insert(row: {
    key: SettingKey;
    value: unknown;
    effectiveFrom: string | null;
    deviceId: string;
  }): Promise<SettingRow> {
    const [inserted] = await this.tx.db.insert(schema.setting).values(row).returning();
    if (!inserted) throw new Error('insert returned no row');
    return inserted;
  }

  async updateValue(id: string, value: unknown, deviceId: string): Promise<SettingRow> {
    const [updated] = await this.tx.db
      .update(schema.setting)
      .set({ value, deviceId, updatedAt: new Date() })
      .where(eq(schema.setting.id, id))
      .returning();
    if (!updated) throw new Error(`no setting row ${id}`);
    return updated;
  }
}
