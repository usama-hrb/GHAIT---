'use client';

import { formatLengthMeters, formatMoneyAmount, type MoneyUnit } from '@fabric/core';
import { DownloadIcon } from 'lucide-react';
import { messages } from '@/i18n';
import { DateText, Meters, Money, useMoneyUnit } from '@/shared/format';
import { useMediaQuery } from '@/shared/hooks/use-media-query';
import { download, toCsv } from '@/shared/lib/csv';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.reports;

/** The width from which a report is a table; narrower, each row is a card. */
const WIDE = '(min-width: 1024px)';

export type ColumnKind =
  'text' | 'money' | 'meters' | 'month' | 'date' | 'days' | 'percent' | 'count';

export interface Column<R> {
  key: keyof R & string;
  label: string;
  kind: ColumnKind;
}

const NUMERIC = new Set<ColumnKind>(['money', 'meters', 'days', 'percent', 'count']);

function Cell({ kind, value }: { kind: ColumnKind; value: unknown }) {
  if (value === null || value === undefined || value === '') return <>—</>;
  if (kind === 'money' && typeof value === 'number') return <Money cents={value} />;
  if (kind === 'meters' && typeof value === 'number') return <Meters cm={value} />;
  if (kind === 'month' && typeof value === 'string')
    return <DateText value={`${value}-01`} format="month" />;
  if (kind === 'date' && typeof value === 'string') return <DateText value={value} />;
  if (kind === 'percent' && typeof value === 'number')
    return <bdi data-num>{(value / 100).toFixed(2)}%</bdi>;
  if (typeof value === 'number') return <bdi data-num>{value}</bdi>;
  return <>{typeof value === 'string' ? value : ''}</>;
}

/** A value as a spreadsheet takes it: money in the display unit, lengths in metres. */
function csvValue(kind: ColumnKind, value: unknown, unit: MoneyUnit): unknown {
  if (typeof value !== 'number') return value;
  if (kind === 'money') return formatMoneyAmount(value, unit, { grouping: false });
  if (kind === 'meters') return formatLengthMeters(value, { grouping: false });
  if (kind === 'percent') return (value / 100).toFixed(2);
  return value;
}

/** A report's table, with its CSV export (BUILD_PROMPTS 5.2). */
export function ReportTable<R extends Record<string, unknown>>({
  title,
  file,
  columns,
  rows,
}: {
  title: string;
  /** The CSV file's name, without extension. */
  file: string;
  columns: readonly Column<R>[];
  rows: readonly R[];
}) {
  const { unit } = useMoneyUnit();
  const wide = useMediaQuery(WIDE);
  return (
    <section aria-label={title} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading font-semibold">{title}</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0}
          onClick={() => {
            const csv = toCsv(
              rows.map((row) =>
                Object.fromEntries(
                  columns.map((column) => [
                    column.label,
                    csvValue(column.kind, row[column.key], unit),
                  ]),
                ),
              ),
            );
            download(`${file}.csv`, csv, 'text/csv;charset=utf-8');
          }}
        >
          <DownloadIcon aria-hidden />
          {t.csv}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t.empty}</p>
      ) : !wide ? (
        <ul className="grid gap-2">
          {rows.map((row, index) => (
            <li
              key={`${String(row[columns[0]?.key ?? ''])}-${String(index)}`}
              className="grid gap-2 rounded-lg border bg-card p-3"
            >
              {columns[0] && (
                <p className="font-medium">
                  <Cell kind={columns[0].kind} value={row[columns[0].key]} />
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
                {columns.slice(1).map((column) => (
                  <div key={column.key} className="grid min-w-0 content-start gap-0.5">
                    <dt className="text-xs text-muted-foreground">{column.label}</dt>
                    <dd className="break-words">
                      <Cell kind={column.kind} value={row[column.key]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className={NUMERIC.has(column.kind) ? 'text-end' : undefined}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${String(row[columns[0]?.key ?? ''])}-${String(index)}`}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={NUMERIC.has(column.kind) ? 'text-end' : undefined}
                    >
                      <Cell kind={column.kind} value={row[column.key]} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
