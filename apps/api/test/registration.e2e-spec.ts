import {
  accessTokenResponseSchema,
  type AccessTokenResponse,
  errorResponseSchema,
  type OwnerRegistrationInput,
  REFRESH_COOKIE,
  REGISTRATION_ISSUES,
  registrationStatusSchema,
  settingListSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addPartnerLogin,
  createTestApp,
  OWNER,
  refreshCookieOf,
  type TestApp,
} from './support/app.js';

// A few bytes that start like a JPEG: the contract checks the shape, not the picture.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const LOGO = {
  contentType: 'image/jpeg',
  width: 64,
  height: 64,
  byteLength: JPEG_BYTES.length,
  data: JPEG_BYTES.toString('base64'),
} as const;

const PASSWORD = 'correct horse battery staple';

function request(overrides: Partial<OwnerRegistrationInput> = {}): OwnerRegistrationInput {
  return {
    fullName: 'Amina Alaoui',
    email: 'Amina@Example.MA',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    shopName: 'Dar Al Qomash',
    shopLogo: null,
    sellingUnits: { piece: false, kg: true, meter: true },
    currency: 'dirham',
    ...overrides,
  };
}

const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

async function counts(t: TestApp) {
  const { rows } = await t.sql.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM app_user) AS users,
            (SELECT count(*) FROM setting) AS settings,
            (SELECT count(*) FROM auth_session) AS sessions,
            (SELECT count(*) FROM audit_log) AS audits`,
  );
  const row = rows[0] ?? {};
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

// The first sign-up closes the page, so one fresh server is walked through in order.
describe('owner sign-up on a fresh server', () => {
  let t: TestApp;
  let accessToken = '';

  beforeAll(async () => {
    // The sign-up limit (5 a minute) would trip on the many attempts made here.
    t = await createTestApp({ owner: false, env: { AUTH_REGISTER_RATE_LIMIT: '50' } });
  });

  afterAll(async () => {
    await t.close();
  });

  it('is open while the server has no owner, and needs no sign-in to ask', async () => {
    const response = await t.http().get('/auth/registration').expect(200);
    expect(registrationStatusSchema.parse(response.body)).toEqual({ open: true });
  });

  it('refuses incomplete, malformed and weak requests, and writes nothing', async () => {
    const send = (body: object) => t.http().post('/auth/register').send(body);
    const pathsOf = (body: unknown) => errorOf(body).issues?.map((issue) => issue.path.join('.'));

    const empty = await send({}).expect(400);
    expect(errorOf(empty.body).code).toBe('validation_failed');
    expect(pathsOf(empty.body)).toEqual(
      expect.arrayContaining(['fullName', 'email', 'password', 'shopName', 'sellingUnits']),
    );

    const badEmail = await send(request({ email: 'not-an-email' })).expect(400);
    expect(pathsOf(badEmail.body)).toContain('email');

    const weak = await send(request({ password: 'short', confirmPassword: 'short' })).expect(400);
    expect(pathsOf(weak.body)).toContain('password');

    const mismatch = await send(request({ confirmPassword: `${PASSWORD}!` })).expect(400);
    expect(pathsOf(mismatch.body)).toContain('confirmPassword');

    const noShop = await send(request({ shopName: '   ' })).expect(400);
    expect(pathsOf(noShop.body)).toContain('shopName');

    const noUnits = await send(
      request({ sellingUnits: { piece: false, kg: false, meter: false } }),
    ).expect(400);
    expect(pathsOf(noUnits.body)?.some((path) => path.startsWith('sellingUnits'))).toBe(true);

    const badLogo = await send(
      request({ shopLogo: { ...LOGO, data: Buffer.from('not a jpeg!!').toString('base64') } }),
    ).expect(400);
    expect(pathsOf(badLogo.body)?.some((path) => path.startsWith('shopLogo'))).toBe(true);

    expect(await counts(t)).toEqual({ users: 0, settings: 0, sessions: 0, audits: 0 });
  });

  it('refuses an email an account already signs in with', async () => {
    await addPartnerLogin(t, { username: 'amina@example.ma', password: PASSWORD });
    const before = await counts(t);
    const response = await t.http().post('/auth/register').send(request()).expect(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'conflict',
      issues: [{ path: ['email'], code: REGISTRATION_ISSUES.emailTaken }],
    });
    expect(await counts(t)).toEqual(before);
    await t.sql.query(`UPDATE app_user SET username = 'taken-by-partner' WHERE role = 'partner'`);
  });

  it('rolls everything back when a later step fails: no account, no settings, no session', async () => {
    const before = await counts(t);
    await t.sql.query(`
      CREATE FUNCTION fail_selling_units() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
      CREATE TRIGGER fail_selling_units BEFORE INSERT ON setting
        FOR EACH ROW WHEN (NEW.key = 'selling_units') EXECUTE FUNCTION fail_selling_units();
    `);
    try {
      const failed = await t.http().post('/auth/register').send(request()).expect(500);
      expect(errorOf(failed.body).code).toBe('internal_error');
      expect(failed.headers['set-cookie']).toBeUndefined();
      // shop_name was written before the failing step; it must be gone with the account.
      expect(await counts(t)).toEqual(before);
    } finally {
      await t.sql.query(`DROP TRIGGER fail_selling_units ON setting`);
      await t.sql.query(`DROP FUNCTION fail_selling_units()`);
    }
  });

  it('creates the owner, the shop and a session in one request', async () => {
    const response = await t
      .http()
      .post('/auth/register')
      .set('x-device-id', 'desk-1')
      .send(request({ shopLogo: LOGO }))
      .expect(201);
    const body: AccessTokenResponse = accessTokenResponseSchema.parse(response.body);
    accessToken = body.accessToken;
    expect(body.user).toMatchObject({
      username: 'amina@example.ma',
      displayName: 'Amina Alaoui',
      role: 'owner',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2/);

    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${REFRESH_COOKIE}=`),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(refreshCookieOf(response)).toBeDefined();

    const me = await t.http().get('/auth/me').auth(accessToken, { type: 'bearer' }).expect(200);
    expect(me.body).toMatchObject({ role: 'owner', username: 'amina@example.ma' });
  });

  it('stores the shop as settings the owner can read back', async () => {
    const response = await t
      .http()
      .get('/settings')
      .auth(accessToken, { type: 'bearer' })
      .expect(200);
    const byKey = Object.fromEntries(
      settingListSchema.parse(response.body).map((setting) => [setting.key, setting]),
    );
    expect(byKey.shop_name).toMatchObject({ value: 'Dar Al Qomash', isDefault: false });
    expect(byKey.money_display_unit).toMatchObject({ value: 'dirham', isDefault: false });
    expect(byKey.selling_units).toMatchObject({
      value: { piece: false, kg: true, meter: true },
      isDefault: false,
    });
    expect(byKey.shop_logo).toMatchObject({ value: LOGO, isDefault: false });
  });

  it('hashes the password, makes the account the owner and audits everything', async () => {
    const { rows } = await t.sql.query<{ role: string; password_hash: string; username: string }>(
      `SELECT role, password_hash, username FROM app_user`,
    );
    expect(rows).toHaveLength(2); // the partner left over from the duplicate-email check, and the owner
    const owner = rows.find((row) => row.role === 'owner');
    expect(owner?.username).toBe('amina@example.ma');
    expect(owner?.password_hash).toMatch(/^\$argon2id\$/);
    expect(owner?.password_hash).not.toContain(PASSWORD);

    const { rows: audit } = await t.sql.query<{ entity: string; action: string; after: unknown }>(
      `SELECT entity, action, after FROM audit_log WHERE actor_id IS NOT NULL ORDER BY server_seq`,
    );
    const summary = audit.map((row) => `${row.entity}:${row.action}`);
    expect(summary).toEqual(
      expect.arrayContaining(['app_user:create', 'setting:create', 'app_user:login']),
    );
    expect(summary.filter((entry) => entry === 'setting:create')).toHaveLength(4);
    // The logo's bytes and the password hash stay out of the audit log.
    const text = JSON.stringify(audit);
    expect(text).not.toContain(LOGO.data);
    expect(text).not.toMatch(/argon2/);
  });

  it('signs in with the email afterwards, in any letter case, and not with a wrong password', async () => {
    await t
      .http()
      .post('/auth/login')
      .send({ username: ' AMINA@example.ma ', password: PASSWORD })
      .expect(200);
    await t
      .http()
      .post('/auth/login')
      .send({ username: 'amina@example.ma', password: 'not the password!!' })
      .expect(401);
  });

  it('closes once the owner exists: the status says so and a second sign-up is refused', async () => {
    const status = await t.http().get('/auth/registration').expect(200);
    expect(registrationStatusSchema.parse(status.body)).toEqual({ open: false });

    const before = await counts(t);
    const second = await t
      .http()
      .post('/auth/register')
      .send(request({ email: 'second@example.ma' }))
      .expect(403);
    expect(errorOf(second.body)).toMatchObject({
      code: 'forbidden',
      issues: [{ code: REGISTRATION_ISSUES.registrationClosed }],
    });
    expect(second.headers['set-cookie']).toBeUndefined();
    expect(await counts(t)).toEqual(before);

    const { rows } = await t.sql.query<{ owners: string }>(
      `SELECT count(*) AS owners FROM app_user WHERE role = 'owner'`,
    );
    expect(Number(rows[0]?.owners)).toBe(1);
  });

  it('lets the owner change the units afterwards, any of the seven combinations but none', async () => {
    const put = (value: unknown) =>
      t.http().put('/settings/selling_units').auth(accessToken, { type: 'bearer' }).send({ value });
    const combinations = [
      { piece: true, kg: false, meter: false },
      { piece: false, kg: true, meter: false },
      { piece: false, kg: false, meter: true },
      { piece: true, kg: true, meter: false },
      { piece: true, kg: false, meter: true },
      { piece: false, kg: true, meter: true },
      { piece: true, kg: true, meter: true },
    ];
    for (const value of combinations) {
      const saved = await put(value).expect(200);
      expect(saved.body).toMatchObject({ key: 'selling_units', value });
    }
    const refused = await put({ piece: false, kg: false, meter: false }).expect(400);
    expect(errorOf(refused.body).code).toBe('validation_failed');
  });
});

