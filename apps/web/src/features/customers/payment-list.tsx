import Link from 'next/link';
import { messages } from '@/i18n';
import { DateText, Money } from '@/shared/format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import type { PaymentRow } from './customer-view';

const t = messages.customers;

/** Where a payment went: the invoices it paid, each with the part it took. */
function AppliedTo({ row }: { row: PaymentRow }) {
  if (row.applied.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="grid gap-0.5">
      {row.applied.map((part) => (
        <li key={part.saleId} className="flex flex-wrap items-baseline gap-x-1.5">
          <Link
            href={`/pos/view?id=${part.saleId}`}
            className="inline-flex min-h-6 items-center underline-offset-4 hover:underline pointer-coarse:min-h-11"
          >
            {t.invoiceOf} <DateText value={part.date} />
          </Link>
          <span className="text-muted-foreground">
            · <Money cents={part.amountCents} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Every payment and refund of the customer, newest first, with the invoices it was applied to. */
export function PaymentTable({ rows }: { rows: readonly PaymentRow[] }) {
  return (
    <div className="rounded-lg border bg-card">
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.date}</TableHead>
            <TableHead>{t.columns.kind}</TableHead>
            <TableHead>{t.columns.method}</TableHead>
            <TableHead>{t.columns.appliedTo}</TableHead>
            <TableHead>{t.columns.note}</TableHead>
            <TableHead className="text-end">{t.columns.amount}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const { payment } = row;
            return (
              <TableRow key={payment.id} className="sm:h-12">
                <TableCell>
                  <DateText value={payment.date} />
                </TableCell>
                <TableCell label={t.columns.kind}>{t.kinds[payment.kind]}</TableCell>
                <TableCell label={t.columns.method}>{t.methods[payment.method]}</TableCell>
                <TableCell label={t.columns.appliedTo}>
                  <AppliedTo row={row} />
                </TableCell>
                <TableCell
                  className="text-muted-foreground sm:max-w-48 sm:truncate"
                  label={t.columns.note}
                >
                  {payment.note ?? '—'}
                </TableCell>
                <TableCell className="text-end" label={t.columns.amount}>
                  <Money
                    cents={payment.amountCents}
                    tone={payment.kind === 'payment' ? 'profit' : undefined}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
