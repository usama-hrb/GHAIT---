import { randomUUID } from 'node:crypto';
import {
  errorResponseSchema,
  formatSetupCode,
  type OwnerRegistrationInput,
  registrationStatusSchema,
  SHOP_ISSUES,
} from '@fabric/contracts';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { parseConfig } from '../src/config/index.js';
import { issueShopCode, SETUP_CODE_MAX_FAILED_TRIES } from '../src/database/index.js';
import { LOOKUP_TTL_MS } from '../src/modules/shops/shop-lookup.js';
import {
  SETUP_CODE_ADDRESS_MAX_FAILED,
  SetupCodes,
} from '../src/modules/registration/setup-codes.service.js';
import { createTestApp, TEST_SETUP_CODE_SECRET } from './support/app.js';
import {
  createMultiShopApp,
  type MultiShopApp,
  setShopState,
  type ShopSpec,
} from './support/multi-shop-app.js';

/**
 * Registration with a setup code (ADR 0029, Step 6): on a server of many shops the first owner of a
 * shop that waits for its owner needs the code its operator made. Each test has a shop of its own,
 * so what one does to its shop's code never reaches another.
 */

const PASSWORD = 'correct horse battery staple';
const DAY_MS = 86_400_000;

const WAITING = [
  'status',
  'right',
  'sloppy',
  'wrong',
  'shapes',
  'old',
  'expiry',
  'used',
  'replaced',
  'other_a',
  'other_b',
  'lock',
  'nine',
  'addr',
  'window',
  'cross_a',
  'cross_b',
  'nocode',
  'suspend',
  'cache',
  'after',
  'marking',
  'race_1',
  'race_2',
  'race_3',
  'events',
] as const;

const hostOf = (slug: string) => `${slug.replaceAll('_', '-')}.codes.test`;

const SHOPS: ShopSpec[] = [
  ...WAITING.map((slug) => ({ slug, host: hostOf(slug) })),
  { slug: 'owned', host: hostOf('owned'), ownerPassword: PASSWORD },
];

let counter = 0;
/** A sign-up request; every call has an email of its own. */
function body(overrides: Partial<OwnerRegistrationInput> = {}): OwnerRegistrationInput {
  counter += 1;
  return {
    fullName: 'Amina Alaoui',
    email: `amina${String(counter)}@example.ma`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    shopName: 'Dar Al Qomash',
    shopLogo: null,
    sellingUnits: { piece: false, kg: true, meter: true },
    currency: 'dirham',
    ...overrides,
  };
}

const errorOf = (response: { body: unknown }) => errorResponseSchema.parse(response.body).error;
/** What a refused sign-up says, without the request id that differs for each request. */
const answerOf = (response: { status: number; body: unknown }) => {
  const { code, message, issues } = errorOf(response);
  return { status: response.status, code, message, issues };
};

let nextAddress = 0;
/** A client address that no earlier request used: the server trusts the proxy header of a loopback peer. */
const freshAddress = () => `203.0.113.${String(nextAddress++ % 250)}`;

