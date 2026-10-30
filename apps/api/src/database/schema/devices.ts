import { pgSequence, pgTable, text } from 'drizzle-orm/pg-core';
import { baseColumns } from './columns.js';

/** Numbers device codes in sign-up order: 1 → A, 2 → B, … 27 → AA. */
export const deviceCodeSeq = pgSequence('device_code_seq');

/**
 * A device (browser profile) that signed in. Its `code` prefixes the roll codes it creates
 * offline (R-A0001), so two devices never make the same code.
 */
export const device = pgTable('device', {
  ...baseColumns('device'),
  /** The x-device-id the device sends (its own random id). */
  key: text().notNull().unique(),
  code: text().notNull().unique(),
});
