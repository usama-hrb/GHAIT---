import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppHttpException } from '../../common/index.js';
import type { ShopRef } from '../../database/index.js';
import { ShopSchema } from './shop-schema.js';
import { ShopsRepository } from './shops.repository.js';

/** How long an answer is trusted before the control database is asked again (ADR 0029). */
export const LOOKUP_TTL_MS = 30_000;
/** After the control database fails, it is not tried again for this long, so requests do not queue on it. */
export const RETRY_AFTER_FAILURE_MS = 5_000;
/** Addresses are typed by anyone: the cache keeps at most this many, so it cannot grow without end. */
export const LOOKUP_CACHE_MAX = 1_000;

/** The same rule as the `shop_host_valid` check of the control database: a name that can never match is not looked up. */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/**
 * What the shop at an address is doing. `unknown` covers an address nobody owns and a shop that is
 * closed: the caller cannot tell which, on purpose. `starting` is a shop being made. `updating` is a
 * shop that is missing migrations of this code (one failed, or it was never run): it is not served.
 */
export type HostAnswer =
  | { readonly kind: 'serve'; readonly shop: ShopRef }
  | { readonly kind: 'suspended' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'updating' }
  | { readonly kind: 'unknown' };

interface Cached {
  readonly answer: HostAnswer;
  readonly at: number;
}

function unavailable(): AppHttpException {
  return new AppHttpException(
    'service_unavailable',
    'The server cannot tell which shop this address is for right now. Try again.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/**
 * Finds the shop for an address, with a short cache: the control database is read once per address
 * every 30 seconds, not once per request. If the control database cannot be reached, an address
 * answered before keeps its last answer, so a short outage does not stop the shops that are
 * running; an address never answered fails closed with 503 (a guess could serve the wrong shop's
 * data). A shop that is missing migrations is answered `updating`; the check is part of the
 * answer, so it is repeated every 30 seconds, and a shop that was fixed is served again without a
 * restart.
 */
@Injectable()
export class ShopLookup {
  private readonly logger = new Logger('ShopLookup');
  private readonly cache = new Map<string, Cached>();
  /** One read per address at a time: a burst of requests to a cold address asks once. */
  private readonly inflight = new Map<string, Promise<HostAnswer>>();
  private retryAt = 0;

  constructor(
    private readonly repository: ShopsRepository,
    private readonly schema: ShopSchema,
  ) {}

  async resolve(host: string): Promise<HostAnswer> {
    if (!HOST_PATTERN.test(host)) return { kind: 'unknown' };
    const now = Date.now();
    const cached = this.cache.get(host);
    if (cached && now - cached.at < LOOKUP_TTL_MS) return cached.answer;
    if (now < this.retryAt) {
      if (cached) return cached.answer;
      throw unavailable();
    }
    const running = this.inflight.get(host);
    if (running) return running;
    const read = this.read(host, cached).finally(() => this.inflight.delete(host));
    this.inflight.set(host, read);
    return read;
  }

  private async read(host: string, stale: Cached | undefined): Promise<HostAnswer> {
    try {
      const record = await this.repository.findByHost(host);
      const answer = await this.served(answerOf(record));
      this.retryAt = 0;
      this.remember(host, answer);
      return answer;
    } catch (error) {
      this.retryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
      this.logger.error({ err: error, host }, 'The control database could not be read');
      if (stale) return stale.answer;
      throw unavailable();
    }
  }

  /** A shop that has not had every migration is not served; the other answers stand. */
  private async served(answer: HostAnswer): Promise<HostAnswer> {
    if (answer.kind !== 'serve' || (await this.schema.isCurrent(answer.shop))) return answer;
    this.logger.warn(`Shop "${answer.shop.slug}" is missing migrations: it answers 503`);
    return { kind: 'updating' };
  }

  private remember(host: string, answer: HostAnswer): void {
    this.cache.delete(host);
    this.cache.set(host, { answer, at: Date.now() });
    if (this.cache.size <= LOOKUP_CACHE_MAX) return;
    // A Map keeps insertion order: the first key is the one answered longest ago.
    const oldest = this.cache.keys().next();
    if (!oldest.done) this.cache.delete(oldest.value);
  }
}

function answerOf(record: Awaited<ReturnType<ShopsRepository['findByHost']>>): HostAnswer {
  if (!record) return { kind: 'unknown' };
  switch (record.state) {
    case 'active':
      return {
        kind: 'serve',
        shop: { id: record.id, slug: record.slug, databaseName: record.dbName },
      };
    case 'suspended':
      return { kind: 'suspended' };
    case 'provisioning':
      return { kind: 'starting' };
    case 'closed':
      return { kind: 'unknown' };
  }
}
