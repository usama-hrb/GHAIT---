import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { bindShop, controlSchema } from '../../database/index.js';
import { ShopsRepository } from './shops.repository.js';

/** Commands and tests that work for one named shop (ADR 0029). */
@Injectable()
export class ShopsService {
  constructor(private readonly repository: ShopsRepository) {}

  /**
   * Runs `work` for the shop with this slug, as a request for its address would be run. A shop
   * that is being made or switched off can be worked on (an operator's command must reach it); a
   * shop that does not exist or is closed cannot. It cannot nest: see `bindShop`.
   */
  async runAsShop<T>(slug: string, work: () => Promise<T>): Promise<T> {
    const record = await this.repository.findBySlug(slug);
    if (!record || record.state === 'closed') {
      throw new Error(`There is no open shop "${slug}"`);
    }
    return bindShop({ id: record.id, slug: record.slug, databaseName: record.dbName }, work);
  }

  /**
   * Whether Caddy may get an HTTPS certificate for this name (ADR 0029, Step 7): it belongs to a
   * shop that is not closed. A shop that is being made or switched off counts, because its
   * address must still answer (the tablets of a suspended shop read "switched off" from it). An
   * IP address never counts: the live shop's bare-IP address has the certificate of Caddy's own
   * authority and must not be sent to Let's Encrypt. Read from the control database each time,
   * with no cache: Caddy asks only for a name that has no certificate yet, and a shop made a
   * moment ago must get its certificate at once.
   */
  async hasOpenShopAt(host: string): Promise<boolean> {
    const name = host.toLowerCase();
    if (isIP(name) !== 0 || !controlSchema.SHOP_HOST_PATTERN.test(name)) return false;
    const record = await this.repository.findByHost(name);
    return record !== undefined && record.state !== 'closed';
  }
}