describe('registration with a setup code', () => {
  let t: MultiShopApp;
  // Every spec that needs a code asks the operator's function for one, as `make shop-code` does.
  const newCode = async (slug: string, now?: Date) =>
    (await issueShopCode(t.config, { slug, actor: 'test' }, now)).code;
  const signUp = (
    slug: string,
    code: string | undefined,
    overrides = {},
    address = freshAddress(),
  ) =>
    t
      .at(hostOf(slug))
      .post('/auth/register')
      .set('X-Forwarded-For', address)
      .send({ ...body(overrides), ...(code === undefined ? {} : { setupCode: code }) });
  const owners = async (slug: string) =>
    Number(
      (
        await t.shops[slug]?.sql.query<{ n: string }>(
          `SELECT count(*) AS n FROM app_user WHERE role = 'owner' AND voided_at IS NULL`,
        )
      )?.rows[0]?.n,
    );
  const users = async (slug: string) =>
    Number(
      (await t.shops[slug]?.sql.query<{ n: string }>('SELECT count(*) AS n FROM app_user'))?.rows[0]
        ?.n,
    );
  const codeRows = async (slug: string) =>
    (
      await t.controlSql.query<{
        used_at: Date | null;
        revoked_at: Date | null;
        failed_tries: number;
      }>(
        `SELECT c.used_at, c.revoked_at, c.failed_tries FROM shop_setup_code c
         JOIN shop s ON s.id = c.shop_id WHERE s.slug = $1 ORDER BY c.created_at`,
        [slug],
      )
    ).rows;
  const eventsOf = async (slug: string) =>
    (
      await t.controlSql.query<{ action: string; detail: unknown }>(
        `SELECT e.action, e.detail FROM shop_event e JOIN shop s ON s.id = e.shop_id
         WHERE s.slug = $1 ORDER BY e.created_at, e.id`,
        [slug],
      )
    ).rows;
  /** The answer of a sign-up that is closed, from a shop that has its owner: the one every refusal gives. */
  let closed: ReturnType<typeof answerOf>;

  beforeAll(async () => {
    t = await createMultiShopApp(SHOPS, { env: { AUTH_REGISTER_RATE_LIMIT: '1000' } });
    const response = await t
      .at(hostOf('owned'))
      .post('/auth/register')
      .set('X-Forwarded-For', freshAddress())
      .send({ ...body(), setupCode: 'ABCD-EFGH-JKMN' });
    expect(response.status).toBe(403);
    closed = answerOf(response);
    expect(closed.code).toBe('forbidden');
    expect(closed.issues?.map((issue) => issue.code)).toEqual(['registration_closed']);
  });

  afterAll(async () => {
    await t.close();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('what the page is told', () => {
    it('says a shop that waits for its owner is open, and needs a setup code', async () => {
      const response = await t.at(hostOf('status')).get('/auth/registration').expect(200);
      expect(registrationStatusSchema.parse(response.body)).toEqual({
        open: true,
        shopId: t.shops.status?.id,
        setupCodeRequired: true,
      });
    });

    it('says nothing of a code once the shop has its owner', async () => {
      const response = await t.at(hostOf('owned')).get('/auth/registration').expect(200);
      expect(response.body).toEqual({ open: false, shopId: t.shops.owned?.id });
    });

    it('does not ask the control database for a code to answer: a shop with no code waiting is still "open"', async () => {
      // The operator did not make a code (or it ran out). The page still shows the field: whether a
      // code is waiting is the operator's business, and the answer must not say.
      const response = await t.at(hostOf('nocode')).get('/auth/registration').expect(200);
      expect(response.body).toMatchObject({ open: true, setupCodeRequired: true });
    });

    it('is the same on a one-shop server as it always was: no code, and no field', async () => {
      const one = await createTestApp({ shops: 'one', owner: false });
      try {
        const status = await one.http().get('/auth/registration').expect(200);
        expect(status.body).toEqual({ open: true });
        // A field the server does not use is not an error.
        await one
          .http()
          .post('/auth/register')
          .send({ ...body(), setupCode: 'whatever' })
          .expect(201);
      } finally {
        await one.close();
      }
    });
  });

  describe('the right code', () => {
    it('makes the owner, writes the audit entry and the settings, and marks the code used', async () => {
      const code = await newCode('right');
      const response = await signUp('right', code).expect(201);
      expect(response.body).toMatchObject({ user: { role: 'owner' }, shopId: t.shops.right?.id });
      expect(await owners('right')).toBe(1);
      const settings = await t.shops.right?.sql.query<{ key: string }>(
        `SELECT DISTINCT key FROM setting WHERE key IN
           ('shop_name', 'shop_logo', 'selling_units', 'money_display_unit') ORDER BY key`,
      );
      expect(settings?.rows.map((row) => row.key)).toEqual([
        'money_display_unit',
        'selling_units',
        'shop_name',
      ]);
      const audit = await t.shops.right?.sql.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit_log WHERE entity = 'app_user' AND action = 'create'`,
      );
      expect(Number(audit?.rows[0]?.n)).toBe(1);

      const [row, ...others] = await codeRows('right');
      expect(others).toEqual([]);
      expect(row?.used_at).toBeInstanceOf(Date);
      expect(row?.failed_tries).toBe(0);
      expect((await eventsOf('right')).map((event) => event.action)).toEqual([
        'shop.setup_code_made',
        'shop.setup_code_used',
      ]);
    });

    it('reads what a person types: case, spaces, hyphens and the look-alike letters do not matter', async () => {
      const code = await newCode('sloppy');
      // 0 and 1 may come as O, I and L; the code is shown as ABCD-EFGH-JKMN.
      const typed = formatSetupCode(code)
        .toLowerCase()
        .replaceAll('0', 'o')
        .replaceAll('1', 'l')
        .replaceAll('-', '  - ');
      await signUp('sloppy', ` ${typed} `).expect(201);
      expect(await owners('sloppy')).toBe(1);
    });

    it('is not kept anywhere: not the code, not what was typed', async () => {
      const code = await newCode('events');
      await signUp('events', formatSetupCode(code)).expect(201);
      const everything = JSON.stringify([
        (await t.controlSql.query('SELECT * FROM shop_setup_code')).rows,
        (await t.controlSql.query('SELECT * FROM shop_event')).rows,
        (await t.shops.events?.sql.query('SELECT * FROM audit_log'))?.rows,
      ]);
      expect(everything).not.toContain(code);
      expect(everything).not.toContain(formatSetupCode(code));
    });
  });

  describe('a code that does not open the sign-up', () => {
    it('a wrong one gets the answer of a closed sign-up, makes nothing and counts a try', async () => {
      const code = await newCode('wrong');
      const wrong = code.startsWith('A') ? 'B'.concat(code.slice(1)) : 'A'.concat(code.slice(1));
      const response = await signUp('wrong', wrong);
      expect(answerOf(response)).toEqual(closed);
      expect(await users('wrong')).toBe(0);
      expect((await codeRows('wrong'))[0]).toMatchObject({ used_at: null, failed_tries: 1 });
      // The right one still works.
      await signUp('wrong', code).expect(201);
    });

    it('gets the same answer whatever is wrong: no code, a bad shape, too long, an empty one', async () => {
      await newCode('shapes');
      const attempts = [
        undefined,
        '',
        'ABC',
        'ABCD-EFGH-JKMN-PQRS',
        'ABCD EFGH JKM!',
        'x'.repeat(64),
      ];
      for (const attempt of attempts) {
        expect(answerOf(await signUp('shapes', attempt))).toEqual(closed);
      }
      expect(await users('shapes')).toBe(0);
      // None of them could be a guess: the code that waits has not lost a try.
      expect((await codeRows('shapes'))[0]?.failed_tries).toBe(0);
    });

    it('an old one is refused the same way, and counts no try on any code', async () => {
      const code = await newCode('old', new Date(Date.now() - 8 * DAY_MS));
      expect(answerOf(await signUp('old', code))).toEqual(closed);
      expect(await users('old')).toBe(0);
      expect((await codeRows('old'))[0]?.failed_tries).toBe(0);
      // The operator makes a new one, and that works.
      await signUp('old', await newCode('old')).expect(201);
    });

    it('goes 7 days after it was made, to the second', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const code = await newCode('expiry');
      vi.setSystemTime(Date.now() + 7 * DAY_MS - 1000);
      // Just inside the 7 days the code still counts as waiting: a wrong try is counted on it.
      expect(answerOf(await signUp('expiry', 'ZZZZ-ZZZZ-ZZZZ'))).toEqual(closed);
      expect((await codeRows('expiry'))[0]?.failed_tries).toBe(1);
      vi.setSystemTime(Date.now() + 2000);
      expect(answerOf(await signUp('expiry', code))).toEqual(closed);
      expect(await users('expiry')).toBe(0);
      expect((await codeRows('expiry'))[0]?.failed_tries).toBe(1);
    });

    it('a used one is refused the same way, even when the shop is without an owner again', async () => {
      const code = await newCode('used');
      await signUp('used', code).expect(201);
      // The shop loses its owner (a voided account): the page opens again, with no code waiting.
      await t.shops.used?.sql.query(`UPDATE app_user SET voided_at = now() WHERE role = 'owner'`);
      const status = await t.at(hostOf('used')).get('/auth/registration').expect(200);
      expect(status.body).toMatchObject({ open: true, setupCodeRequired: true });
      expect(answerOf(await signUp('used', code))).toEqual(closed);
      expect(await owners('used')).toBe(0);
      // The operator makes a new code; the old one stays dead and the new one works once.
      const fresh = await newCode('used');
      expect(answerOf(await signUp('used', code))).toEqual(closed);
      await signUp('used', fresh).expect(201);
      expect(answerOf(await signUp('used', fresh))).toEqual(closed);
      expect((await codeRows('used')).map((row) => row.used_at !== null)).toEqual([true, true]);
    });

    it('one that the operator replaced is refused the same way', async () => {
      const first = await newCode('replaced');
      const second = await newCode('replaced');
      expect(answerOf(await signUp('replaced', first))).toEqual(closed);
      await signUp('replaced', second).expect(201);
      const rows = await codeRows('replaced');
      expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
      expect(rows[1]?.used_at).toBeInstanceOf(Date);
    });

    it('the code of another shop is refused, and counts a try on the shop it was tried on', async () => {
      const a = await newCode('other_a');
      await newCode('other_b');
      expect(answerOf(await signUp('other_b', a))).toEqual(closed);
      expect(await users('other_b')).toBe(0);
      expect((await codeRows('other_b'))[0]?.failed_tries).toBe(1);
      expect((await codeRows('other_a'))[0]?.failed_tries).toBe(0);
      await signUp('other_a', a).expect(201);
    });

    it('a shop that has no code at all refuses every try the same way', async () => {
      expect(answerOf(await signUp('nocode', 'ABCD-EFGH-JKMN'))).toEqual(closed);
      expect(await users('nocode')).toBe(0);
    });
  });

  describe('failed tries', () => {
    it(`a shop's waiting code is stopped after ${String(SETUP_CODE_MAX_FAILED_TRIES)} wrong tries, from any addresses`, async () => {
      const code = await newCode('lock');
      for (let n = 0; n < SETUP_CODE_MAX_FAILED_TRIES; n += 1) {
        // Each try is from an address of its own, so only the shop's own limit can stop it.
        expect(answerOf(await signUp('lock', 'ZZZZ-ZZZZ-ZZ' + String(n % 10) + 'Z'))).toEqual(
          closed,
        );
      }
      const [row] = await codeRows('lock');
      expect(row).toMatchObject({ failed_tries: SETUP_CODE_MAX_FAILED_TRIES, used_at: null });
      expect(row?.revoked_at).toBeInstanceOf(Date);
      // The right code does not open it now: the operator makes a new one.
      expect(answerOf(await signUp('lock', code))).toEqual(closed);
      expect(await users('lock')).toBe(0);
      const events = await eventsOf('lock');
      expect(events.map((event) => event.action)).toEqual([
        'shop.setup_code_made',
        'shop.setup_code_locked',
      ]);
      await signUp('lock', await newCode('lock')).expect(201);
    });

    it('one try short of the limit, the right code still opens the shop', async () => {
      const code = await newCode('nine');
      for (let n = 0; n < SETUP_CODE_MAX_FAILED_TRIES - 1; n += 1) {
        await signUp('nine', 'ZZZZ-ZZZZ-ZZZ' + String(n % 10));
      }
      expect((await codeRows('nine'))[0]).toMatchObject({
        failed_tries: SETUP_CODE_MAX_FAILED_TRIES - 1,
        revoked_at: null,
      });
      await signUp('nine', code).expect(201);
    });

    it(`an address is blocked after ${String(SETUP_CODE_ADDRESS_MAX_FAILED)} failed tries, even with the right code`, async () => {
      const code = await newCode('addr');
      const address = '198.51.100.7';
      for (let n = 0; n < SETUP_CODE_ADDRESS_MAX_FAILED; n += 1) {
        await signUp('addr', 'ZZZZ-ZZZZ-ZZZ' + String(n % 10), {}, address);
      }
      // It says "too many", and says nothing about whether the code was right.
      const blocked = await signUp('addr', code, {}, address);
      expect(blocked.status).toBe(429);
      expect(errorOf(blocked).code).toBe('too_many_requests');
      expect(await users('addr')).toBe(0);
    });

    it('is counted for each address, across shops, and not for the one that comes next', async () => {
      await newCode('cross_a');
      const code = await newCode('cross_b');
      const address = '198.51.100.8';
      // The address fails on two shops: the tries add up for the address.
      for (let n = 0; n < SETUP_CODE_ADDRESS_MAX_FAILED; n += 1) {
        await signUp(
          n % 2 === 0 ? 'cross_a' : 'cross_b',
          'ZZZZ-ZZZZ-ZZZ' + String(n % 10),
          {},
          address,
        );
      }
      expect((await signUp('cross_b', code, {}, address)).status).toBe(429);
      // Another address is not touched by it.
      await signUp('cross_b', code, {}, '198.51.100.9').expect(201);
    });

    it('a try with no code waiting counts for the address, and a blocked address can try again later', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const address = '198.51.100.10';
      for (let n = 0; n < SETUP_CODE_ADDRESS_MAX_FAILED; n += 1) {
        expect(answerOf(await signUp('window', 'ABCD-EFGH-JKMN', {}, address))).toEqual(closed);
      }
      expect((await signUp('window', 'ABCD-EFGH-JKMN', {}, address)).status).toBe(429);
      const code = await newCode('window');
      vi.setSystemTime(Date.now() + 14 * 60_000);
      expect((await signUp('window', code, {}, address)).status).toBe(429);
      vi.setSystemTime(Date.now() + 2 * 60_000);
      await signUp('window', code, {}, address).expect(201);
    });
  });

  describe('a shop that is switched off, and one that is closed to sign-ups', () => {
    it('answers 403 shop_suspended to the right code, makes nothing, and keeps the code', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const code = await newCode('suspend');
      await t.at(hostOf('suspend')).get('/auth/registration').expect(200);
      await setShopState(t, 'suspend', 'suspended');
      vi.setSystemTime(Date.now() + LOOKUP_TTL_MS + 1);
      const response = await signUp('suspend', code);
      expect(response.status).toBe(403);
      expect(errorOf(response).issues?.map((issue) => issue.code)).toEqual([SHOP_ISSUES.suspended]);
      expect(await users('suspend')).toBe(0);
      expect((await codeRows('suspend'))[0]).toMatchObject({ used_at: null, failed_tries: 0 });
      // Switched on again, the same code is good.
      await setShopState(t, 'suspend', 'active');
      vi.setSystemTime(Date.now() + LOOKUP_TTL_MS + 1);
      await signUp('suspend', code).expect(201);
    });

    it('does not open a shop that was switched off a moment ago, while the address is still remembered', async () => {
      const code = await newCode('cache');
      // The address is known to the server for 30 seconds: it still serves the shop.
      await t.at(hostOf('cache')).get('/auth/registration').expect(200);
      await setShopState(t, 'cache', 'suspended');
      expect(answerOf(await signUp('cache', code))).toEqual(closed);
      expect(await users('cache')).toBe(0);
      await setShopState(t, 'cache', 'active');
      expect((await codeRows('cache'))[0]?.used_at).toBeNull();
    });
  });

  describe('two sign-ups at once', () => {
    it.each(['race_1', 'race_2', 'race_3'])(
      '%s: one owner, one use of the code, one answer of a closed sign-up',
      async (slug) => {
        const code = await newCode(slug);
        const results = await Promise.all([
          signUp(slug, code),
          signUp(slug, code),
          signUp(slug, code),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual([201, 403, 403]);
        for (const lost of results.filter((result) => result.status === 403)) {
          expect(answerOf(lost)).toEqual(closed);
        }
        expect(await owners(slug)).toBe(1);
        expect(await users(slug)).toBe(1);
        const rows = await codeRows(slug);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.used_at).toBeInstanceOf(Date);
        expect(
          (await eventsOf(slug)).filter((event) => event.action === 'shop.setup_code_used'),
        ).toHaveLength(1);
      },
    );
  });

  describe('when a step fails', () => {
    it('after the check, the code is not used: an email that is taken is refused and the code stays good', async () => {
      const code = await newCode('after');
      await t.shops.after?.sql.query(
        `INSERT INTO app_user (username, display_name, password_hash, role, device_id)
         VALUES ('taken@example.ma', 'Someone', 'x', 'cashier', 'test')`,
      );
      const refused = await signUp('after', code, { email: 'taken@example.ma' });
      expect(refused.status).toBe(409);
      expect(await owners('after')).toBe(0);
      expect((await codeRows('after'))[0]).toMatchObject({ used_at: null, failed_tries: 0 });
      await signUp('after', code).expect(201);
    });

    it('when marking the code fails, no owner is made, and the same code works on the next try', async () => {
      const code = await newCode('marking');
      const codes = t.app.get(SetupCodes);
      const marking = vi
        .spyOn(codes, 'use')
        .mockRejectedValueOnce(new Error('the control database went away'));
      try {
        const failed = await signUp('marking', code);
        expect(failed.status).toBe(500);
        expect(marking).toHaveBeenCalledTimes(1);
        expect(await users('marking')).toBe(0);
        expect((await codeRows('marking'))[0]?.used_at).toBeNull();
        await signUp('marking', code).expect(201);
        expect(await owners('marking')).toBe(1);
      } finally {
        marking.mockRestore();
      }
    });
  });

  describe('the sign-up that the operator switched off', () => {
    it('stays closed for the holder of a code, and counts nothing', async () => {
      const off = await createMultiShopApp([{ slug: 'quiet', host: 'quiet.codes.test' }], {
        env: { OWNER_SIGNUP_ENABLED: 'false' },
      });
      try {
        const code = (await issueShopCode(off.config, { slug: 'quiet', actor: 'test' })).code;
        const status = await off.at('quiet.codes.test').get('/auth/registration').expect(200);
        expect(status.body).toEqual({ open: false, shopId: off.shops.quiet?.id });
        const response = await off
          .at('quiet.codes.test')
          .post('/auth/register')
          .send({ ...body(), setupCode: code });
        expect(answerOf(response)).toEqual(closed);
        const rows = await off.controlSql.query<{ used_at: Date | null; failed_tries: number }>(
          'SELECT used_at, failed_tries FROM shop_setup_code',
        );
        expect(rows.rows).toEqual([{ used_at: null, failed_tries: 0 }]);
        const users = await off.shops.quiet?.sql.query('SELECT 1 FROM app_user');
        expect(users?.rowCount).toBe(0);
      } finally {
        await off.close();
      }
    });
  });

  describe('the secret', () => {
    it('is needed to start: a server of many shops without it does not come up', async () => {
      const config = parseConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: `postgres://nobody@127.0.0.1:1/${randomUUID().replaceAll('-', '')}`,
        JWT_ACCESS_SECRET: 'integration-test-secret-0123456789abcdef',
        MULTI_SHOP: 'true',
        CONTROL_DATABASE_NAME: 'control_without_a_secret',
        SETUP_CODE_SECRET: '',
      });
      expect(config.multiShop?.setupCodeSecret).toBeUndefined();
      await expect(
        Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile(),
      ).rejects.toThrow(/SETUP_CODE_SECRET is not set/);
    });

    it('is the one the test server was given (a code made with another one opens nothing)', () => {
      expect(t.config.multiShop?.setupCodeSecret).toBe(TEST_SETUP_CODE_SECRET);
    });
  });
});
