import {
  type BatchHistory,
  batchCode,
  batchDetailSchema,
  buildProductPurchase,
  HEADERS,
  type NewProductPurchaseInput,
  newProductPurchaseSchema,
  type ProductBatch,
  type SyncOp,
  type SyncOpResult,
} from '@fabric/contracts';
import { expect } from 'vitest';
import type { Session, TestApp } from './app.js';

/**
 * What the specs that sell, return or settle need first: a product with stock. A purchase is
 * built with the contracts' own function and pushed the way a device does (ADR 0012), so the
 * server checks it like any other. `t.login()` runs in the spec's beforeAll; the session is read
 * when needed.
 */
export function stockKit(
  t: TestApp,
  session: () => Session,
  push: (...ops: SyncOp[]) => Promise<SyncOpResult[]>,
  device = 'desk',
) {
  let counter = 0;
  let clock = Date.UTC(2026, 9, 1, 8, 0);

  const as = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
    request.auth(session().accessToken, { type: 'bearer' }).set(HEADERS.deviceId, device);

  /** A product sold by the meter at 20 dh (minimum 17), unless said otherwise. */
  async function product(fields: Record<string, unknown> = {}): Promise<string> {
    const id = crypto.randomUUID();
    await as(t.http().put(`/products/${id}`))
      .send({
        name: 'روزا',
        purchaseUnits: ['meter', 'kg', 'piece'],
        sellingUnits: ['meter'],
        pricePerMeterCents: 2000,
        minPricePerMeterCents: 1700,
        ...fields,
      })
      .expect(200);
    return id;
  }

  /** One purchase of one product (bought by the meter unless `unit` says kg or piece). */
  async function buy(
    input: Partial<NewProductPurchaseInput> & {
      productId: string;
      quantity: number;
      totalCostCents: number;
    },
  ): Promise<ProductBatch> {
    const aggregate = buildProductPurchase(
      newProductPurchaseSchema.parse({
        date: '2026-10-01',
        supplierId: null,
        notes: null,
        unit: 'meter',
        ...input,
      }),
      {
        purchaseId: crypto.randomUUID(),
        batchId: crypto.randomUUID(),
        moveId: crypto.randomUUID(),
        code: batchCode('A', ++counter),
      },
      { deviceId: device, now: new Date((clock += 60_000)).toISOString() },
    );
    const [result] = await push({
      opId: crypto.randomUUID(),
      entity: 'purchase',
      entityId: aggregate.purchase.id,
      kind: 'append',
      payload: aggregate,
      deviceId: device,
      clientTs: aggregate.purchase.createdAt,
      baseServerSeq: null,
    });
    expect(result?.status).toBe('applied');
    const [batch] = aggregate.batches;
    if (!batch) throw new Error('a purchase has a batch');
    return batch;
  }

  /** T1's batch: 50 m of a new product that cost 800 dh (16 dh/m). */
  const rosa = async (productId?: string): Promise<ProductBatch> =>
    buy({ productId: productId ?? (await product()), quantity: 5000, totalCostCents: 80_000 });

  async function detail(batchId: string) {
    return batchDetailSchema.parse(
      (await as(t.http().get(`/batches/${batchId}`)).expect(200)).body,
    );
  }

  async function history(batchId: string): Promise<BatchHistory> {
    const { batch, moves } = await detail(batchId);
    return { batch, moves };
  }

  /** What the ledger says is left on the batch, in cm (meters) unless the unit is given. */
  async function remaining(batchId: string, unit: 'meter' | 'piece' | 'kg' = 'meter') {
    const quantity = (await detail(batchId)).ledger.available[unit];
    if (!quantity) return 0;
    return quantity.unit === 'meter'
      ? quantity.centimeters
      : quantity.unit === 'piece'
        ? quantity.pieces
        : quantity.grams;
  }

  return { as, product, buy, rosa, detail, history, remaining };
}