describe('two sign-ups at the same moment', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ owner: false, env: { AUTH_REGISTER_RATE_LIMIT: '50' } });
  });

  afterAll(async () => {
    await t.close();
  });

  it('create one owner: the other is told the page is closed', async () => {
    const responses = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        t
          .http()
          .post('/auth/register')
          .send(request({ email: `owner${n}@example.ma` })),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 403, 403, 403]);

    const { rows } = await t.sql.query<{ owners: string; sessions: string }>(
      `SELECT (SELECT count(*) FROM app_user WHERE role = 'owner') AS owners,
              (SELECT count(*) FROM auth_session) AS sessions`,
    );
    expect(rows[0]).toMatchObject({ owners: '1', sessions: '1' });
  });
});

describe('a client choosing its own role', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ owner: false });
  });

  afterAll(async () => {
    await t.close();
  });

  it('is ignored: the server makes the account the owner and takes no shop id', async () => {
    const response = await t
      .http()
      .post('/auth/register')
      .send({ ...request(), role: 'cashier', shopId: 'another-shop', isOwner: false })
      .expect(201);
    expect(accessTokenResponseSchema.parse(response.body).user.role).toBe('owner');
    const { rows } = await t.sql.query<{ role: string }>(`SELECT role FROM app_user`);
    expect(rows).toEqual([{ role: 'owner' }]);
  });
});

