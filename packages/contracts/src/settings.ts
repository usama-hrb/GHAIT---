import { DEFAULT_EST_CM_PER_KG_POLICY, DEFAULT_ZAKAT_SETTINGS, NISAB_GRAMS } from '@fabric/core';
import { z } from 'zod';
import { isoDateSchema } from './common.js';

/**
 * Every setting the app reads (SPEC §0.7: rules marked [قابل للإعداد] live in the `setting`
 * table). A key without a row has its default. Values are validated per key.
 */
export const SETTINGS = {
  /** SPEC §0.2: how money is typed and shown. */
  money_display_unit: { schema: z.enum(['rial', 'dirham']), default: 'rial' },
  /** SPEC §2.3, C11. */
  est_cm_per_kg_policy: {
    schema: z.enum(['average', 'last']),
    default: DEFAULT_EST_CM_PER_KG_POLICY,
  },
  /** SPEC §4: the shop's name at the top of a shared invoice. */
  shop_name: { schema: z.string().trim().min(1).max(80), default: 'غيث' },
  /** SPEC §5: expense categories, a stable key and the label shown (keys stay on old expenses). */
  expense_categories: {
    schema: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
          label: z.string().trim().min(1).max(40),
        }),
      )
      .min(1)
      .max(50),
    default: [
      { key: 'rent', label: 'كراء' },
      { key: 'electricity', label: 'كهرباء' },
      { key: 'water', label: 'ماء' },
      { key: 'internet', label: 'إنترنت' },
      { key: 'wages', label: 'أجرة عامل' },
      { key: 'transport', label: 'نقل' },
      { key: 'packaging', label: 'تغليف' },
      { key: 'other', label: 'أخرى' },
    ],
  },
  /** SPEC §5 "يذكّر قبل الموعد": how many days before a recurring bill's due date (E2). */
  expense_reminder_days: { schema: z.int().min(0).max(31), default: 3 },
  /** SPEC §4: a roll under this length becomes a remnant. */
  remnant_threshold_cm: { schema: z.int().min(0).max(100_000), default: 100 },
  /** SPEC §10. */
  zakat_nisab_metal: {
    schema: z.enum(Object.keys(NISAB_GRAMS) as [keyof typeof NISAB_GRAMS]),
    default: DEFAULT_ZAKAT_SETTINGS.nisabMetal,
  },
  zakat_goods_valuation: {
    schema: z.enum(['market', 'cost']),
    default: DEFAULT_ZAKAT_SETTINGS.goodsValuation,
  },
  zakat_include_doubtful_debts: {
    schema: z.boolean(),
    default: DEFAULT_ZAKAT_SETTINGS.includeDoubtfulDebts,
  },
} as const satisfies Record<string, { schema: z.ZodType; default: unknown }>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]];
export const settingKeySchema = z.enum(SETTING_KEYS);

/** Validates a value for its key; throws a ZodError when it does not fit. */
export function parseSettingValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return SETTINGS[key].schema.parse(value) as SettingValue<K>;
}

/**
 * The row in effect on `day` (YYYY-MM-DD) among a key's rows: the latest effective_from on or
 * before that day, null counting as the earliest; voided rows never. Undefined: use the default.
 * Shared by the API and the devices so both answer the same.
 */
export function settingInEffect<
  R extends { key: string; effectiveFrom: string | null; voidedAt: unknown },
>(key: string, rows: readonly R[], day: string): R | undefined {
  let best: R | undefined;
  for (const row of rows) {
    if (row.key !== key || (row.voidedAt !== null && row.voidedAt !== undefined)) continue;
    if (row.effectiveFrom !== null && row.effectiveFrom > day) continue;
    if (!best || (best.effectiveFrom ?? '') < (row.effectiveFrom ?? '')) best = row;
  }
  return best;
}

export const settingSchema = z.object({
  key: settingKeySchema,
  value: z.unknown(),
  /** From when this value applies; null = since always. */
  effectiveFrom: isoDateSchema.nullable(),
  /** No row: the built-in default. */
  isDefault: z.boolean(),
});
export type Setting = z.infer<typeof settingSchema>;

export const settingListSchema = z.array(settingSchema);

export const putSettingRequestSchema = z.object({
  value: z.unknown(),
  effectiveFrom: isoDateSchema.nullable().default(null),
});
export type PutSettingRequest = z.infer<typeof putSettingRequestSchema>;

export const settingAtQuerySchema = z.object({
  /** The value in effect on this date; default today. */
  at: isoDateSchema.optional(),
});
