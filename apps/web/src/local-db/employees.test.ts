import 'fake-indexeddb/auto';
import { PAYROLL_ISSUES } from '@fabric/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopDatabase } from './db';
import { SALARY_NEEDS_CONFIRMATION } from './employees';
import { isPeriodLocked, ValidationError } from './errors';
import { createRepositories, type Repositories } from './repositories';
import { LocalStore } from './store';

const dh = (amount: number) => amount * 100;

let db: ShopDatabase;
let store: LocalStore;
let repos: Repositories;

/** The device's clock: 12 October 2026, a millisecond later each time it is read. */
let tick = 0;

beforeEach(() => {
  tick = 0;
  db = new ShopDatabase(`test-${crypto.randomUUID()}`);
  store = new LocalStore(db, () => new Date(Date.parse('2026-10-12T09:00:00.000Z') + tick++));
  repos = createRepositories(store);
});

afterEach(async () => {
  await db.delete();
});

/** The messages of the ValidationError a call is refused with. */
async function refused(call: Promise<unknown>): Promise<string[]> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ValidationError) return error.issues.map((issue) => issue.message);
    throw error;
  }
  throw new Error('expected the call to be refused');
}

/** Yousef, who started in August and earns 3000 dh a month from then. */
async function hire() {
  const employeeId = await repos.employees.save({
    name: 'يوسف',
    position: 'قصّاص',
    startDate: '2026-08-15',
  });
  const rateId = await repos.employees.setSalary({
    employeeId,
    effectiveFrom: '2026-08-01',
    amountCents: dh(3000),
  });
  return { employeeId, rateId };
}

const pay = (employeeId: string, amountCents: number, month = '2026-10', paidDate = '2026-10-12') =>
  repos.employees.recordPayment({ employeeId, month, amountCents, paidDate });

