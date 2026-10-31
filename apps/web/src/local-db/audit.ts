import {
  type AuditActor,
  auditActorsSchema,
  type AuditListResponse,
  auditListResponseSchema,
} from '@fabric/contracts';
import { z } from 'zod';
import { NetworkError } from './api';
import { NeedsServerError, type ServerLink } from './settlements';
import type { LocalStore } from './store';

const PAGE_CACHE = 'auditCache';
const ACTORS_CACHE = 'auditActors';

export interface AuditFilters {
  entity?: string;
  actorId?: string;
  /** Days, inclusive. */
  from?: string;
  to?: string;
}

export interface AuditPage extends AuditListResponse {
  fetchedAt: string;
  /** This device's copy of the search's first page: the server could not be reached. */
  cached: boolean;
}

/** The first page of the last searches, by their query (newest kept). */
const cacheSchema = z.record(
  z.string(),
  z.object({ fetchedAt: z.string(), page: auditListResponseSchema }),
);
const CACHED_SEARCHES = 10;

/**
 * The audit log (BUILD_PROMPTS 4.4) is the server's: it records what the server applied, from
 * every device. Read online; the first page of the last searches is kept for offline (ADR 0006).
 */
export class AuditRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly server?: ServerLink,
  ) {}

  async list(filters: AuditFilters, cursor?: number): Promise<AuditPage> {
    const params = new URLSearchParams({ limit: '50' });
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === 'string' && value !== '') params.set(key, value);
    }
    const key = params.toString();
    if (cursor !== undefined) params.set('cursor', String(cursor));
    const parsed = cacheSchema.safeParse(await this.store.getMeta(PAGE_CACHE));
    const cache = parsed.success ? parsed.data : {};
    try {
      if (!this.server) throw new NeedsServerError('The audit log is on the server');
      const page = await this.server.request(
        `/audit?${params.toString()}`,
        auditListResponseSchema,
      );
      const fetchedAt = this.store.now().toISOString();
      if (cursor === undefined) {
        const kept = Object.entries({ ...cache, [key]: { fetchedAt, page } })
          .sort(([, a], [, b]) => b.fetchedAt.localeCompare(a.fetchedAt))
          .slice(0, CACHED_SEARCHES);
        await this.store.setMeta(PAGE_CACHE, Object.fromEntries(kept));
      }
      return { ...page, fetchedAt, cached: false };
    } catch (error) {
      const hit = cache[key];
      const offline = error instanceof NetworkError || error instanceof NeedsServerError;
      if (offline && cursor === undefined && hit) {
        return { ...hit.page, fetchedAt: hit.fetchedAt, cached: true };
      }
      throw error;
    }
  }

  /** The accounts that can appear in the log (kept for offline). */
  async actors(): Promise<AuditActor[]> {
    try {
      if (!this.server) throw new NeedsServerError('The audit log is on the server');
      const actors = await this.server.request('/audit/actors', auditActorsSchema);
      await this.store.setMeta(ACTORS_CACHE, actors);
      return actors;
    } catch (error) {
      const cache = auditActorsSchema.safeParse(await this.store.getMeta(ACTORS_CACHE));
      if (cache.success) return cache.data;
      if (error instanceof NetworkError || error instanceof NeedsServerError) return [];
      throw error;
    }
  }
}
