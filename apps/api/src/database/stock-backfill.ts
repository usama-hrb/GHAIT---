import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MIGRATIONS_FOLDER } from './migrate.js';

const MIGRATION = '0029_product_stock_backfill.sql';

/**
 * The SQL that carries rolls and stock moves over to product batches (ADR 0012): the statements
 * between the markers of migration 0029, and its reconciliation. The migration runs them once;
 * an import of an old export runs them again (they only add what is missing). One mapping, tested
 * in test/product-stock-backfill.e2e-spec.ts.
 */
export async function stockBackfillSql(): Promise<{ backfill: string[]; reconcile: string }> {
  const text = await readFile(join(MIGRATIONS_FOLDER, MIGRATION), 'utf8');
  const start = text.indexOf('-- backfill:start');
  const end = text.indexOf('-- backfill:end');
  if (start < 0 || end < 0) throw new Error(`${MIGRATION} has no backfill markers`);
  const backfill = text
    .slice(start, end)
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => /[A-Za-z]/.test(statement.replace(/--.*$/gm, '')));
  return { backfill, reconcile: text.slice(text.indexOf('DO $$', end)) };
}

const SALE_LINES_MIGRATION = '0030_sale_lines_on_batches.sql';

/**
 * The SQL that gives every sale line its batch, unit, quantity and prices (ADR 0012): the
 * statements between the markers of migration 0030, and its reconciliation. The migration runs
 * them once; an import of an old export runs them again (they only fill what is empty). Tested in
 * test/sale-lines-backfill.e2e-spec.ts.
 */
export async function saleLinesBackfillSql(): Promise<{ backfill: string[]; reconcile: string }> {
  const text = await readFile(join(MIGRATIONS_FOLDER, SALE_LINES_MIGRATION), 'utf8');
  const start = text.indexOf('-- backfill:start');
  const end = text.indexOf('-- backfill:end');
  if (start < 0 || end < 0) throw new Error(`${SALE_LINES_MIGRATION} has no backfill markers`);
  const backfill = text
    .slice(start, end)
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => /[A-Za-z]/.test(statement.replace(/--.*$/gm, '')));
  const reconcileStart = text.indexOf('DO $$', end);
  const reconcileEnd = text.indexOf('\n$$;', reconcileStart);
  if (reconcileStart < 0 || reconcileEnd < 0) {
    throw new Error(`${SALE_LINES_MIGRATION} has no reconciliation`);
  }
  return { backfill, reconcile: text.slice(reconcileStart, reconcileEnd + '\n$$'.length) };
}