describe('employees on the device (ADR 0022)', () => {
  it('a salary is paid in parts: due, paid and still to pay for the month, with the status', async () => {
    const { employeeId } = await hire();
    const month = async () => (await repos.employees.list('2026-10')).employees[0]?.month;

    expect(await month()).toMatchObject({ dueCents: dh(3000), paidCents: 0, status: 'unpaid' });
    await pay(employeeId, dh(1000));
    expect(await month()).toEqual({
      month: '2026-10',
      dueCents: dh(3000),
      paidCents: dh(1000),
      remainingCents: dh(2000),
      overpaidCents: 0,
      status: 'partial',
    });
    await pay(employeeId, dh(2000));
    expect(await month()).toMatchObject({ remainingCents: 0, status: 'paid' });

    const { totals, employees } = await repos.employees.list('2026-10');
    expect(employees[0]?.currentSalaryCents).toBe(dh(3000));
    expect(totals).toEqual({ dueCents: dh(3000), paidCents: dh(3000), remainingCents: 0 });
  });

  it('paying more than is due needs a confirmation, and a voided payment is owed again', async () => {
    const { employeeId } = await hire();
    await pay(employeeId, dh(2500));
    const extra = {
      employeeId,
      month: '2026-10',
      amountCents: dh(1000),
      paidDate: '2026-10-12',
    };
    expect(await repos.employees.paymentWarnings(extra)).toEqual([
      { kind: 'over_due', dueCents: dh(3000), paidAfterCents: dh(3500) },
    ]);
    expect(await refused(repos.employees.recordPayment(extra))).toEqual([
      SALARY_NEEDS_CONFIRMATION,
    ]);
    const expenseId = await repos.employees.recordPayment(extra, true);
    expect((await repos.employees.list('2026-10')).employees[0]?.month).toMatchObject({
      remainingCents: 0,
      overpaidCents: dh(500),
      status: 'paid',
    });

    await repos.employees.voidPayment(expenseId, 'أُدخل خطأً');
    expect((await repos.employees.list('2026-10')).employees[0]?.month).toMatchObject({
      paidCents: dh(2500),
      remainingCents: dh(500),
      overpaidCents: 0,
      status: 'partial',
    });
  });

  it('a payment is an ordinary wages expense linked to the employee and the month, counted by the day it is paid', async () => {
    const { employeeId } = await hire();
    // October's salary, paid on 3 November: it is November's expense (S6), October's salary.
    const expenseId = await repos.employees.recordPayment({
      employeeId,
      month: '2026-10',
      amountCents: dh(3000),
      paidDate: '2026-11-03',
    });
    expect(await repos.expenses.get(expenseId)).toMatchObject({
      date: '2026-11-03',
      category: 'wages',
      amountCents: dh(3000),
      paidDate: '2026-11-03',
      employeeId,
      salaryMonth: '2026-10',
      voidedAt: null,
    });
    const november = await repos.expenses.month('2026-11');
    expect(november.totals.paidCents).toBe(dh(3000));
    expect(november.rows.map((row) => row.employeeName)).toEqual(['يوسف']);
    expect((await repos.expenses.month('2026-10')).totals.paidCents).toBe(0);

    const detail = await repos.employees.get(employeeId, '2026-11');
    expect(detail?.payments.map((payment) => payment.id)).toEqual([expenseId]);
    expect(detail?.payroll.months.map((m) => [m.month, m.status])).toEqual([
      ['2026-08', 'unpaid'],
      ['2026-09', 'unpaid'],
      ['2026-10', 'paid'],
      ['2026-11', 'unpaid'],
    ]);
    expect(detail?.payroll.outstandingCents).toBe(dh(9000));

    // Queued for the server like any other change, in the order it was made.
    expect((await db.outbox.toArray()).map((op) => [op.entity, op.kind])).toEqual([
      ['employee', 'upsert'],
      ['employee_salary', 'upsert'],
      ['expense', 'upsert'],
    ]);
  });

  it('a salary payment is a paid expense for a real employee and a month that has begun', async () => {
    const { employeeId } = await hire();
    expect(
      await refused(
        repos.employees.recordPayment({
          employeeId: crypto.randomUUID(),
          month: '2026-10',
          amountCents: 100,
          paidDate: '2026-10-12',
        }),
      ),
    ).toEqual([PAYROLL_ISSUES.unknownEmployee]);
    // A month that has not begun by the day it is paid, or before the employee started.
    expect(await refused(pay(employeeId, 100, '2026-11'))).toEqual([
      PAYROLL_ISSUES.monthNotStarted,
    ]);
    expect(await refused(pay(employeeId, 100, '2026-07'))).toEqual([
      PAYROLL_ISSUES.monthBeforeStart,
    ]);
    // Once paid it cannot go back to unpaid: the payment is voided instead.
    const expenseId = await pay(employeeId, dh(100));
    expect(await refused(repos.expenses.setPaid(expenseId, null))).toEqual([
      PAYROLL_ISSUES.notPaid,
    ]);
    // The link survives being marked paid on another day.
    await repos.expenses.setPaid(expenseId, '2026-10-13');
    expect(await repos.expenses.get(expenseId)).toMatchObject({
      employeeId,
      salaryMonth: '2026-10',
      paidDate: '2026-10-13',
    });
  });

  it('a raise starts this month or later and never rewrites a month that is over (PY4)', async () => {
    const { employeeId, rateId } = await hire();
    await pay(employeeId, dh(3000), '2026-09', '2026-09-30');

    const raise = (effectiveFrom: string) =>
      repos.employees.setSalary({ employeeId, effectiveFrom, amountCents: dh(3500) });
    expect(await refused(raise('2026-09-01'))).toEqual([PAYROLL_ISSUES.ratePast]);
    expect(await refused(raise('2026-08-01'))).toEqual([PAYROLL_ISSUES.rateDateTaken]);
    const raiseId = await raise('2026-11-01');
    expect(await refused(raise('2026-11-01'))).toEqual([PAYROLL_ISSUES.rateDateTaken]);

    const detail = await repos.employees.get(employeeId, '2026-11');
    expect(detail?.rates.map((rate) => [rate.effectiveFrom, rate.amountCents])).toEqual([
      ['2026-11-01', dh(3500)],
      ['2026-08-01', dh(3000)],
    ]);
    expect(detail?.currentSalaryCents).toBe(dh(3000));
    expect(detail?.payroll.months.map((m) => [m.month, m.dueCents])).toEqual([
      ['2026-08', dh(3000)],
      ['2026-09', dh(3000)],
      ['2026-10', dh(3000)],
      ['2026-11', dh(3500)],
    ]);

    // A rate that has not started can be voided and entered again; one that has, cannot.
    await repos.employees.voidSalary(raiseId, 'مبلغ خاطئ');
    expect(await refused(repos.employees.voidSalary(rateId, 'x'))).toEqual([
      PAYROLL_ISSUES.ratePast,
    ]);
    expect((await repos.employees.get(employeeId, '2026-11'))?.rates).toHaveLength(1);
  });

  it('the first rate may start in any month from the start date; none before it', async () => {
    const employeeId = await repos.employees.save({ name: 'سعيد', startDate: '2026-03-10' });
    expect(
      await refused(
        repos.employees.setSalary({
          employeeId,
          effectiveFrom: '2026-02-01',
          amountCents: dh(2000),
        }),
      ),
    ).toEqual([PAYROLL_ISSUES.rateBeforeStart]);
    await repos.employees.setSalary({
      employeeId,
      effectiveFrom: '2026-03-01',
      amountCents: dh(2000),
    });
    // Nothing is owed after the month employment ended.
    await repos.employees.save(
      { name: 'سعيد', startDate: '2026-03-10', endDate: '2026-08-31' },
      employeeId,
    );
    const detail = await repos.employees.get(employeeId, '2026-10');
    expect(detail?.status).toBe('inactive');
    expect(detail?.month).toMatchObject({ dueCents: 0, status: 'none' });
    expect(detail?.payroll.outstandingCents).toBe(dh(12_000));
    expect((await repos.employees.list('2026-10')).totals).toEqual({
      dueCents: 0,
      paidCents: 0,
      remainingCents: 0,
    });
  });

  it('an employee with a payment in the books is not removed; one without can be (PY6)', async () => {
    const { employeeId } = await hire();
    const stranger = await repos.employees.save({ name: 'خالد', startDate: '2026-10-01' });
    const expenseId = await pay(employeeId, dh(1000));

    expect(await refused(repos.employees.remove(employeeId, 'x'))).toEqual([
      PAYROLL_ISSUES.hasPayments,
    ]);
    await repos.employees.remove(stranger, 'أُدخل خطأً');
    expect((await repos.employees.list('2026-10')).employees.map((e) => e.employee.id)).toEqual([
      employeeId,
    ]);
    expect(await repos.employees.get(stranger, '2026-10')).toBeUndefined();

    // Only a payment in the books holds them: once it is voided (entered by mistake), they can go.
    await repos.employees.voidPayment(expenseId, 'x');
    await repos.employees.remove(employeeId, 'أُدخل خطأً');
    expect((await repos.employees.list('2026-10')).employees).toEqual([]);
  });

  it('a payment dated inside a settled period is refused, like any expense in it', async () => {
    const { employeeId } = await hire();
    await db.settlements.put({
      id: crypto.randomUUID(),
      createdAt: '2026-10-02T09:00:00.000Z',
      updatedAt: '2026-10-02T09:00:00.000Z',
      deviceId: 'server',
      voidedAt: null,
      serverSeq: 1,
      periodStart: '2026-08-01',
      periodEnd: '2026-09-30',
      recognizedProfitCents: 0,
      returnsEffectCents: 0,
      recoveredBadDebtCents: 0,
      damageCents: 0,
      badDebtCents: 0,
      belowCostCents: 0,
      expensesCents: 0,
      cashOverShortCents: 0,
      carriedDeficitInCents: 0,
      netProfitCents: 0,
      ownerShareCents: 0,
      partnerShareCents: 0,
      shopShareCents: 0,
      carryDeficitOutCents: 0,
      ownerWeight: 1,
      partnerWeight: 1,
      shopWeight: 1,
      partnerWeights: null,
      lockedAt: '2026-10-02T09:00:00.000Z',
    });
    await expect(pay(employeeId, dh(1000), '2026-09', '2026-09-30')).rejects.toSatisfy(
      isPeriodLocked,
    );
    // The same month's salary paid after the period closed is open.
    await pay(employeeId, dh(1000), '2026-09', '2026-10-12');
    expect((await repos.employees.list('2026-09')).employees[0]?.month.paidCents).toBe(dh(1000));
  });
});
