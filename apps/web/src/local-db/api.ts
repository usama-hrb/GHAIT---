import { errorResponseSchema, HEADERS, type ValidationIssue } from '@fabric/contracts';
import type { LocalStore } from './store';

/** No network (or the server is unreachable): retry later; local work goes on. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

/** The server answered with an error (the API's one error shape). */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    /** errorCodeSchema value, or `unknown` for a body that is not the API's. */
    readonly code: string,
    message: string,
    /** Which rules the request broke (e.g. settlement_preview_changed). */
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The only place the web app calls the API (CLAUDE.md: features never fetch). Same origin:
 * Caddy serves the API under /api in production; `next dev` proxies it (next.config.ts).
 */
export class ApiClient {
  constructor(
    private readonly store: LocalStore,
    private readonly fetchFn: FetchLike = (input, init) => fetch(input, init),
    private readonly baseUrl = '/api',
  ) {}

  async send(
    path: string,
    { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      [HEADERS.deviceId]: await this.store.deviceId(),
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : 'Network error');
    }
  }
}

/** The response's ApiError (call when !response.ok). */
export async function apiErrorOf(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorResponseSchema.safeParse(body);
  return parsed.success
    ? new ApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.issues,
      )
    : new ApiError(response.status, 'unknown', `HTTP ${String(response.status)}`);
}
