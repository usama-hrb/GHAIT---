import {
  accessTokenResponseSchema,
  auditListResponseSchema,
  errorResponseSchema,
  HEADERS,
  PAYROLL_ISSUES,
  payrollSchema,
  SETTLEMENT_ISSUES,
  settlementDetailSchema,
  settlementPreviewSchema,
  shopDate,
  storedEmployeeSalarySchema,
  storedEmployeeSchema,
  type SyncEntity,
  type SyncOp,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@fabric/contracts';
import { monthOf, nextMonth, previousMonth } from '@fabric/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth/index.js';
import { createTestApp, type Session, type TestApp } from './support/app.js';

const dh = (amount: number) => amount * 100;

// The shop's calendar is the real one (rates and payments are checked against "today").
const today = shopDate(new Date());
const thisMonth = monthOf(today);
const lastMonth = previousMonth(thisMonth);
const twoMonthsAgo = previousMonth(lastMonth);
const firstOf = (month: string) => `${month}-01`;

const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;
const messagesOf = (body: unknown) => (errorOf(body).issues ?? []).map((issue) => issue.message);

describe('employees, salary rates and salary payments (PY1–PY6)', () => {
  let t: TestApp;
  let session: Session;
  /** Yusuf: started two months ago, 3000 dh a month, 3500 dh from this month. */
  const yusuf = crypto.randomUUID();
  const firstRate = crypto.randomUUID();
  const raise = crypto.randomUUID();
  /** Payments: two months ago in two parts, this month in one. */
  const advance = crypto.randomUUID();
  const rest = crypto.randomUUID();
  const thisMonthPart = crypto.randomUUID();

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

  const putEmployee = (id: string, body: object) => as(t.http().put(`/employees/${id}`)).send(body);
  const putRate = (id: string, employeeId: string, effectiveFrom: string, amountCents: number) =>
    as(t.http().put(`/employee-salaries/${id}`)).send({ employeeId, effectiveFrom, amountCents });
  const putExpense = (id: string, body: object) =>
    as(t.http().put(`/expenses/${id}`)).send({ date: today, category: 'wages', ...body });
  const pay = (
    id: string,
    employeeId: string,
    salaryMonth: string,
    amountCents: number,
    paidDate: string | null = today,
  ) => putExpense(id, { amountCents, paidDate, employeeId, salaryMonth });

  const payroll = async (employeeId: string, through?: string) =>
    payrollSchema.parse(
      (
        await as(
          t.http().get(`/employees/${employeeId}/payroll${through ? `?through=${through}` : ''}`),
        ).expect(200)
      ).body,
    );

  it('an employee is added, edited and listed; an end before the start is refused (PY1)', async () => {
    const created = storedEmployeeSchema.parse(
      (
        await putEmployee(yusuf, {
          name: 'يوسف',
          phone: '0612345678',
          position: 'قصّاص',
          startDate: firstOf(twoMonthsAgo),
        }).expect(200)
      ).body,
    );
    expect(created).toMatchObject({
      name: 'يوسف',
      phone: '0612345678',
      position: 'قصّاص',
      startDate: firstOf(twoMonthsAgo),
      endDate: null,
      notes: null,
      voidedAt: null,
    });

    const edited = storedEmployeeSchema.parse(
      (
        await putEmployee(yusuf, {
          name: 'يوسف',
          phone: '0612345678',
          position: 'رئيس القصّاصين',
          startDate: firstOf(twoMonthsAgo),
          notes: 'يبدأ يوم السبت',
        }).expect(200)
      ).body,
    );
    expect(edited).toMatchObject({ position: 'رئيس القصّاصين', notes: 'يبدأ يوم السبت' });
    expect(edited.createdAt).toBe(created.createdAt);
    expect(edited.serverSeq).toBeGreaterThan(created.serverSeq);

    await putEmployee(crypto.randomUUID(), {
      name: 'x',
      startDate: '2026-05-10',
      endDate: '2026-05-09',
    }).expect(400);

    const listed = (await as(t.http().get('/employees')).expect(200)).body as { id: string }[];
    expect(listed.map((employee) => employee.id)).toEqual([yusuf]);
    await as(t.http().get(`/employees/${crypto.randomUUID()}`)).expect(404);
  });

  it('a salary rate: the first may start in a past month, a later one this month or after, none is edited (PY4)', async () => {
    const rateOf = (body: unknown) => storedEmployeeSalarySchema.parse(body);
    expect(
      rateOf((await putRate(firstRate, yusuf, firstOf(twoMonthsAgo), dh(3000)).expect(200)).body),
    ).toMatchObject({
      employeeId: yusuf,
      effectiveFrom: firstOf(twoMonthsAgo),
      amountCents: 300_000,
    });

    // Only the first of a month; never before the job began; one rate per start date.
    await putRate(crypto.randomUUID(), yusuf, `${thisMonth}-15`, dh(3200)).expect(400);
    const beforeJob = await putRate(
      crypto.randomUUID(),
      yusuf,
      firstOf(previousMonth(twoMonthsAgo)),
      dh(2800),
    ).expect(400);
    expect(messagesOf(beforeJob.body)).toEqual([PAYROLL_ISSUES.rateBeforeStart]);
    const taken = await putRate(crypto.randomUUID(), yusuf, firstOf(twoMonthsAgo), dh(3100)).expect(
      400,
    );
    expect(messagesOf(taken.body)).toEqual([PAYROLL_ISSUES.rateDateTaken]);

    // A month that is over is not rewritten by a raise.
    const past = await putRate(crypto.randomUUID(), yusuf, firstOf(lastMonth), dh(3300)).expect(
      400,
    );
    expect(messagesOf(past.body)).toEqual([PAYROLL_ISSUES.ratePast]);

    // This month, and a later one, are fine.
    await putRate(raise, yusuf, firstOf(thisMonth), dh(3500)).expect(200);
    const later = crypto.randomUUID();
    await putRate(later, yusuf, firstOf(nextMonth(thisMonth)), dh(4000)).expect(200);

    // Sending the same rate again changes nothing; changing it is refused.
    await putRate(raise, yusuf, firstOf(thisMonth), dh(3500)).expect(200);
    const edited = await putRate(raise, yusuf, firstOf(thisMonth), dh(3600)).expect(400);
    expect(messagesOf(edited.body)).toEqual([PAYROLL_ISSUES.rateFixed]);

    // A rate that has started stays; one that has not may be taken back, with a reason.
    const started = await as(t.http().post(`/employee-salaries/${firstRate}/void`))
      .send({ reason: 'خطأ' })
      .expect(400);
    expect(messagesOf(started.body)).toEqual([PAYROLL_ISSUES.ratePast]);
    await as(t.http().post(`/employee-salaries/${later}/void`))
      .send({ reason: 'تراجع عن الزيادة' })
      .expect(200);

    const unknown = await putRate(
      crypto.randomUUID(),
      crypto.randomUUID(),
      firstOf(thisMonth),
      dh(3000),
    ).expect(400);
    expect(messagesOf(unknown.body)).toEqual([PAYROLL_ISSUES.unknownEmployee]);

    const rates = (
      (await as(t.http().get(`/employees/${yusuf}/salary`)).expect(200)).body as {
        id: string;
        voidedAt: string | null;
      }[]
    ).map((rate) => [rate.id, rate.voidedAt === null]);
    expect(rates).toEqual([
      [firstRate, true],
      [raise, true],
      [later, false],
    ]);
  });

  it('a salary payment is an expense of the wages category tied to the employee and the month it pays (PY3)', async () => {
    const refuse = async (
      message: string,
      request: PromiseLike<{ status: number; body: unknown }>,
    ) => {
      const response = await request;
      expect(response.status, message).toBe(400);
      expect(messagesOf(response.body), message).toEqual([message]);
    };
    await refuse(
      PAYROLL_ISSUES.needsEmployeeAndMonth,
      putExpense(crypto.randomUUID(), { amountCents: 1000, paidDate: today, employeeId: yusuf }),
    );
    await refuse(
      PAYROLL_ISSUES.needsEmployeeAndMonth,
      putExpense(crypto.randomUUID(), {
        amountCents: 1000,
        paidDate: today,
        salaryMonth: thisMonth,
      }),
    );
    await refuse(
      PAYROLL_ISSUES.notSalaryCategory,
      putExpense(crypto.randomUUID(), {
        category: 'rent',
        amountCents: 1000,
        paidDate: today,
        employeeId: yusuf,
        salaryMonth: thisMonth,
      }),
    );
    // An unpaid wage is not an expense yet: what is still owed is worked out, not entered.
    await refuse(PAYROLL_ISSUES.notPaid, pay(crypto.randomUUID(), yusuf, thisMonth, 1000, null));
    await refuse(
      PAYROLL_ISSUES.monthNotStarted,
      pay(crypto.randomUUID(), yusuf, nextMonth(thisMonth), 1000),
    );
    await refuse(
      PAYROLL_ISSUES.monthBeforeStart,
      pay(crypto.randomUUID(), yusuf, previousMonth(twoMonthsAgo), 1000),
    );
    await refuse(
      PAYROLL_ISSUES.unknownEmployee,
      pay(crypto.randomUUID(), crypto.randomUUID(), thisMonth, 1000),
    );

    // Two months ago: 1000 dh in advance, then the rest after the month. This month: a part.
    await pay(advance, yusuf, twoMonthsAgo, dh(1000), `${twoMonthsAgo}-28`).expect(200);
    await pay(rest, yusuf, twoMonthsAgo, dh(2000), `${lastMonth}-03`).expect(200);
    await pay(thisMonthPart, yusuf, thisMonth, dh(1000)).expect(200);

    const stored = (await as(t.http().get(`/expenses/${rest}`)).expect(200)).body as object;
    expect(stored).toMatchObject({
      category: 'wages',
      employeeId: yusuf,
      salaryMonth: twoMonthsAgo,
      paidDate: `${lastMonth}-03`,
      amountCents: 200_000,
    });
  });

  it('payroll: due from the rate in force, paid from the payments, what is left and where it stands (PY2, PY3)', async () => {
    const ledger = await payroll(yusuf, thisMonth);
    expect(ledger.months).toEqual([
      {
        month: twoMonthsAgo,
        dueCents: 300_000,
        paidCents: 300_000,
        remainingCents: 0,
        overpaidCents: 0,
        status: 'paid',
      },
      {
        month: lastMonth,
        dueCents: 300_000,
        paidCents: 0,
        remainingCents: 300_000,
        overpaidCents: 0,
        status: 'unpaid',
      },
      {
        month: thisMonth,
        dueCents: 350_000,
        paidCents: 100_000,
        remainingCents: 250_000,
        overpaidCents: 0,
        status: 'partial',
      },
    ]);
    expect(ledger.outstandingCents).toBe(550_000);
    // No `through`: this month.
    expect(await payroll(yusuf)).toEqual(ledger);
    // Looking back: the ledger through last month owes only what was unpaid by then.
    expect((await payroll(yusuf, lastMonth)).outstandingCents).toBe(300_000);
  });

  it('paying more than is due is kept apart; a wrong payment is edited or voided and the month owes it again', async () => {
    const extra = crypto.randomUUID();
    await pay(extra, yusuf, twoMonthsAgo, dh(500), `${lastMonth}-10`).expect(200);
    expect((await payroll(yusuf, thisMonth)).months[0]).toMatchObject({
      paidCents: 350_000,
      remainingCents: 0,
      overpaidCents: 50_000,
      status: 'paid',
    });

    await as(t.http().post(`/expenses/${extra}/void`))
      .send({ reason: 'دفعة مكررة' })
      .expect(200);
    expect((await payroll(yusuf, thisMonth)).months[0]).toMatchObject({
      paidCents: 300_000,
      overpaidCents: 0,
    });

    // This month's part was really 1500 dh.
    await pay(thisMonthPart, yusuf, thisMonth, dh(1500)).expect(200);
    expect((await payroll(yusuf, thisMonth)).months[2]).toMatchObject({
      paidCents: 150_000,
      remainingCents: 200_000,
      status: 'partial',
    });
    expect((await payroll(yusuf, thisMonth)).outstandingCents).toBe(500_000);
  });

  it('an employee who was paid is never removed; one who never was can be (PY6)', async () => {
    const refused = await as(t.http().post(`/employees/${yusuf}/void`))
      .send({ reason: 'غادر' })
      .expect(400);
    expect(messagesOf(refused.body)).toEqual([PAYROLL_ISSUES.hasPayments]);
    // He leaves: the job ends, and no pay falls due after that month.
    await putEmployee(yusuf, {
      name: 'يوسف',
      phone: '0612345678',
      position: 'رئيس القصّاصين',
      startDate: firstOf(twoMonthsAgo),
      endDate: `${lastMonth}-20`,
      notes: 'يبدأ يوم السبت',
    }).expect(200);
    // What was paid for the month after he left is shown as paid beyond what was due.
    const ended = await payroll(yusuf, thisMonth);
    expect(ended.months.at(-1)).toMatchObject({
      month: thisMonth,
      dueCents: 0,
      paidCents: 150_000,
      remainingCents: 0,
      overpaidCents: 150_000,
      status: 'paid',
    });
    expect(ended.outstandingCents).toBe(300_000);

    const never = crypto.randomUUID();
    await putEmployee(never, { name: 'مؤقت', startDate: today }).expect(200);
    await as(t.http().post(`/employees/${never}/void`))
      .send({ reason: 'أُدخل بالخطأ' })
      .expect(200);
    expect(
      ((await as(t.http().get('/employees')).expect(200)).body as { id: string }[]).map(
        (e) => e.id,
      ),
    ).toEqual([yusuf]);
    expect(
      (
        (await as(t.http().get('/employees?includeVoided=true')).expect(200)).body as {
          id: string;
        }[]
      ).map((e) => e.id),
    ).toContain(never);

    // Paying someone who was removed is refused.
    const unknown = await pay(crypto.randomUUID(), never, thisMonth, 1000).expect(400);
    expect(messagesOf(unknown.body)).toEqual([PAYROLL_ISSUES.unknownEmployee]);

    const audit = auditListResponseSchema.parse(
      (await as(t.http().get(`/audit?entity=employee&entityId=${never}`)).expect(200)).body,
    );
    expect(audit.items[0]).toMatchObject({ action: 'void', reason: 'أُدخل بالخطأ' });
    const rateAudit = auditListResponseSchema.parse(
      (await as(t.http().get(`/audit?entity=employee_salary&entityId=${firstRate}`)).expect(200))
        .body,
    );
    expect(rateAudit.items.map((entry) => entry.action)).toEqual(['create']);
  });

  it('devices sync employees and rates; a raise typed offline last month is accepted, the same raise typed now is not (PY4)', async () => {
    const ali = crypto.randomUUID();
    const aliFirst = crypto.randomUUID();
    const aliRaise = crypto.randomUUID();
    const base = (id: string, at: string) => ({
      id,
      createdAt: at,
      updatedAt: at,
      deviceId: 'tablet',
      voidedAt: null,
    });
    const op = (entity: SyncEntity, id: string, payload: object, clientTs: string): SyncOp => ({
      opId: crypto.randomUUID(),
      entity,
      entityId: id,
      kind: 'upsert',
      payload,
      deviceId: 'tablet',
      clientTs,
      baseServerSeq: null,
    });
    const push = async (...ops: SyncOp[]) =>
      syncPushResponseSchema.parse(
        (await as(t.http().post('/sync/push')).send({ ops }).expect(200)).body,
      ).results;

    const now = new Date().toISOString();
    const lastMonthEnd = `${lastMonth}-28T09:00:00.000Z`;
    const employee = {
      ...base(ali, lastMonthEnd),
      name: 'علي',
      phone: null,
      position: null,
      startDate: firstOf(twoMonthsAgo),
      endDate: null,
      notes: null,
    };
    const rate = (id: string, at: string, effectiveFrom: string, amountCents: number) => ({
      ...base(id, at),
      employeeId: ali,
      effectiveFrom,
      amountCents,
    });

    const results = await push(
      op('employee', ali, employee, lastMonthEnd),
      op(
        'employee_salary',
        aliFirst,
        rate(aliFirst, lastMonthEnd, firstOf(twoMonthsAgo), dh(2500)),
        lastMonthEnd,
      ),
      // Typed on the 28th of last month, for last month: that month had not ended on his tablet.
      op(
        'employee_salary',
        aliRaise,
        rate(aliRaise, lastMonthEnd, firstOf(lastMonth), dh(2800)),
        lastMonthEnd,
      ),
    );
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied']);
    expect((await payroll(ali, thisMonth)).months.map((month) => month.dueCents)).toEqual([
      250_000, 280_000, 280_000,
    ]);

    // The same raise made today, for a month that is over, is refused.
    const again = crypto.randomUUID();
    const [late] = await push(
      op(
        'employee_salary',
        again,
        rate(again, now, firstOf(previousMonth(lastMonth)), dh(2900)),
        now,
      ),
    );
    expect(late).toMatchObject({ status: 'rejected', error: { code: 'validation_failed' } });

    // A rate cannot be changed afterwards, from any device.
    const [edited] = await push({
      ...op(
        'employee_salary',
        aliRaise,
        rate(aliRaise, lastMonthEnd, firstOf(lastMonth), dh(9999)),
        now,
      ),
      baseServerSeq: 1,
    });
    expect(edited?.status).toBe('rejected');
    expect((await payroll(ali, thisMonth)).months[1]?.dueCents).toBe(280_000);

    // Another device receives both, with the shop's other records.
    const pulled = syncPullResponseSchema.parse(
      (await as(t.http().get('/sync/pull?since=0&limit=500')).expect(200)).body,
    );
    const pulledIds = pulled.changes
      .filter((change) => change.entity === 'employee' || change.entity === 'employee_salary')
      .map((change) => (change.record as { id: string }).id);
    expect(pulledIds).toEqual(expect.arrayContaining([ali, aliFirst, aliRaise, yusuf]));
  });

  it('a partner reads what the shop pays; only the owner changes it (PY5)', async () => {
    const auth = t.app.get(AuthService);
    await auth.setPartnerUser({
      username: 'shareek',
      password: 'a-long-partner-password',
      displayName: 'الشريك',
    });
    const login = await t
      .http()
      .post('/auth/login')
      .send({ username: 'shareek', password: 'a-long-partner-password' })
      .expect(200);
    const { accessToken } = accessTokenResponseSchema.parse(login.body);
    const asPartner = (request: ReturnType<ReturnType<TestApp['http']>['get']>) =>
      request.auth(accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'phone');
    await asPartner(t.http().get('/employees')).expect(200);
    await asPartner(t.http().get(`/employees/${yusuf}/payroll`)).expect(200);
    await asPartner(t.http().put(`/employees/${crypto.randomUUID()}`))
      .send({ name: 'x', startDate: today })
      .expect(403);
    await asPartner(t.http().put(`/employee-salaries/${crypto.randomUUID()}`))
      .send({ employeeId: yusuf, effectiveFrom: firstOf(thisMonth), amountCents: 1 })
      .expect(403);
  });
});

describe('a salary in the books and in the settlement (S6, PY3, PY5)', () => {
  let t: TestApp;
  let session: Session;
  const owner = crypto.randomUUID();
  const partner = crypto.randomUUID();
  const sara = crypto.randomUUID();

  beforeAll(async () => {
    t = await createTestApp();
    session = await t.login();
    await as(t.http().put(`/partners/${owner}`))
      .send({ name: 'المالك', ownershipBp: 5000, isOwner: true })
      .expect(200);
    await as(t.http().put(`/partners/${partner}`))
      .send({ name: 'الشريك', ownershipBp: 5000, isOwner: false })
      .expect(200);
    await as(t.http().put(`/employees/${sara}`))
      .send({ name: 'سارة', startDate: '2026-08-01' })
      .expect(200);
    await as(t.http().put(`/employee-salaries/${crypto.randomUUID()}`))
      .send({ employeeId: sara, effectiveFrom: '2026-08-01', amountCents: dh(3000) })
      .expect(200);
  });

  afterAll(async () => {
    await t.close();
  });

  function as(request: ReturnType<ReturnType<TestApp['http']>['get']>) {
    return request.auth(session.accessToken, { type: 'bearer' }).set(HEADERS.deviceId, 'desk');
  }

  const paySara = (id: string, salaryMonth: string, paidDate: string, amountCents: number) =>
    as(t.http().put(`/expenses/${id}`)).send({
      date: paidDate,
      category: 'wages',
      amountCents,
      paidDate,
      employeeId: sara,
      salaryMonth,
    });

  const preview = async (end: string) =>
    settlementPreviewSchema.parse(
      (await as(t.http().get(`/settlements/preview?end=${end}`)).expect(200)).body,
    );

  async function settle(end: string) {
    const { breakdown } = await preview(end);
    return settlementDetailSchema.parse(
      (
        await as(t.http().post('/settlements'))
          .send({ periodEnd: end, expected: breakdown })
          .expect(201)
      ).body,
    );
  }

  it('what is owed but not paid is no cost of the period: only a payment is, on the day it is paid', async () => {
    const ledger = payrollSchema.parse(
      (await as(t.http().get(`/employees/${sara}/payroll?through=2026-08`)).expect(200)).body,
    );
    expect(ledger.outstandingCents).toBe(dh(3000));
    expect(await preview('2026-08-31')).toMatchObject({ expensesCents: 0, netProfitCents: 0 });

    await paySara(crypto.randomUUID(), '2026-08', '2026-08-28', dh(1000)).expect(200);
    expect(await preview('2026-08-31')).toMatchObject({
      expensesCents: dh(1000),
      netProfitCents: -dh(1000),
    });
    const august = await settle('2026-08-31');
    expect(august.settlement).toMatchObject({
      netProfitCents: -dh(1000),
      carryDeficitOutCents: dh(1000),
    });
    expect(august.shares).toEqual([]);
  });

  it('August’s settled period stays as it was: the rest of the pay is September’s cost, once', async () => {
    const lockedDay = await paySara(crypto.randomUUID(), '2026-08', '2026-08-30', dh(2000)).expect(
      409,
    );
    expect(errorOf(lockedDay.body)).toMatchObject({
      code: 'period_locked',
      issues: [expect.objectContaining({ message: SETTLEMENT_ISSUES.locked })],
    });

    await paySara(crypto.randomUUID(), '2026-08', '2026-09-05', dh(2000)).expect(200);
    const ledger = payrollSchema.parse(
      (await as(t.http().get('/employees/' + sara + '/payroll?through=2026-09')).expect(200)).body,
    );
    expect(ledger.months[0]).toMatchObject({
      month: '2026-08',
      paidCents: dh(3000),
      remainingCents: 0,
      status: 'paid',
    });
    // September is due too, and unpaid: owed, but not a cost yet.
    expect(ledger.months[1]).toMatchObject({ month: '2026-09', status: 'unpaid' });

    expect(await preview('2026-09-30')).toMatchObject({
      periodStart: '2026-09-01',
      expensesCents: dh(2000),
    });
    const september = await settle('2026-09-30');
    expect(september.settlement).toMatchObject({
      periodStart: '2026-09-01',
      carriedDeficitInCents: dh(1000),
      netProfitCents: -dh(3000),
      carryDeficitOutCents: dh(3000),
    });
  });

  it('pay is not a partner’s withdrawal: neither partner’s account moves', async () => {
    for (const id of [owner, partner]) {
      const { account } = (await as(t.http().get(`/partners/${id}/account`)).expect(200)).body as {
        account: Record<string, number>;
      };
      expect(account).toMatchObject({ drawsCents: 0, withdrawalsCents: 0, undrawnCents: 0 });
    }
  });
});
