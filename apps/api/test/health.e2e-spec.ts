import { errorResponseSchema, HEADERS } from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/app.js';

describe('public routes and shared HTTP behaviour', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /health is public', async () => {
    await t.http().get('/health').expect(200).expect({ status: 'ok' });
  });

  it('gives every response a request id, keeping a safe incoming one', async () => {
    const generated = await t.http().get('/health').expect(200);
    expect(generated.headers[HEADERS.requestId]).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await t.http().get('/health').set(HEADERS.requestId, 'till-42.abc').expect(200);
    expect(kept.headers[HEADERS.requestId]).toBe('till-42.abc');
    const replaced = await t
      .http()
      .get('/health')
      .set(HEADERS.requestId, 'bad id;drop')
      .expect(200);
    expect(replaced.headers[HEADERS.requestId]).not.toBe('bad id;drop');
  });

  it('answers an unknown route with the error shape', async () => {
    const response = await t.http().get('/nope').expect(404);
    const body = errorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBe(response.headers[HEADERS.requestId]);
  });

  it('answers malformed JSON with 400 bad_request', async () => {
    const response = await t
      .http()
      .post('/auth/login')
      .set('content-type', 'application/json')
      .send('{"username":')
      .expect(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('bad_request');
  });

  it('rejects a malformed device id header', async () => {
    const response = await t.http().get('/health').set(HEADERS.deviceId, 'no spaces!').expect(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('bad_request');
  });

  it('serves the OpenAPI docs at /docs, built from the zod contracts', async () => {
    await t.http().get('/docs').expect(200).expect('content-type', /html/);
    const response = await t.http().get('/docs/json').expect(200);
    const document = response.body as {
      paths: Record<
        string,
        Record<string, { requestBody?: unknown; responses: Record<string, unknown> }>
      >;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/auth/login',
        '/auth/refresh',
        '/settings',
        '/settings/{key}',
        '/audit',
      ]),
    );
    expect(document.paths['/auth/login']?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { type: 'object', required: ['username', 'password'] },
        },
      },
    });
    expect(document.paths['/settings']?.get?.responses.default).toBeDefined();
    expect(document.components.schemas.ErrorResponse).toMatchObject({ type: 'object' });
  });
});
