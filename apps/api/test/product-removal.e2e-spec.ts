import {
  buildBatchMove,
  errorResponseSchema,
  HEADERS,
  newBatchActionSchema,
  type NewBatchActionInput,
  PRODUCT_REMOVAL_ISSUES,
  type ProductStockMove,
  storedProductSchema,
  type SyncOp,
  type SyncOpResult,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/index.js';
import { addPartnerLogin, createTestApp, type Session, type TestApp } from './support/app.js';
import { stockKit } from './support/stock.js';

/**
 * Removing a product from the inventory (PB20): the product is cancelled with a reason, never
 * deleted, and only once it holds no stock. The server re-checks it for the REST route and for a
 * device's void op alike; everything the product ever did stays where it was.
 */
describe('removing a product (PB20)', () => {
  let t: TestApp;
  let session: Session;
  let kit: ReturnType<typeof stockKit>;
  let cashierToken = '';
  let partnerToken = '';
  let clock = Date.UTC(2026, 9, 30, 10, 0);
  const tick = () => new Date((clock += 60_000)).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    kit = stockKit(t, () => session, push);
    await t.app.get(AuthService).setCashierUser({
      username: 'amina',
      password: 'a-long-cashier-password',
      displayName: 'أمينة',
    });
    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: 'amina', password: 'a-long-cashier-password' })
      .expect(200);
    cashierToken = (login.body as { accessToken: string }).accessToken;
    await addPartnerLogin(t, { username: 'shareek', password: 'a-long-partner-password' });
    const partnerLogin = await t
      .http()
      .post('/auth/login')
      .send({ username: 'shareek', password: 'a-long-partner-password' })
      .expect(200);
    partnerToken = (partnerLogin.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await t.close();
  });

  const as = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
    request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');

  async function push(...ops: SyncOp[]): Promise<SyncOpResult[]> {
    const response = await as(t.http().post('/sync/push')).send({ ops }).expect(200);
    return syncPushResponseSchema.parse(response.body).results;
  }

  const voidOp = (productId: string, reason = 'no longer sold'): SyncOp => ({
    opId: crypto.randomUUID(),
    entity: 'product',
    entityId: productId,
    kind: 'void',
    payload: { reason },
    deviceId: 'desk',
    clientTs: tick(),
    baseServerSeq: null,
  });

  /** Takes every cm of the batch out as a loss, the way a device records it. */
  async function loseAll(batchId: string): Promise<void> {
    const { batch, ledger } = await kit.detail(batchId);
    const quantity = ledger.available.meter;
    if (quantity?.unit !== 'meter') throw new Error('a metre batch');
    const built = buildBatchMove(
      newBatchActionSchema.parse({
        type: 'loss',
        batchId,
        date: '2026-10-30',
        quantity: quantity.centimeters,
        reason: 'تالف',
      } satisfies NewBatchActionInput),
      batch,
      ledger,
      { id: crypto.randomUUID(), deviceId: 'desk', now: tick(), actor: 'owner' },
    );
    if (!built.ok) throw new Error(JSON.stringify(built.issues));
    const move: ProductStockMove = built.move;
    const [result] = await push({
      opId: crypto.randomUUID(),
      entity: 'product_stock_move',
      entityId: move.id,
      kind: 'append',
      payload: move,
      deviceId: 'desk',
      clientTs: move.createdAt,
      baseServerSeq: null,
    });
    expect(result?.status).toBe('applied');
  }

  const stored = async (productId: string) =>
    storedProductSchema.parse((await as(t.http().get(`/products/${productId}`)).expect(200)).body);

  it('a product with no batch at all is cancelled, with its reason in the audit log, not deleted', async () => {
    const productId = await kit.product({ name: 'بلا مخزون' });
    const response = await as(t.http().post(`/products/${productId}/void`))
      .send({ reason: 'أُضيف خطأ' })
      .expect(200);
    expect(storedProductSchema.parse(response.body).voidedAt).not.toBeNull();
    expect((await stored(productId)).active).toBe(false);
    const { rows } = await t.sql.query<{ action: string; reason: string | null }>(
      `SELECT action, reason FROM audit_log WHERE entity_id = $1 ORDER BY server_seq`,
      [productId],
    );
    expect(rows.map((row) => row.action)).toEqual(['create', 'void']);
    expect(rows[1]?.reason).toBe('أُضيف خطأ');
    // The row is still there: nothing is ever deleted.
    const { rows: kept } = await t.sql.query(`SELECT 1 FROM product WHERE id = $1`, [productId]);
    expect(kept).toHaveLength(1);
  });

  it('a product that still holds stock is refused on the REST route, and nothing changes', async () => {
    const productId = await kit.product({ name: 'عليه مخزون' });
    const batch = await kit.rosa(productId);
    const refused = await as(t.http().post(`/products/${productId}/void`))
      .send({ reason: 'x' })
      .expect(400);
    const error = errorResponseSchema.parse(refused.body).error;
    expect(error.code).toBe('validation_failed');
    expect(error.issues?.[0]?.message).toBe(PRODUCT_REMOVAL_ISSUES.holdsStock);
    expect((await stored(productId)).voidedAt).toBeNull();
    expect(await kit.remaining(batch.id)).toBe(5000);
  });

  it('a device’s void op for a product that holds stock is rejected the same way', async () => {
    const productId = await kit.product({ name: 'عليه مخزون 2' });
    await kit.rosa(productId);
    const [result] = await push(voidOp(productId));
    expect(result).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });
    expect(result?.error?.issues?.[0]?.message).toBe(PRODUCT_REMOVAL_ISSUES.holdsStock);
    expect((await stored(productId)).voidedAt).toBeNull();
  });

  it('a weight still waiting for its length counts as stock', async () => {
    const productId = await kit.product({ name: 'وزن بلا طول' });
    await kit.buy({ productId, unit: 'kg', quantity: 5000, totalCostCents: 9000 });
    const [result] = await push(voidOp(productId));
    expect(result?.status).toBe('rejected');
  });

  it('once the stock is gone the product is cancelled, and its purchase, batch and moves stay', async () => {
    const productId = await kit.product({ name: 'نفد' });
    const batch = await kit.rosa(productId);
    await loseAll(batch.id);

    const [result] = await push(voidOp(productId, 'نفد نهائيا'));
    expect(result?.status).toBe('applied');
    const product = await stored(productId);
    expect(product.voidedAt).not.toBeNull();

    // History is as it was: the batch, its cost and every move are still readable.
    const detail = await kit.detail(batch.id);
    expect(detail.batch).toMatchObject({ id: batch.id, productId, costTotalCents: 80_000 });
    expect(detail.moves.map((move) => move.type)).toEqual(['purchase', 'loss']);
    expect(detail.ledger.unallocatedCostCents).toBe(0);
    const { rows } = await t.sql.query<{ count: string }>(
      `SELECT count(*) FROM purchase WHERE id = $1`,
      [batch.purchaseId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('a product already cancelled stays cancelled, whatever the stock says', async () => {
    const productId = await kit.product({ name: 'مرتين' });
    expect((await push(voidOp(productId)))[0]?.status).toBe('applied');
    expect((await push(voidOp(productId)))[0]?.status).toBe('applied');
  });

  it('a cashier cannot remove a product, by the REST route or by a pushed void', async () => {
    const productId = await kit.product({ name: 'للكاشير' });
    const asCashier = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
      request.auth(cashierToken, { type: 'bearer' }).set(HEADERS.deviceId, 'till');
    const response = await asCashier(t.http().post(`/products/${productId}/void`))
      .send({ reason: 'x' })
      .expect(403);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('forbidden');
    const pushed = await asCashier(t.http().post('/sync/push'))
      .send({ ops: [{ ...voidOp(productId), deviceId: 'till' }] })
      .expect(200);
    expect(syncPushResponseSchema.parse(pushed.body).results[0]).toMatchObject({
      status: 'rejected',
      error: { code: 'forbidden' },
    });
    expect((await stored(productId)).voidedAt).toBeNull();
  });

  it('a partner reads everything and cannot remove a product', async () => {
    const productId = await kit.product({ name: 'للشريك' });
    const response = await t
      .http()
      .post(`/products/${productId}/void`)
      .auth(partnerToken, { type: 'bearer' })
      .send({ reason: 'x' })
      .expect(403);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('forbidden');
    expect((await stored(productId)).voidedAt).toBeNull();
  });
});
