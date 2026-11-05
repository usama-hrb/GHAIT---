'use client';

import { monthOf } from '@fabric/core';
import { UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { MonthNavigator } from '@/features/expenses';
import { messages } from '@/i18n';
import { type EmployeeSummary, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState } from '@/shared/brand';
import { Money } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { EmployeeDialog, SalaryPaymentDialog, type SalaryPaymentTarget } from './employee-dialogs';
import { SALARY_STATUS_VARIANT } from './people-view';
import { useCanManage } from './use-can-manage';

const t = messages.partners.employees;

function detailHref(employeeId: string): string {
  return `/settings/partners/employee?id=${employeeId}`;
}

/** What the month's pay stands at for one employee, in words (never by colour alone). */
function PayStatus({ summary }: { summary: EmployeeSummary }) {
  const { status } = summary.month;
  return <Badge variant={SALARY_STATUS_VARIANT[status]}>{t.salaryStatus[status]}</Badge>;
}

function NameCell({ summary }: { summary: EmployeeSummary }) {
  const { employee, status } = summary;
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <Link
          href={detailHref(employee.id)}
          className="inline-flex items-center font-medium underline-offset-4 hover:underline wrap-anywhere pointer-coarse:min-h-11"
        >
          <bdi>{employee.name}</bdi>
        </Link>
        {status === 'inactive' && <Badge variant="outline">{t.employment.inactive}</Badge>}
      </span>
      {employee.position && (
        <span className="text-sm text-muted-foreground wrap-anywhere">
          <bdi>{employee.position}</bdi>
        </span>
      )}
    </div>
  );
}

/**
 * The employees tab (ADR 0022): who works here, what each earns, and how the month asked for
 * stands — due, paid, still to pay. Employees are not partners: they have no share of the profit.
 * A salary is paid from here and booked as an expense on the day it is paid.
 */
export function EmployeesPanel() {
  const repositories = useRepositories();
  const canManage = useCanManage();
  const today = shopToday();
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<SalaryPaymentTarget | null>(null);
  const directory = useLiveQuery(() => repositories.employees.list(month), [repositories, month]);

  if (directory === undefined) return <LoadingState />;
  const { employees, totals } = directory;

  const payAction = (summary: EmployeeSummary) =>
    canManage && summary.month.remainingCents > 0 ? (
      <Button
        size="sm"
        variant="outline"
        className="pointer-coarse:min-w-11"
        onClick={() => {
          setPaying({
            employee: summary.employee,
            month: directory.month,
            dueCents: summary.month.dueCents,
            paidCents: summary.month.paidCents,
          });
        }}
      >
        {t.pay}
      </Button>
    ) : null;

  const addButton = (
    <Button
      variant="accent"
      onClick={() => {
        setAdding(true);
      }}
    >
      {t.add}
    </Button>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNavigator month={month} today={today} latest={thisMonth} onChange={setMonth} />
        {canManage && employees.length > 0 && addButton}
      </div>

      {employees.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={t.empty.title}
          description={t.empty.description}
          action={canManage ? addButton : undefined}
        />
      ) : (
        <>
          <section
            aria-label={t.totals.label}
            className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3"
          >
            {(
              [
                ['due', totals.dueCents],
                ['paid', totals.paidCents],
                ['remaining', totals.remainingCents],
              ] as const
            ).map(([key, cents]) => (
              <div key={key} className="grid gap-0.5">
                <p className="text-sm text-muted-foreground">{t.totals[key]}</p>
                <p className="text-xl font-semibold">
                  <Money
                    cents={cents}
                    tone={key === 'remaining' && cents > 0 ? 'debt' : undefined}
                  />
                </p>
              </div>
            ))}
          </section>

          <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.employee}</TableHead>
                  <TableHead className="text-end">{t.columns.salary}</TableHead>
                  <TableHead className="text-end">{t.columns.paid}</TableHead>
                  <TableHead className="text-end">{t.columns.remaining}</TableHead>
                  <TableHead>{t.columns.status}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.columns.actions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((summary) => (
                  <TableRow key={summary.employee.id}>
                    <TableCell className="whitespace-normal">
                      <NameCell summary={summary} />
                    </TableCell>
                    <TableCell className="text-end">
                      {summary.currentSalaryCents > 0 ? (
                        <Money cents={summary.currentSalaryCents} />
                      ) : (
                        <span className="text-muted-foreground">{t.noSalary}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={summary.month.paidCents} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Money
                        cents={summary.month.remainingCents}
                        tone={summary.month.remainingCents > 0 ? 'debt' : undefined}
                      />
                    </TableCell>
                    <TableCell>
                      <PayStatus summary={summary} />
                    </TableCell>
                    <TableCell className="text-end">{payAction(summary)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {employees.map((summary) => (
              <li
                key={summary.employee.id}
                className="grid gap-3 rounded-xl border bg-card p-4 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <NameCell summary={summary} />
                  <PayStatus summary={summary} />
                </div>
                <dl className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{t.columns.salary}</dt>
                    <dd>
                      {summary.currentSalaryCents > 0 ? (
                        <Money cents={summary.currentSalaryCents} />
                      ) : (
                        <span className="text-muted-foreground">{t.noSalary}</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{t.columns.paid}</dt>
                    <dd>
                      <Money cents={summary.month.paidCents} />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{t.columns.remaining}</dt>
                    <dd>
                      <Money
                        cents={summary.month.remainingCents}
                        tone={summary.month.remainingCents > 0 ? 'debt' : undefined}
                      />
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center gap-2">
                  {payAction(summary)}
                  <Button asChild size="sm" variant="link">
                    <Link href={detailHref(summary.employee.id)}>{t.open}</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t.hint}</p>
        </>
      )}

      <EmployeeDialog
        key={adding ? 'add' : 'add-closed'}
        target={adding ? 'add' : null}
        onOpenChange={(open) => {
          if (!open) setAdding(false);
        }}
      />
      <SalaryPaymentDialog
        key={paying ? `${paying.employee.id} ${paying.month}` : 'pay-closed'}
        target={paying}
        onOpenChange={(open) => {
          if (!open) setPaying(null);
        }}
      />
    </div>
  );
}
