'use client';

import { formatLengthMeters, formatMoneyAmount, type MoneyUnit } from '@fabric/core';
import { DownloadIcon } from 'lucide-react';
import { messages } from '@/i18n';
import { DateText, Meters, Money, useMoneyUnit } from '@/shared/format';
import { download, toCsv } from '@/shared/lib/csv';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

const t = messages.reports;

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
