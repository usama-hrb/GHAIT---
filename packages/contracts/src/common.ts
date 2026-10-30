import { z } from 'zod';

/** Every id is a client-generated UUID (ADR 0002). */
export const idSchema = z.uuid();

/** A calendar date, YYYY-MM-DD (Gregorian, in the shop's time zone). */
export const isoDateSchema = z.iso.date();

/** A point in time, ISO 8601 with offset. */
export const timestampSchema = z.iso.datetime({ offset: true });

/** Integer cents (CLAUDE.md: money is stored and transported as integers only). */
export const centsSchema = z.int();

/** A non-negative amount of cents (prices, costs). */
export const amountCentsSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Optional free text: trimmed, blank becomes null. */
export const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));

/** The shop's time zone: "today" and period boundaries are computed in it. */
export const SHOP_TIME_ZONE = 'Africa/Casablanca';

/** Request headers shared by the web client and the API. */
export const HEADERS = {
  /** The device making the change; stored in device_id (ADR 0002). */
  deviceId: 'x-device-id',
  /** Why a change is made, percent-encoded UTF-8 (Arabic text is not valid in a raw header). */
  auditReason: 'x-audit-reason',
  /** Correlates logs, errors and audit entries; generated when missing. */
  requestId: 'x-request-id',
} as const;

/** device_id values: the web client's id, or `server` for changes made by the API itself. */
export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const SERVER_DEVICE_ID = 'server';
