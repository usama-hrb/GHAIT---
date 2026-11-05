import {
  type PhotoImage,
  type SellingUnits,
  SETTINGS,
  type SettingKey,
  settingSchema,
  type SettingValue,
} from '@fabric/contracts';
import type { MoneyUnit } from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import { parseOrThrow } from './errors';
import { NeedsServerError, type ServerLink } from './settlements';
import type { LocalStore } from './store';
import { SettingsRepository } from './tables';

/** How the shop presents itself, from its settings: the one source of its name and its logo. */
export interface ShopIdentity {
  name: string;
  /** Null while there is none: the built-in brand mark shows. */
  logo: PhotoImage | null;
}

/**
 * The shop's settings (ADR 0017): read from this device's copy, offline included, and changed on
 * the server, which validates and audits every change and sends it to every device (`setting` is
 * a pull-only entity, ADR 0002). A change therefore needs a connection; nothing is queued, so a
 * device never shows a value the server has not accepted.
 */
export class ShopSettingsRepository extends SettingsRepository {
  constructor(
    store: LocalStore,
    private readonly server?: ServerLink,
  ) {
    super(store);
  }

  /** The shop's name and logo, today's value of each. */
  async identity(day = shopToday()): Promise<ShopIdentity> {
    const [name, logo] = await Promise.all([
      this.get('shop_name', day),
      this.get('shop_logo', day),
    ]);
    return { name, logo };
  }

  /**
   * Changes a setting on the server for every day (no effective date), then syncs so this device
   * has it. Refused here first, with the contract's rules, what the server would refuse.
   */
  async save<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    this.store.assertWritable();
    const checked = parseOrThrow(SETTINGS[key].schema, value);
    if (!this.server) throw new NeedsServerError('Settings are changed on the server');
    await this.server.request(`/settings/${key}`, settingSchema, {
      method: 'PUT',
      body: { value: checked, effectiveFrom: null },
    });
    await this.server.syncNow();
  }

  /** The units the shop works in (ADR 0023): every unit on until the owner chooses. */
  sellingUnits(day = shopToday()): Promise<SellingUnits> {
    return this.get('selling_units', day);
  }

  /** The money display unit, rial or dirham (display only: stored amounts are cents). */
  moneyUnit(day = shopToday()): Promise<MoneyUnit> {
    return this.get('money_display_unit', day);
  }
}
