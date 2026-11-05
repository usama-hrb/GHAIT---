'use client';

import { monthOf } from '@fabric/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { isLockedOn, LockedBadge, useLockedThrough } from '@/features/settlements';
import { MonthNavigator } from '@/features/expenses';
import { messages } from '@/i18n';
import { type EmployeeDetailView, useLiveQuery, useRepositories } from '@/local-db';
import { EmptyState, LoadingState, OfflineNotice, VoidDialog } from '@/shared/brand';
import { DateText, formatDate, Money } from '@/shared/format';
import { shopToday } from '@/shared/lib/dates';
import { useAppNavigation } from '@/shared/lib/navigation';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import {
  EmployeeDialog,
  SalaryPaymentDialog,
  type SalaryPaymentTarget,
  SalaryRateDialog,
} from './employee-dialogs';
import { failureText } from './people-errors';
import { peopleTabHref } from './people-tabs';
import { canVoidRate, rateTimings, SALARY_STATUS_VARIANT } from './people-view';
import { useCanManage } from './use-can-manage';

const t = messages.partners.employees;

/** How many months of pay the table shows before "show earlier months". */
const RECENT_MONTHS = 12;

type Voiding = { kind: 'payment' | 'rate' | 'employee'; id: string };

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid gap-2">
      <h3 className="font-heading font-semibold">{label}</h3>
      {children}
    </section>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{children}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end wrap-anywhere">{children}</dd>
    </div>
  );
}

/**
 * One employee (/settings/partners/employee?id=…, ADR 0022): the month's pay, what is still owed
 * month by month, the salary rates with the day each starts, every payment (voidable with a
 * reason), and the employment details. A salary payment is an expense, never a partner's draw.
 */
