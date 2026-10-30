import {
  type PutSettingRequest,
  SERVER_DEVICE_ID,
  SETTING_KEYS,
  SETTINGS,
  type Setting,
  type SettingKey,
  settingInEffect,
  SHOP_TIME_ZONE,
  type SyncedSetting,
} from '@fabric/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { requestContext, ValidationFailedException } from '../../common/index.js';
import { AuditService } from '../audit/index.js';
import { SyncRegistry } from '../sync/index.js';
import { type SettingRow, SettingsRepository } from './settings.repository.js';

/** Today in the shop's time zone, YYYY-MM-DD. */
export function shopToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE }).format(now);
}

/**
 * The value of `key` in effect on `at`: the row with the latest effective_from on or before
 * that day (null counts as the earliest), else the default.
 */
export function resolveSetting(key: SettingKey, rows: readonly SettingRow[], at: string): Setting {
  const best = settingInEffect(key, rows, at);
  return best
    ? { key, value: best.value, effectiveFrom: best.effectiveFrom, isDefault: false }
    : { key, value: SETTINGS[key].default, effectiveFrom: null, isDefault: true };
}

/** The row as devices receive it (pull only: they change settings through the API). */
function syncedSetting(row: SettingRow): SyncedSetting {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deviceId: row.deviceId,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    key: row.key,
    value: row.value,
    effectiveFrom: row.effectiveFrom,
  };
}

function view(row: SettingRow) {
  return { id: row.id, key: row.key, value: row.value, effectiveFrom: row.effectiveFrom };
}

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly audit: AuditService,
    private readonly registry: SyncRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      entity: 'setting',
      pull: async (since, limit) =>
        (await this.repository.pull(since, limit)).map((row) => ({
          serverSeq: row.serverSeq,
          record: syncedSetting(row),
        })),
    });
  }

  async list(at = shopToday()): Promise<Setting[]> {
    const rows = await this.repository.list();
    return SETTING_KEYS.map((key) => resolveSetting(key, rows, at));
  }

  async get(key: SettingKey, at = shopToday()): Promise<Setting> {
    return resolveSetting(key, await this.repository.list(key), at);
  }

  /** Sets the value from `effectiveFrom` on (null: since always). Validated per key, audited. */
  async put(key: SettingKey, request: PutSettingRequest): Promise<Setting> {
    const parsed = SETTINGS[key].schema.safeParse(request.value);
    if (!parsed.success) throw new ValidationFailedException(parsed.error, ['value']);
    const value: unknown = parsed.data;
    const deviceId = requestContext()?.deviceId ?? SERVER_DEVICE_ID;

    const existing = await this.repository.findForUpdate(key, request.effectiveFrom);
    const row = existing
      ? await this.repository.updateValue(existing.id, value, deviceId)
      : await this.repository.insert({
          key,
          value,
          effectiveFrom: request.effectiveFrom,
          deviceId,
        });
    await this.audit.record({
      entity: 'setting',
      entityId: row.id,
      action: existing ? 'update' : 'create',
      before: existing ? view(existing) : null,
      after: view(row),
    });
    return { key, value: row.value, effectiveFrom: row.effectiveFrom, isDefault: false };
  }
}
