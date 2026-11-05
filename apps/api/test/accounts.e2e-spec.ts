import {
  ACCOUNT_ISSUES,
  accessTokenResponseSchema,
  accountCredentialSchema,
  accountSchema,
  errorResponseSchema,
  HEADERS,
  syncPullResponseSchema,
  TEMPORARY_PASSWORD_ALPHABET,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

/**
 * Login accounts the owner manages (ADR 0024): unlimited cashiers, a partner login only for an
 * existing partner and only one active at a time, deactivation that ends access at once without
 * touching a business record, and what each role can reach.
 */

const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;
const issuesOf = (body: unknown) => errorOf(body).issues?.map((issue) => issue.code) ?? [];
const TEMPORARY_PASSWORD = new RegExp(
  `^[${TEMPORARY_PASSWORD_ALPHABET}]{4}(-[${TEMPORARY_PASSWORD_ALPHABET}]{4}){3}$`,
);
const CHOSEN_PASSWORD = 'a password the person chose themselves';

type Verb = 'get' | 'post' | 'put';

describe('account management (ADR 0024)', () => {
  let t: TestApp;
  let owner: Session;
  const ownerPartner = crypto.randomUUID();
  const ali = crypto.randomUUID();
  const bilal = crypto.randomUUID();
  const leaver = crypto.randomUUID();
  let counter = 0;

  beforeAll(async () => {
    // Many sign-ins in one file: the per-minute limit is not what is under test here.
    t = await createTestApp({
      env: { AUTH_LOGIN_RATE_LIMIT: '1000', AUTH_REFRESH_RATE_LIMIT: '1000' },
    });
    owner = await t.login();
    await call('put', `/partners/${ownerPartner}`, {
      name: 'المالك',
      ownershipBp: 5000,
      isOwner: true,
    }).expect(200);
    await call('put', `/partners/${ali}`, {
      name: 'علي',
      ownershipBp: 2500,
      isOwner: false,
      phone: '0600000001',
      notes: 'ali private note',
    });
    await call('put', `/partners/${bilal}`, {
      name: 'بلال',
      ownershipBp: 2500,
      isOwner: false,
      phone: '0600000002',
      notes: 'bilal private note',
    });
    await call('put', `/partners/${leaver}`, { name: 'الراحل', ownershipBp: 0, isOwner: false });
    await t.sql.query(`UPDATE partner SET exited_on = '2026-09-30' WHERE id = $1`, [leaver]);
    await call('put', `/capital-moves/${crypto.randomUUID()}`, {
      partnerId: ali,
      kind: 'contribution',
      amountCents: 5_000_000,
      date: '2026-10-01',
    });
    await call('put', `/capital-moves/${crypto.randomUUID()}`, {
      partnerId: bilal,
      kind: 'contribution',
      amountCents: 3_000_000,
      date: '2026-10-01',
    });
  });

  afterAll(async () => {
    await t.close();
  });

  /** One request, built and sent in one go (requests in flight share the app's server). */
  function call(verb: Verb, path: string, body?: unknown, token = owner.accessToken) {
    const started = t.http()[verb](path);
    const request = started.auth(token, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
    return body === undefined ? request : request.send(body as object);
  }

  const nextUsername = (prefix: string) => `${prefix}-${++counter}`;

  /** A partner with no account, made for the test that needs one. */
  async function freePartner(): Promise<string> {
    const id = crypto.randomUUID();
    await call('put', `/partners/${id}`, {
      name: `شريك ${id.slice(0, 4)}`,
      ownershipBp: 0,
      isOwner: false,
    }).expect(200);
    return id;
  }

  async function count(table: string, where = 'true'): Promise<number> {
    const { rows } = await t.sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
    );
    return Number(rows[0]?.n);
  }

  async function createCashier(username = nextUsername('cashier')) {
    const response = await call('post', '/accounts/cashiers', {
      username,
      displayName: `Cashier ${username}`,
    }).expect(201);
    return accountCredentialSchema.parse(response.body);
  }

  async function createPartnerAccount(partnerId: string, username = nextUsername('partner')) {
    const response = await call('post', '/accounts/partners', {
      username,
      displayName: `Partner ${username}`,
      partnerId,
    }).expect(201);
    return accountCredentialSchema.parse(response.body);
  }

  async function signIn(username: string, password: string) {
    const response = await t.http().post('/auth/login').send({ username, password }).expect(200);
    const { accessToken, user } = accessTokenResponseSchema.parse(response.body);
    const cookie = (response.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(
      ';',
    )[0];
    return { accessToken, user, refreshCookie: cookie ?? '' };
  }

  /** An account that has chosen its own password, ready to use. */
  async function ready(credential: { account: { username: string }; temporaryPassword: string }) {
    const first = await signIn(credential.account.username, credential.temporaryPassword);
    await call(
      'post',
      '/auth/change-password',
      {
        currentPassword: credential.temporaryPassword,
        newPassword: CHOSEN_PASSWORD,
        confirmPassword: CHOSEN_PASSWORD,
      },
      first.accessToken,
    ).expect(200);
    return signIn(credential.account.username, CHOSEN_PASSWORD);
  }

  describe('cashier accounts', () => {
    it('can be made without a limit, each with its own login, and make nothing else', async () => {
      const partners = await count('partner');
      const employees = await count('employee');
      const made = [];
      for (let n = 0; n < 30; n++) made.push(await createCashier());

      for (const { account, temporaryPassword } of made) {
        expect(account).toMatchObject({
          role: 'cashier',
          status: 'active',
          partner: null,
          mustChangePassword: true,
          deactivatedAt: null,
        });
        expect(temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      }
      expect(new Set(made.map(({ temporaryPassword }) => temporaryPassword)).size).toBe(30);

      const listed = await call('get', '/accounts?role=cashier').expect(200);
      expect(accountSchema.array().parse(listed.body)).toHaveLength(30);
      expect(await count('partner')).toBe(partners);
      expect(await count('employee')).toBe(employees);

      const first = made[0];
      if (!first) throw new Error('no account made');
      const session = await signIn(first.account.username, first.temporaryPassword);
      expect(session.user).toMatchObject({ role: 'cashier', mustChangePassword: true });
    });

    it('keeps the password only as an argon2id hash, in no table and no audit entry', async () => {
      const { account, temporaryPassword } = await createCashier();
      const { rows } = await t.sql.query<{ password_hash: string }>(
        `SELECT password_hash FROM app_user WHERE id = $1`,
        [account.id],
      );
      expect(rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
      const audit = await t.sql.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit_log
          WHERE before::text LIKE '%' || $1 || '%' OR after::text LIKE '%' || $1 || '%'
             OR before::text LIKE '%argon2%' OR after::text LIKE '%argon2%'`,
        [temporaryPassword],
      );
      expect(Number(audit.rows[0]?.n)).toBe(0);
    });

    it('needs a username nobody has, whatever its case', async () => {
      const { account } = await createCashier('Front-Desk');
      expect(account.username).toBe('front-desk');
      const again = await call('post', '/accounts/cashiers', {
        username: 'FRONT-DESK',
        displayName: 'Someone else',
      }).expect(409);
      expect(errorOf(again.body).code).toBe('conflict');
      expect(issuesOf(again.body)).toEqual([ACCOUNT_ISSUES.usernameTaken]);
      const owners = await call('post', '/accounts/cashiers', {
        username: 'owner',
        displayName: 'Someone else',
      }).expect(409);
      expect(issuesOf(owners.body)).toEqual([ACCOUNT_ISSUES.usernameTaken]);
    });
  });

  describe('what a request can carry', () => {
    it('refuses a role, a partner on a cashier, and any field the form does not have', async () => {
      const users = await count('app_user');
      const body = { username: nextUsername('sneaky'), displayName: 'Sneaky' };
      await call('post', '/accounts/cashiers', { ...body, role: 'owner' }).expect(400);
      await call('post', '/accounts/cashiers', { ...body, partnerId: ali }).expect(400);
      await call('post', '/accounts/cashiers', { ...body, mustChangePassword: false }).expect(400);
      await call('post', '/accounts/partners', { ...body, partnerId: ali, role: 'owner' }).expect(
        400,
      );
      await call('post', '/accounts/partners', {
        ...body,
        partnerId: ali,
        password: 'x'.repeat(14),
      }).expect(400);
      await call('post', '/accounts/partners', body).expect(400);
      expect(await count('app_user')).toBe(users);
    });
  });

  describe('partner accounts', () => {
    it('offer only partners who exist, are in the shop, are not the owner and have no active account', async () => {
      const eligible = await call('get', '/accounts/eligible-partners').expect(200);
      const names = (eligible.body as { id: string; name: string }[]).map(({ id }) => id).sort();
      expect(names).toEqual([ali, bilal].sort());
    });

    it('refuse the owner, a partner who left and a partner who does not exist', async () => {
      const users = await count('app_user');
      const post = (partnerId: string) =>
        call('post', '/accounts/partners', {
          username: nextUsername('nope'),
          displayName: 'Nope',
          partnerId,
        });
      expect(issuesOf((await post(ownerPartner).expect(400)).body)).toEqual([
        ACCOUNT_ISSUES.partnerIsOwner,
      ]);
      expect(issuesOf((await post(leaver).expect(400)).body)).toEqual([
        ACCOUNT_ISSUES.partnerExited,
      ]);
      expect(issuesOf((await post(crypto.randomUUID()).expect(400)).body)).toEqual([
        ACCOUNT_ISSUES.partnerNotFound,
      ]);
      expect(await count('app_user')).toBe(users);
    });

    it('link to the exact partner, create no partner, and leave the offer to those still without one', async () => {
      const partners = await count('partner');
      const { account } = await createPartnerAccount(ali);
      expect(account).toMatchObject({
        role: 'partner',
        status: 'active',
        mustChangePassword: true,
        partner: { id: ali, name: 'علي', exitedOn: null },
      });
      expect(await count('partner')).toBe(partners);
      const eligible = await call('get', '/accounts/eligible-partners').expect(200);
      expect((eligible.body as { id: string }[]).map(({ id }) => id)).toEqual([bilal]);

      const second = await call('post', '/accounts/partners', {
        username: nextUsername('partner'),
        displayName: 'Second',
        partnerId: ali,
      }).expect(409);
      expect(issuesOf(second.body)).toEqual([ACCOUNT_ISSUES.partnerHasAccount]);
    });

    it('allow one active account per partner even when the requests arrive together', async () => {
      const responses = await Promise.all(
        [1, 2, 3, 4, 5].map((n) =>
          t
            .http()
            .post('/accounts/partners')
            .auth(owner.accessToken, { type: 'bearer' })
            .set(HEADERS.deviceId, 'desk')
            .send({ username: `race-${n}`, displayName: `Race ${n}`, partnerId: bilal }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409, 409, 409, 409,
      ]);
      expect(await count('app_user', `partner_id = '${bilal}' AND deactivated_at IS NULL`)).toBe(1);
    });

    it('are refused by the database itself when a second active one is forced in, or a role is mixed up', async () => {
      const insert = (role: string, partnerId: string | null) =>
        t.sql.query(
          `INSERT INTO app_user (username, display_name, password_hash, role, partner_id, device_id)
           VALUES ($1, 'x', 'x', $2, $3, 'test')`,
          [nextUsername('sql'), role, partnerId],
        );
      await expect(insert('partner', ali)).rejects.toMatchObject({
        constraint: 'app_user_one_active_partner_account',
      });
      await expect(insert('cashier', ali)).rejects.toMatchObject({
        constraint: 'app_user_partner_link_role',
      });
      await expect(insert('partner', null)).rejects.toMatchObject({
        constraint: 'app_user_active_partner_linked',
      });
    });

    it('list the partner each belongs to, and filter by type and status', async () => {
      const partnerAccounts = accountSchema
        .array()
        .parse((await call('get', '/accounts?role=partner').expect(200)).body);
      expect(partnerAccounts.every((account) => account.role === 'partner')).toBe(true);
      expect(partnerAccounts.map((account) => account.partner?.id).sort()).toEqual(
        [ali, bilal].sort(),
      );
      const inactive = accountSchema
        .array()
        .parse((await call('get', '/accounts?status=inactive').expect(200)).body);
      expect(inactive.every((account) => account.status === 'inactive')).toBe(true);
      const everyone = accountSchema
        .array()
        .parse((await call('get', '/accounts').expect(200)).body);
      expect(everyone.some((account) => account.role === 'owner')).toBe(true);
      await call('get', '/accounts?role=king').expect(400);
    });
  });

  describe('deactivation', () => {
    it('ends sign-in, refresh and tokens already issued, and removes nothing the shop holds', async () => {
      const credential = await createCashier();
      const session = await ready(credential);
      await call('get', '/auth/me', undefined, session.accessToken).expect(200);

      await call('post', `/accounts/${credential.account.id}/deactivate`, {}).expect(400);
      const deactivated = accountSchema.parse(
        (
          await call('post', `/accounts/${credential.account.id}/deactivate`, {
            reason: 'left the shop',
          }).expect(200)
        ).body,
      );
      expect(deactivated).toMatchObject({ status: 'inactive' });
      expect(deactivated.deactivatedAt).not.toBeNull();

      // The access token, 15 minutes long, stops working now; so does the refresh token.
      await call('get', '/auth/me', undefined, session.accessToken).expect(401);
      await t.http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(401);
      // The right password is told the account is switched off; a wrong one learns nothing.
      const refused = await t
        .http()
        .post('/auth/login')
        .send({ username: credential.account.username, password: CHOSEN_PASSWORD })
        .expect(403);
      expect(issuesOf(refused.body)).toEqual([ACCOUNT_ISSUES.deactivated]);
      const wrong = await t
        .http()
        .post('/auth/login')
        .send({ username: credential.account.username, password: 'not the password' })
        .expect(401);
      expect(errorOf(wrong.body).code).toBe('invalid_credentials');

      // The record stays: switched off, not removed.
      expect(await count('app_user', `id = '${credential.account.id}' AND voided_at IS NULL`)).toBe(
        1,
      );
      await call('post', `/accounts/${credential.account.id}/deactivate`, {
        reason: 'again',
      }).expect(409);
    });

    it("leaves the partner, their capital, draws and balance as they were, and frees the partner's place", async () => {
      const bilalsAccount = (await call('get', '/accounts?role=partner').expect(200)).body as {
        id: string;
        partner: { id: string };
      }[];
      const target = bilalsAccount.find((account) => account.partner.id === bilal);
      if (!target) throw new Error('bilal has no account');
      const accountOf = async () =>
        (await call('get', `/partners/${bilal}/account`).expect(200)).body as { account: unknown };
      const before = await accountOf();
      const partners = await count('partner');
      const moves = await count('capital_move');

      await call('post', `/accounts/${target.id}/deactivate`, {
        reason: 'no longer needs access',
      }).expect(200);

      expect(await accountOf()).toEqual(before);
      expect(await count('partner')).toBe(partners);
      expect(await count('capital_move')).toBe(moves);
      expect(await count('partner', `id = '${bilal}' AND voided_at IS NULL`)).toBe(1);
      const eligible = await call('get', '/accounts/eligible-partners').expect(200);
      expect((eligible.body as { id: string }[]).map(({ id }) => id)).toEqual([bilal]);
    });

    it('is undone by reactivating, which issues a new temporary password; the old password is dead', async () => {
      const credential = await createCashier();
      const session = await ready(credential);
      await call('post', `/accounts/${credential.account.id}/deactivate`, {
        reason: 'holiday',
      }).expect(200);
      const back = accountCredentialSchema.parse(
        (
          await call('post', `/accounts/${credential.account.id}/reactivate`, {
            reason: 'back',
          }).expect(200)
        ).body,
      );
      expect(back.account).toMatchObject({
        status: 'active',
        mustChangePassword: true,
        deactivatedAt: null,
      });
      expect(back.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      await t
        .http()
        .post('/auth/login')
        .send({ username: credential.account.username, password: CHOSEN_PASSWORD })
        .expect(401);
      await signIn(credential.account.username, back.temporaryPassword);
      // What was issued before the switch-off stays dead.
      await call('get', '/auth/me', undefined, session.accessToken).expect(401);
      await call('post', `/accounts/${credential.account.id}/reactivate`, {}).expect(409);
    });

    it("does not bring a partner's old login back beside a newer one", async () => {
      const partnerId = await freePartner();
      const first = await createPartnerAccount(partnerId);
      await call('post', `/accounts/${first.account.id}/deactivate`, {
        reason: 'lost the phone',
      }).expect(200);
      await createPartnerAccount(partnerId);
      const refused = await call('post', `/accounts/${first.account.id}/reactivate`, {}).expect(
        409,
      );
      expect(issuesOf(refused.body)).toEqual([ACCOUNT_ISSUES.partnerHasAccount]);
    });

    it('is not offered for the owner, and an unknown account is not found', async () => {
      const everyone = accountSchema
        .array()
        .parse((await call('get', '/accounts').expect(200)).body);
      const mine = everyone.find((account) => account.role === 'owner');
      if (!mine) throw new Error('no owner');
      for (const action of ['deactivate', 'reactivate', 'reset-credentials']) {
        const refused = await call('post', `/accounts/${mine.id}/${action}`, {
          reason: 'x',
        }).expect(403);
        expect(issuesOf(refused.body)).toEqual([ACCOUNT_ISSUES.ownerAccount]);
      }
      await call('post', `/accounts/${crypto.randomUUID()}/deactivate`, { reason: 'x' }).expect(
        404,
      );
      // The owner can still sign in.
      await t.login();
    });
  });

  describe('credentials', () => {
    it('are reset into a new temporary password, signing the account out everywhere', async () => {
      const credential = await createCashier();
      const session = await ready(credential);
      const reset = accountCredentialSchema.parse(
        (await call('post', `/accounts/${credential.account.id}/reset-credentials`, {}).expect(200))
          .body,
      );
      expect(reset.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      expect(reset.account.mustChangePassword).toBe(true);
      await call('get', '/auth/me', undefined, session.accessToken).expect(401);
      await t.http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(401);
      await t
        .http()
        .post('/auth/login')
        .send({ username: credential.account.username, password: CHOSEN_PASSWORD })
        .expect(401);
      await signIn(credential.account.username, reset.temporaryPassword);
    });

    it('cannot be reset on an account that is switched off', async () => {
      const credential = await createCashier();
      await call('post', `/accounts/${credential.account.id}/deactivate`, { reason: 'x' }).expect(
        200,
      );
      const refused = await call(
        'post',
        `/accounts/${credential.account.id}/reset-credentials`,
        {},
      ).expect(409);
      expect(issuesOf(refused.body)).toEqual([ACCOUNT_ISSUES.inactive]);
    });

    it('must be replaced by the account itself before anything else is reachable', async () => {
      const credential = await createCashier();
      const session = await signIn(credential.account.username, credential.temporaryPassword);
      const gated = await call('get', '/sync/pull?since=0', undefined, session.accessToken).expect(
        403,
      );
      expect(issuesOf(gated.body)).toEqual([ACCOUNT_ISSUES.passwordChangeRequired]);
      await call('get', '/auth/me', undefined, session.accessToken).expect(200);

      const change = (current: string, next: string, confirm = next) =>
        call(
          'post',
          '/auth/change-password',
          {
            currentPassword: current,
            newPassword: next,
            confirmPassword: confirm,
          },
          session.accessToken,
        );
      const wrong = await change('not the temporary one', CHOSEN_PASSWORD).expect(400);
      expect(issuesOf(wrong.body)).toEqual([ACCOUNT_ISSUES.wrongPassword]);
      await change(credential.temporaryPassword, CHOSEN_PASSWORD, 'does not match').expect(400);
      await change(credential.temporaryPassword, 'short').expect(400);
      const same = await change(credential.temporaryPassword, credential.temporaryPassword).expect(
        400,
      );
      expect(issuesOf(same.body)).toEqual([ACCOUNT_ISSUES.passwordUnchanged]);

      // A second sign-in with the temporary password is signed out by the change; this one stays.
      const other = await signIn(credential.account.username, credential.temporaryPassword);
      const changed = await change(credential.temporaryPassword, CHOSEN_PASSWORD).expect(200);
      expect((changed.body as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
      await call('get', '/sync/pull?since=0', undefined, session.accessToken).expect(200);
      await call('get', '/auth/me', undefined, other.accessToken).expect(401);
      await t.http().post('/auth/refresh').set('cookie', other.refreshCookie).expect(401);
      await t
        .http()
        .post('/auth/login')
        .send({ username: credential.account.username, password: credential.temporaryPassword })
        .expect(401);
    });
  });

  describe('what each role can reach', () => {
    let cashier: Awaited<ReturnType<typeof ready>>;
    let aliSession: Awaited<ReturnType<typeof ready>>;

    beforeAll(async () => {
      cashier = await ready(await createCashier());
      const aliAccounts = accountSchema
        .array()
        .parse((await call('get', '/accounts?role=partner&status=active').expect(200)).body);
      const aliLogin = aliAccounts.find((account) => account.partner?.id === ali);
      if (!aliLogin) throw new Error('ali has no active account');
      const reset = accountCredentialSchema.parse(
        (await call('post', `/accounts/${aliLogin.id}/reset-credentials`, {}).expect(200)).body,
      );
      aliSession = await ready(reset);
    });

    it('keeps account management for the owner: a cashier and a partner are refused everything', async () => {
      const someone = crypto.randomUUID();
      const routes: [Verb, string, unknown][] = [
        ['get', '/accounts', undefined],
        ['get', '/accounts/eligible-partners', undefined],
        ['post', '/accounts/cashiers', { username: 'sneak-in', displayName: 'Sneak In' }],
        [
          'post',
          '/accounts/partners',
          { username: 'sneak-in', displayName: 'Sneak In', partnerId: ali },
        ],
        ['post', `/accounts/${someone}/deactivate`, { reason: 'x' }],
        ['post', `/accounts/${someone}/reactivate`, {}],
        ['post', `/accounts/${someone}/reset-credentials`, {}],
      ];
      for (const session of [cashier, aliSession]) {
        for (const [verb, path, body] of routes) {
          const refused = await call(verb, path, body, session.accessToken).expect(403);
          expect(errorOf(refused.body).code).toBe('forbidden');
        }
      }
      expect(await count('app_user', `username = 'sneak-in'`)).toBe(0);
    });

    it("closes the routes that hold every partner's money to a partner and to a cashier", async () => {
      const closed: [Verb, string][] = [
        ['get', '/audit'],
        ['get', '/audit/actors'],
        ['get', '/partners'],
        ['get', '/settlements/preview'],
        ['get', `/settlements/${crypto.randomUUID()}`],
        ['get', `/zakat/reports/${crypto.randomUUID()}`],
        ['get', '/integrity'],
        ['get', `/partners/${bilal}/account`],
      ];
      for (const [verb, path] of closed) {
        await call(verb, path, undefined, aliSession.accessToken).expect(403);
      }
      await call('get', '/audit', undefined, cashier.accessToken).expect(403);
      await call('get', '/partners', undefined, cashier.accessToken).expect(403);
      // Their own partner account, and the shop's own numbers, a partner still reads.
      await call('get', `/partners/${ali}/account`, undefined, aliSession.accessToken).expect(200);
      await call('get', '/settings', undefined, aliSession.accessToken).expect(200);
      // And changes nothing.
      await call(
        'put',
        `/partners/${ali}`,
        { name: 'علي', ownershipBp: 9000, isOwner: false },
        aliSession.accessToken,
      ).expect(403);
    });

    it("sends a partner's device its own money and the shop's, not another partner's or their contact details", async () => {
      const pull = async (token: string) =>
        syncPullResponseSchema.parse(
          (await call('get', '/sync/pull?since=0&limit=500', undefined, token).expect(200)).body,
        );
      const ownerView = await pull(owner.accessToken);
      expect(
        ownerView.changes
          .filter((change) => change.entity === 'capital_move')
          .map((c) => (c.record as { partnerId: string }).partnerId)
          .sort(),
      ).toEqual([ali, bilal].sort());

      const view = await pull(aliSession.accessToken);
      const moves = view.changes.filter((change) => change.entity === 'capital_move');
      expect(moves.map((change) => (change.record as { partnerId: string }).partnerId)).toEqual([
        ali,
      ]);
      const partners = Object.fromEntries(
        view.changes
          .filter((change) => change.entity === 'partner')
          .map((change) => [
            (change.record as { id: string }).id,
            change.record as Record<string, unknown>,
          ]),
      );
      // The shop's structure (names, shares) stays; another partner's contact details do not.
      expect(partners[bilal]).toMatchObject({
        name: 'بلال',
        ownershipBp: 2500,
        phone: null,
        notes: null,
      });
      expect(partners[ali]).toMatchObject({ phone: '0600000001', notes: 'ali private note' });
    });

    it('lets a cashier reach only what the till needs', async () => {
      const pulled = syncPullResponseSchema.parse(
        (
          await call('get', '/sync/pull?since=0&limit=500', undefined, cashier.accessToken).expect(
            200,
          )
        ).body,
      );
      const entities = new Set(pulled.changes.map((change) => change.entity));
      for (const hidden of ['partner', 'capital_move', 'settlement', 'employee', 'expense']) {
        expect(entities.has(hidden as never)).toBe(false);
      }
      await call('get', '/settings', undefined, cashier.accessToken).expect(403);
    });
  });

  describe('partners and their logins', () => {
    it('cannot remove a partner while the partner has an active login; switching it off allows it', async () => {
      const id = crypto.randomUUID();
      await call('put', `/partners/${id}`, { name: 'مؤقت', ownershipBp: 0, isOwner: false }).expect(
        200,
      );
      const { account } = await createPartnerAccount(id);
      const refused = await call('post', `/partners/${id}/void`, { reason: 'duplicate entry' });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(issuesOf(refused.body)).toContain(ACCOUNT_ISSUES.partnerHasLogin);
      expect(await count('partner', `id = '${id}' AND voided_at IS NULL`)).toBe(1);

      await call('post', `/accounts/${account.id}/deactivate`, {
        reason: 'before removing the partner',
      }).expect(200);
      await call('post', `/partners/${id}/void`, { reason: 'duplicate entry' }).expect(200);
    });
  });

  describe('the audit log', () => {
    it('keeps who made, switched off, switched on and reset an account, and why', async () => {
      const { account } = await createCashier();
      await call('post', `/accounts/${account.id}/deactivate`, {
        reason: 'audit check: off',
      }).expect(200);
      await call('post', `/accounts/${account.id}/reactivate`, {
        reason: 'audit check: on',
      }).expect(200);
      await call('post', `/accounts/${account.id}/reset-credentials`, {
        reason: 'audit check: reset',
      }).expect(200);
      const { rows } = await t.sql.query<{
        action: string;
        reason: string | null;
        actor_id: string | null;
        after: Record<string, unknown> | null;
      }>(
        `SELECT action, reason, actor_id, after FROM audit_log
          WHERE entity = 'app_user' AND entity_id = $1 ORDER BY server_seq`,
        [account.id],
      );
      expect(rows.map((row) => row.action)).toEqual([
        'create',
        'deactivate',
        'reactivate',
        'password_set',
        'password_set',
      ]);
      expect(rows.map((row) => row.reason)).toEqual([
        'cashier account created by the owner',
        'audit check: off',
        'audit check: on',
        'temporary password issued when the account was reactivated',
        'audit check: reset',
      ]);
      // Made by the signed-in owner, not by the system.
      expect(rows.every((row) => row.actor_id !== null)).toBe(true);
      expect(rows[0]?.after).toMatchObject({ role: 'cashier', username: account.username });
      expect(rows[0]?.after).not.toHaveProperty('passwordHash');
    });
  });
});
