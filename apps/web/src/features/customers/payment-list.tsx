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
          <Link href={`/pos/view?id=${part.saleId}`} className="underline-offset-4 hover:underline">
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.date}</TableHead>
            <TableHead>{t.columns.kind}</TableHead>
            <TableHead className="max-sm:hidden">{t.columns.method}</TableHead>
            <TableHead className="max-md:hidden">{t.columns.appliedTo}</TableHead>
            <TableHead className="max-lg:hidden">{t.columns.note}</TableHead>
            <TableHead className="text-end">{t.columns.amount}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const { payment } = row;
            return (
              <TableRow key={payment.id} className="h-12">
                <TableCell>
                  <DateText value={payment.date} />
                </TableCell>
                <TableCell>{t.kinds[payment.kind]}</TableCell>
                <TableCell className="max-sm:hidden">{t.methods[payment.method]}</TableCell>
                <TableCell className="max-md:hidden">
                  <AppliedTo row={row} />
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground max-lg:hidden">
                  {payment.note ?? '—'}
                </TableCell>
                <TableCell className="text-end">
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
