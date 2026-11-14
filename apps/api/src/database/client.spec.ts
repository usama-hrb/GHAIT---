import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_TIMEOUT_MS, createPool } from './client.js';

// Nothing here opens a connection: a pool only connects on its first query.
const URL = 'postgres://user:pass@localhost:5432/shop';

describe('createPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the pool a one-shop server has always had: 10 connections, no connect timeout', async () => {
    const pool = createPool(URL);
    expect(pool.options.max).toBe(10);
    expect(pool.options.connectionTimeoutMillis).toBeUndefined();
    await pool.end();
  });

  it('takes a size and a connect timeout, as the pools of multi-shop mode do', async () => {
    const pool = createPool(URL, { max: 3, connectTimeoutMs: CONNECT_TIMEOUT_MS });
    expect(pool.options.max).toBe(3);
    expect(pool.options.connectionTimeoutMillis).toBe(CONNECT_TIMEOUT_MS);
    await pool.end();
  });

  it('survives an error on an idle connection and logs it, instead of stopping the process', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPool(URL);
    // Without a listener, emit() throws an error event, which Node turns into a crash.
    expect(() => pool.emit('error', new Error('terminating connection'))).not.toThrow();
    expect(logged).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('terminating connection'));
    await pool.end();
  });

  it('never puts the connection string in what it logs', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPool(URL);
    pool.emit('error', new Error('connection reset'));
    expect(JSON.stringify(logged.mock.calls)).not.toContain('pass');
    await pool.end();
  });
});
