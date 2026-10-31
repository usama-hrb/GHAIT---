import {
  HEADERS,
  monthExpensesSchema,
  storedExpenseSchema,
  type SyncOp,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Session, type TestApp } from './support/app.js';

describe('expenses (BUILD_PROMPTS 4.1)', () => {
  let t: TestApp;
  let session: Session;
  const rentId = crypto.randomUUID();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  const putExpense = (body: object, id = crypto.randomUUID()) =>
    as(t.http().put(`/expenses/${id}`)).send(body);

  it('templates and expenses, paid or not; the month counts what was paid in it (S6)', async () => {
    await as(t.http().put(`/recurring-expenses/${rentId}`))
      .send({ name: 'كراء المحل', category: 'rent', amountCents: 300_000, dayOfMonth: 1 })
      .expect(200);
    // October's rent, paid on the 1st; September's electricity paid in October; an unpaid water bill.
    await putExpense({
      date: '2026-10-01',
      category: 'rent',
      amountCents: 300_000,
      paidDate: '2026-10-01',
      recurringExpenseId: rentId,
    }).expect(200);
    await putExpense({
      date: '2026-09-15',
      category: 'electricity',
      amountCents: 40_000,
      paidDate: '2026-10-02',
    }).expect(200);
    const water = crypto.randomUUID();
    await putExpense({ date: '2026-10-20', category: 'water', amountCents: 8000 }, water).expect(
      200,
    );

    const summary = monthExpensesSchema.parse(
      (await as(t.http().get('/expenses/summary?month=2026-10')).expect(200)).body,
    );
    expect(summary).toEqual({
      month: '2026-10',
      paidCents: 340_000,
      paidByCategory: { rent: 300_000, electricity: 40_000 },
      unpaidCents: 8000,
      unpaidCount: 1,
    });
    const listed = (await as(t.http().get('/expenses?month=2026-10')).expect(200))
      .body as unknown[];
    expect(listed.map((row) => storedExpenseSchema.parse(row).category)).toEqual([
      'electricity',
      'rent',
      'water',
    ]);

    // Paid later: an edit; voided: it no longer counts anywhere.
    await putExpense(
      { date: '2026-10-20', category: 'water', amountCents: 8000, paidDate: '2026-11-03' },
      water,
    ).expect(200);
    await as(t.http().post(`/expenses/${water}/void`))
      .send({ reason: 'أُدخل مرتين' })
      .expect(200);
    expect(
      monthExpensesSchema.parse(
        (await as(t.http().get('/expenses/summary?month=2026-11')).expect(200)).body,
      ).paidCents,
    ).toBe(0);
  });

  it('validates expenses with the contract; a template that does not exist is refused', async () => {
    await putExpense({ date: '2026-10-01', category: 'rent', amountCents: 0 }).expect(400);
    await as(t.http().get('/expenses?month=2026-13')).expect(400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const op: SyncOp = {
      opId: crypto.randomUUID(),
      entity: 'expense',
      entityId: id,
      kind: 'upsert',
      payload: {
        id,
        createdAt: now,
        updatedAt: now,
        deviceId: 'desk',
        voidedAt: null,
        date: '2026-10-05',
        category: 'rent',
        amountCents: 1000,
        paidDate: null,
        note: null,
        recurringExpenseId: crypto.randomUUID(),
      },
      deviceId: 'desk',
      clientTs: now,
      baseServerSeq: null,
    };
    const response = await as(t.http().post('/sync/push'))
      .send({ ops: [op] })
      .expect(200);
    expect(syncPushResponseSchema.parse(response.body).results[0]).toMatchObject({
      status: 'rejected',
      error: { code: 'conflict' },
    });
    const templates = (await as(t.http().get('/recurring-expenses')).expect(200)).body as {
      name: string;
    }[];
    expect(templates.map((template) => template.name)).toEqual(['كراء المحل']);
  });
});
