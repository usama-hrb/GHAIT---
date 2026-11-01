import type { AuditEntry } from '@fabric/contracts';
import { messages } from '@/i18n';
import { DateText, Meters, Money } from '@/shared/format';

const t = messages.audit;

/** Bookkeeping fields every record has: not what anyone changed. */
const HIDDEN = new Set(['id', 'createdAt', 'updatedAt', 'deviceId', 'serverSeq']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The record an entry is about: an op's payload carries it under its name (sale, saleVoid…). */
function recordOf(value: unknown, entity: string): Fields {
  if (!isFields(value)) return {};
  const key = entity.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const inner = value[key];
  return isFields(inner) ? inner : value;
}

/** The fields an entry changed: what a create set, what an edit or a void changed. */
export function changesOf(entry: AuditEntry): { field: string; before: unknown; after: unknown }[] {
  const before = recordOf(entry.before, entry.entity);
  const after = recordOf(entry.after, entry.entity);
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .filter((field) => !HIDDEN.has(field))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .filter(
      (field) => entry.action !== 'create' || (after[field] !== null && after[field] !== undefined),
    )
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

/** A field's value as the owner reads it: money and lengths in their units, never cents or cm. */
export function AuditValue({ field, value }: { field: string; value: unknown }) {
  if (value === null || value === undefined || value === '') return <>—</>;
  if (typeof value === 'number' && field.endsWith('Cents')) return <Money cents={value} />;
  if (typeof value === 'number' && field.endsWith('Cm')) return <Meters cm={value} />;
  if (typeof value === 'boolean') return <>{value ? t.yes : t.no}</>;
  if (typeof value === 'string' && DATE.test(value)) return <DateText value={value} />;
  if (typeof value === 'string' && TIMESTAMP.test(value)) {
    return <DateText value={value} format="dateTime" />;
  }
  if (Array.isArray(value)) return <>{t.items(value.length)}</>;
  if (typeof value === 'string') return <bdi>{value}</bdi>;
  if (typeof value === 'number') return <bdi data-num>{value}</bdi>;
  return <>{t.details}</>;
}

export function fieldLabel(field: string): string {
  return t.fields[field] ?? field;
}
