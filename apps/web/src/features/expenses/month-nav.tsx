'use client';

import { monthOf, nextMonth, previousMonth } from '@fabric/core';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { messages } from '@/i18n';
import { DateText } from '@/shared/format';
import { Button } from '@/shared/ui/button';
import { canGoForward, isThisMonth } from './expense-view';

const t = messages.expenses.month;

/**
 * The month shown, with the buttons to go to the one before and after. It goes forward as far as
 * next month only (a bill can be dated ahead), or as far as `latest` when a page needs less (the
 * payroll stops at this month: a salary is not due before its month begins). "This month" brings
 * it back in one tap.
 */
export function MonthNavigator({
  month,
  today,
  latest,
  onChange,
}: {
  month: string;
  today: string;
  /** The last month the buttons go to (YYYY-MM); next month when not given. */
  latest?: string;
  onChange: (month: string) => void;
}) {
  return (
    <div role="group" aria-label={t.label} className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-lg border bg-card">
        <Button
          size="icon"
          variant="ghost"
          aria-label={t.previous}
          onClick={() => {
            onChange(previousMonth(month));
          }}
        >
          <ChevronLeftIcon className="rtl:rotate-180" aria-hidden />
        </Button>
        <span aria-live="polite" className="min-w-36 px-2 text-center font-heading font-medium">
          <DateText value={`${month}-01`} format="month" />
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t.next}
          disabled={latest === undefined ? !canGoForward(month, today) : month >= latest}
          onClick={() => {
            onChange(nextMonth(month));
          }}
        >
          <ChevronRightIcon className="rtl:rotate-180" aria-hidden />
        </Button>
      </div>
      {!isThisMonth(month, today) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onChange(monthOf(today));
          }}
        >
          {t.current}
        </Button>
      )}
    </div>
  );
}
