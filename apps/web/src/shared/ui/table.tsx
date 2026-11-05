'use client';

import * as React from 'react';
import { cn } from 'cn';

/**
 * Whether the table turns into a list of cards on a phone (below `sm`): each row a card, each
 * cell a label over its value. Set by `<Table stack>`; the cells name their column with `label`.
 */
const StackContext = React.createContext(false);

function Table({
  className,
  stack = false,
  ...props
}: React.ComponentProps<'table'> & {
  /**
   * Below `sm` the rows become cards (the header is dropped; every cell carries its column name
   * as `label`). Use it where the columns are too many for a phone and none can be left out.
   * The table keeps its roles, so assistive technology still reads it as a table.
   */
  stack?: boolean;
}) {
  return (
    <StackContext.Provider value={stack}>
      <div data-slot="table-container" className="relative w-full overflow-x-auto">
        <table
          data-slot="table"
          role={stack ? 'table' : undefined}
          className={cn('w-full caption-bottom text-sm', stack && 'max-sm:block', className)}
          {...props}
        />
      </div>
    </StackContext.Provider>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  const stack = React.useContext(StackContext);
  return (
    <thead
      data-slot="table-header"
      role={stack ? 'rowgroup' : undefined}
      className={cn('[&_tr]:border-b', stack && 'max-sm:hidden', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  const stack = React.useContext(StackContext);
  return (
    <tbody
      data-slot="table-body"
      role={stack ? 'rowgroup' : undefined}
      className={cn('[&_tr:last-child]:border-0', stack && 'max-sm:block', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  const stack = React.useContext(StackContext);
  return (
    <tfoot
      data-slot="table-footer"
      role={stack ? 'rowgroup' : undefined}
      className={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        stack && 'max-sm:block',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  const stack = React.useContext(StackContext);
  return (
    <tr
      data-slot="table-row"
      role={stack ? 'row' : undefined}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        stack && 'max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-2 max-sm:p-3',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  const stack = React.useContext(StackContext);
  return (
    <th
      data-slot="table-head"
      role={stack ? 'columnheader' : undefined}
      className={cn(
        'h-10 px-2 text-start align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pe-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  label,
  ...props
}: React.ComponentProps<'td'> & {
  /** The column's name, shown over the value when the table is stacked on a phone. */
  label?: string;
}) {
  const stack = React.useContext(StackContext);
  return (
    <td
      data-slot="table-cell"
      role={stack ? 'cell' : undefined}
      data-label={label}
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0',
        stack &&
          'max-sm:flex max-sm:min-w-0 max-sm:flex-col max-sm:gap-0.5 max-sm:p-0 max-sm:text-start max-sm:whitespace-normal max-sm:before:text-xs max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)] max-sm:first:col-span-2 max-sm:first:font-medium',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