export function EmployeeDetailScreen() {
  const id = useSearchParams().get('id') ?? '';
  const repositories = useRepositories();
  const navigation = useAppNavigation();
  const canManage = useCanManage();
  const lockedThrough = useLockedThrough();
  const today = shopToday();
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState(thisMonth);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changingSalary, setChangingSalary] = useState(false);
  const [paying, setPaying] = useState<SalaryPaymentTarget | null>(null);
  const [voiding, setVoiding] = useState<Voiding | null>(null);
  const view = useLiveQuery(
    async (): Promise<EmployeeDetailView | null> =>
      (await repositories.employees.get(id, month)) ?? null,
    [repositories, id, month],
  );

  if (view === undefined) return <LoadingState />;
  if (view === null) {
    return (
      <EmptyState
        title={t.detail.notFound}
        action={
          <Button asChild variant="outline">
            <Link href={peopleTabHref('employees')}>{t.detail.back}</Link>
          </Button>
        }
      />
    );
  }

  const { employee, status, currentSalaryCents, rates, payroll, payments } = view;
  const timings = rateTimings(rates, today);
  const months = [...payroll.months].reverse();
  const shownMonths = showAll ? months : months.slice(0, RECENT_MONTHS);
  const hasSalary = rates.length > 0;
  const payTarget = (row: {
    month: string;
    dueCents: number;
    paidCents: number;
  }): SalaryPaymentTarget => ({
    employee,
    month: row.month,
    dueCents: row.dueCents,
    paidCents: row.paidCents,
  });
  const payThisMonth = (
    <Button
      variant={hasSalary ? 'accent' : 'outline'}
      onClick={() => {
        setPaying(payTarget(view.month));
      }}
    >
      {t.detail.recordPayment}
    </Button>
  );
  const voidTexts = {
    payment: {
      title: t.detail.voidPaymentTitle,
      description: t.detail.voidPaymentDescription,
    },
    rate: { title: t.detail.voidRateTitle, description: t.detail.voidRateDescription },
    employee: { title: t.detail.removeTitle, description: t.detail.removeDescription },
  } as const;

  return (
    <div className="grid w-full max-w-4xl gap-5">
      <OfflineNotice />
      <Button asChild variant="link" className="justify-self-start px-0">
        <Link href={peopleTabHref('employees')}>{t.detail.back}</Link>
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-semibold wrap-anywhere">
              <bdi>{employee.name}</bdi>
            </h2>
            <Badge variant={status === 'active' ? 'success' : 'outline'}>
              {t.employment[status]}
            </Badge>
          </div>
          {employee.position && (
            <p className="text-muted-foreground">
              <bdi>{employee.position}</bdi>
            </p>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(true);
              }}
            >
              {t.detail.edit}
            </Button>
            <Button
              variant={hasSalary ? 'outline' : 'accent'}
              onClick={() => {
                setChangingSalary(true);
              }}
            >
              {hasSalary ? t.detail.changeSalary : t.detail.setSalary}
            </Button>
            {hasSalary && payThisMonth}
          </div>
        )}
      </header>

      <div className="grid gap-3">
        <MonthNavigator month={month} today={today} latest={thisMonth} onChange={setMonth} />
        <section
          aria-label={t.detail.overview}
          className="grid gap-4 rounded-xl border bg-card p-4"
        >
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Figure label={t.detail.figures.salary}>
              {currentSalaryCents > 0 ? (
                <Money cents={currentSalaryCents} />
              ) : (
                <span className="text-muted-foreground">{t.noSalary}</span>
              )}
            </Figure>
            <Figure label={t.detail.figures.due}>
              <Money cents={view.month.dueCents} />
            </Figure>
            <Figure label={t.detail.figures.paid}>
              <Money cents={view.month.paidCents} />
            </Figure>
            <Figure label={t.detail.figures.remaining}>
              <span className="flex flex-wrap items-center gap-2">
                <Money
                  cents={view.month.remainingCents}
                  tone={view.month.remainingCents > 0 ? 'debt' : undefined}
                />
                <Badge variant={SALARY_STATUS_VARIANT[view.month.status]}>
                  {t.salaryStatus[view.month.status]}
                </Badge>
              </span>
            </Figure>
          </dl>
          {payroll.outstandingCents !== view.month.remainingCents && (
            <p className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                {t.detail.owedThrough(formatDate(`${month}-01`, 'month'))}
              </span>
              <Money
                cents={payroll.outstandingCents}
                tone={payroll.outstandingCents > 0 ? 'debt' : undefined}
              />
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t.detail.overviewHint}</p>
        </section>
      </div>

      <Section label={t.detail.sections.payroll}>
        {months.length === 0 ? (
          <p className="text-muted-foreground">{t.detail.noPayroll}</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.detail.columns.month}</TableHead>
                    <TableHead className="text-end">{t.columns.due}</TableHead>
                    <TableHead className="text-end">{t.columns.paid}</TableHead>
                    <TableHead className="text-end max-sm:hidden">{t.columns.remaining}</TableHead>
                    <TableHead>{t.columns.status}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t.columns.actions}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownMonths.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell>
                        <DateText value={`${row.month}-01`} format="month" />
                      </TableCell>
                      <TableCell className="text-end">
                        <Money cents={row.dueCents} />
                      </TableCell>
                      <TableCell className="text-end">
                        <Money cents={row.paidCents} />
                      </TableCell>
                      <TableCell className="text-end max-sm:hidden">
                        <Money
                          cents={row.remainingCents}
                          tone={row.remainingCents > 0 ? 'debt' : undefined}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={SALARY_STATUS_VARIANT[row.status]}>
                          {t.salaryStatus[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        {canManage && row.remainingCents > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="pointer-coarse:min-w-11"
                            onClick={() => {
                              setPaying(payTarget(row));
                            }}
                          >
                            {t.pay}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {months.length > RECENT_MONTHS && (
              <Button
                variant="ghost"
                className="justify-self-start"
                onClick={() => {
                  setShowAll((current) => !current);
                }}
              >
                {showAll ? t.detail.showRecent : t.detail.showAll}
              </Button>
            )}
          </>
        )}
      </Section>

      <Section label={t.detail.sections.salary}>
        {rates.length === 0 ? (
          <p className="text-muted-foreground">{t.detail.noRates}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.detail.columns.from}</TableHead>
                  <TableHead className="text-end">{t.columns.salary}</TableHead>
                  <TableHead>{t.columns.status}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.columns.actions}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => {
                  const timing = timings.get(rate.id) ?? 'past';
                  return (
                    <TableRow key={rate.id}>
                      <TableCell>
                        <DateText value={rate.effectiveFrom} format="month" />
                      </TableCell>
                      <TableCell className="text-end">
                        <Money cents={rate.amountCents} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            timing === 'current'
                              ? 'success'
                              : timing === 'upcoming'
                                ? 'warning'
                                : 'outline'
                          }
                        >
                          {t.detail.rateState[timing]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        {canManage && canVoidRate(rate, today) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setVoiding({ kind: 'rate', id: rate.id });
                            }}
                          >
                            {t.detail.voidAction}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-sm text-muted-foreground">{t.detail.salaryHint}</p>
      </Section>

      <Section label={t.detail.sections.payments}>
        {payments.length === 0 ? (
          <p className="text-muted-foreground">{t.detail.noPayments}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.detail.columns.paidOn}</TableHead>
                  <TableHead>{t.detail.columns.forMonth}</TableHead>
                  <TableHead className="text-end">{t.detail.columns.amount}</TableHead>
                  <TableHead className="max-sm:hidden">{t.detail.columns.note}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.detail.voidAction}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      {payment.paidDate && <DateText value={payment.paidDate} />}
                    </TableCell>
                    <TableCell>
                      {payment.salaryMonth && (
                        <DateText value={`${payment.salaryMonth}-01`} format="month" />
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <Money cents={payment.amountCents} />
                    </TableCell>
                    <TableCell className="max-sm:hidden">{payment.note}</TableCell>
                    <TableCell className="text-end">
                      {canManage &&
                        (payment.paidDate && isLockedOn(payment.paidDate, lockedThrough) ? (
                          <LockedBadge lockedThrough={lockedThrough} />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setVoiding({ kind: 'payment', id: payment.id });
                            }}
                          >
                            {t.detail.voidAction}
                          </Button>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section label={t.detail.sections.details}>
        <dl className="grid gap-2 rounded-lg border bg-card p-4 text-sm">
          <Detail label={t.form.startDate}>
            <DateText value={employee.startDate} />
          </Detail>
          <Detail label={t.form.endDate}>
            {employee.endDate ? (
              <DateText value={employee.endDate} />
            ) : (
              <span className="text-muted-foreground">{t.detail.stillWorking}</span>
            )}
          </Detail>
          <Detail label={t.form.position}>
            {employee.position ? <bdi>{employee.position}</bdi> : t.detail.none}
          </Detail>
          <Detail label={t.form.phone}>
            {employee.phone ? (
              <bdi dir="ltr" data-num>
                {employee.phone}
              </bdi>
            ) : (
              t.detail.none
            )}
          </Detail>
          <Detail label={t.detail.frequency}>{t.detail.monthly}</Detail>
          {employee.notes && (
            <Detail label={t.form.notes}>
              <bdi>{employee.notes}</bdi>
            </Detail>
          )}
        </dl>
        {canManage &&
          (payments.length === 0 ? (
            <Button
              variant="ghost"
              className="justify-self-start text-destructive hover:text-destructive"
              onClick={() => {
                setVoiding({ kind: 'employee', id: employee.id });
              }}
            >
              {t.detail.remove}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t.detail.removeBlocked}</p>
          ))}
      </Section>

      <EmployeeDialog
        key={editing ? `edit ${employee.id}` : 'closed'}
        target={editing ? employee : null}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      />
      <SalaryRateDialog
        key={changingSalary ? 'rate' : 'closed'}
        target={changingSalary ? { employee, hasRate: hasSalary, currentSalaryCents } : null}
        onOpenChange={(open) => {
          if (!open) setChangingSalary(false);
        }}
      />
      <SalaryPaymentDialog
        key={paying ? `${paying.employee.id} ${paying.month}` : 'closed'}
        target={paying}
        onOpenChange={(open) => {
          if (!open) setPaying(null);
        }}
      />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) setVoiding(null);
        }}
        title={voiding ? voidTexts[voiding.kind].title : ''}
        description={voiding ? voidTexts[voiding.kind].description : ''}
        onConfirm={async (reason) => {
          if (!voiding) return;
          const { kind } = voiding;
          try {
            if (kind === 'payment') {
              await repositories.employees.voidPayment(voiding.id, reason);
            } else if (kind === 'rate') {
              await repositories.employees.voidSalary(voiding.id, reason);
            } else {
              await repositories.employees.remove(voiding.id, reason);
            }
          } catch (error) {
            // The dialog stays open: the reason typed is kept and the text says what stops it.
            toast.error(failureText(error));
            return;
          }
          setVoiding(null);
          toast.success(t.detail.voided, { description: messages.forms.saved });
          if (kind === 'employee') navigation.push(peopleTabHref('employees'));
        }}
      />
    </div>
  );
}
