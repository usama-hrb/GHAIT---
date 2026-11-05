import { STOCK_FILTERS, type StockFilter } from '@/local-db';

/** The filter a link asks for (/inventory?filter=low, ADR 0018); anything else shows every product. */
export function stockFilterOf(value: string | null): StockFilter {
  return STOCK_FILTERS.find((filter) => filter === value) ?? 'all';
}