describe('the operator turned the sign-up off', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ owner: false, env: { OWNER_SIGNUP_ENABLED: 'false' } });
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports closed and refuses, although no owner exists', async () => {
    const status = await t.http().get('/auth/registration').expect(200);
    expect(registrationStatusSchema.parse(status.body)).toEqual({ open: false });
    const response = await t.http().post('/auth/register').send(request()).expect(403);
    expect(errorOf(response.body).issues?.[0]?.code).toBe(REGISTRATION_ISSUES.registrationClosed);
    expect(await counts(t)).toEqual({ users: 0, settings: 0, sessions: 0, audits: 0 });
  });
});

describe('a server set up with `make owner`', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { AUTH_REGISTER_RATE_LIMIT: '2' } });
  });

  afterAll(async () => {
    await t.close();
  });

  it('never opens the sign-up, and its owner signs in as before', async () => {
    const status = await t.http().get('/auth/registration').expect(200);
    expect(registrationStatusSchema.parse(status.body)).toEqual({ open: false });

    const before = await counts(t);
    await t.http().post('/auth/register').send(request()).expect(403);
    expect(await counts(t)).toEqual(before);

    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: OWNER.username, password: OWNER.password })
      .expect(200);
    expect(accessTokenResponseSchema.parse(login.body).user.role).toBe('owner');
  });

  it('limits sign-up attempts by AUTH_REGISTER_RATE_LIMIT, on a counter of its own', async () => {
    // One attempt was used above; a second is allowed, the third is not.
    await t.http().post('/auth/register').send(request()).expect(403);
    const blocked = await t.http().post('/auth/register').send(request()).expect(429);
    expect(errorOf(blocked.body).code).toBe('too_many_requests');
    // Logging in still has its own allowance.
    await t.login();
  });
});
