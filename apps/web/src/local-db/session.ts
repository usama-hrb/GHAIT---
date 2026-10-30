import {
  type AccessTokenResponse,
  accessTokenResponseSchema,
  type AuthUser,
  authUserSchema,
  deviceRegistrationSchema,
  type LoginRequest,
} from '@fabric/contracts';
import type { z } from 'zod';
import { type ApiClient, apiErrorOf } from './api';
import { withLock } from './locks';
import type { LocalStore } from './store';

/** The refresh token is gone or refused: sign in again to sync. Local work is not affected. */
export class SignedOutError extends Error {
  override readonly name = 'SignedOutError';
}

export interface SessionState {
  /** loading: reading the device; signed_out: nobody signed in on this device. */
  status: 'loading' | 'signed_out' | 'signed_in';
  /** Kept on the device, so the app opens on its local data offline too. */
  user: AuthUser | null;
  /** Signed in here before, but the server refused the session: sign in again to sync. */
  needsSignIn: boolean;
}

const USER = 'user';
/** This device's code (A, B…), the prefix of the roll codes it makes. */
export const DEVICE_CODE = 'deviceCode';
/** Refresh a little before expiry rather than fail a request. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * The owner's session on this device. The access token lives in memory only; the refresh token
 * in an httpOnly cookie the app never sees (ADR 0004). Refreshing is serialised across tabs
 * (Web Locks): two tabs rotating the same token at once would look like token theft.
 */
export class Session {
  private state: SessionState = { status: 'loading', user: null, needsSignIn: false };
  private token: { value: string; expiresAt: number } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: LocalStore,
    private readonly api: ApiClient,
  ) {}

  readonly getState = (): SessionState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async load(): Promise<void> {
    const user = authUserSchema.safeParse(await this.store.getMeta(USER));
    this.set({
      status: user.success ? 'signed_in' : 'signed_out',
      user: user.success ? user.data : null,
      needsSignIn: false,
    });
  }

  /** Needs the network. Throws ApiError (invalid_credentials, too_many_requests…) or NetworkError. */
  async login(input: LoginRequest): Promise<AuthUser> {
    const response = await this.api.send('/auth/login', { method: 'POST', body: input });
    if (!response.ok) throw await apiErrorOf(response);
    const body = accessTokenResponseSchema.parse(await response.json());
    await this.accept(body);
    await this.ensureDeviceCode();
    return body.user;
  }

  /**
   * Gets this device's code from the server once (POST /devices/register, idempotent) and keeps
   * it: from then on the device makes roll codes offline.
   */
  async ensureDeviceCode(): Promise<string> {
    const stored = await this.store.getMeta(DEVICE_CODE);
    if (typeof stored === 'string') return stored;
    const { code } = await this.request('/devices/register', deviceRegistrationSchema, {
      method: 'POST',
    });
    await this.store.setMeta(DEVICE_CODE, code);
    return code;
  }

  async logout(): Promise<void> {
    try {
      await this.api.send('/auth/logout', { method: 'POST' });
    } catch {
      // Offline: the refresh token expires on its own; this device forgets the user now.
    }
    this.token = null;
    await this.store.setMeta(USER, null);
    this.set({ status: 'signed_out', user: null, needsSignIn: false });
  }

  /** A valid access token, refreshed when close to expiry. */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - EXPIRY_MARGIN_MS > this.store.now().getTime()) {
      return this.token.value;
    }
    return this.refresh();
  }

  /** Rotates the refresh cookie. SignedOutError when the server refuses it. */
  refresh(): Promise<string> {
    const stale = this.token?.value;
    return withLock('fabric-auth-refresh', async () => {
      // Another call (or tab, for its own memory) may have refreshed while we waited.
      if (this.token && this.token.value !== stale) return this.token.value;
      const response = await this.api.send('/auth/refresh', { method: 'POST' });
      if (response.status === 401) {
        this.token = null;
        if (this.state.user) this.set({ ...this.state, needsSignIn: true });
        throw new SignedOutError('Session expired');
      }
      if (!response.ok) throw await apiErrorOf(response);
      const body = accessTokenResponseSchema.parse(await response.json());
      await this.accept(body);
      return body.accessToken;
    });
  }

  /** An authenticated API call: refreshes once on 401, then gives up with SignedOutError. */
  async request<S extends z.ZodType>(
    path: string,
    schema: S,
    init: { method?: string; body?: unknown } = {},
  ): Promise<z.output<S>> {
    let response = await this.api.send(path, { ...init, token: await this.accessToken() });
    if (response.status === 401) {
      this.token = null;
      response = await this.api.send(path, { ...init, token: await this.refresh() });
      if (response.status === 401) throw new SignedOutError('Session refused');
    }
    if (!response.ok) throw await apiErrorOf(response);
    return schema.parse(await response.json());
  }

  private async accept(body: AccessTokenResponse): Promise<void> {
    this.token = {
      value: body.accessToken,
      expiresAt: this.store.now().getTime() + body.expiresIn * 1000,
    };
    await this.store.setMeta(USER, body.user);
    this.set({ status: 'signed_in', user: body.user, needsSignIn: false });
  }

  private set(state: SessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
