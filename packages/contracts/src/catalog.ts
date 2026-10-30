import { z } from 'zod';
import {
  amountCentsSchema,
  deviceIdSchema,
  idSchema,
  optionalTextSchema,
  timestampSchema,
} from './common.js';

/** Fields every synced record carries (CLAUDE.md "Data rules"); server_seq is the server's. */
export const recordBaseSchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  /** Set by whoever changed the record: last write wins on (updatedAt, deviceId) (ADR 0002). */
  updatedAt: timestampSchema,
  deviceId: deviceIdSchema,
  /** Only a `void` op sets it; an upsert never clears it (voids are final). */
  voidedAt: timestampSchema.nullable(),
});
export type RecordBase = z.infer<typeof recordBaseSchema>;

/** Issue messages for rules zod has no built-in code for; the web shows i18n text for each. */
export const CATALOG_ISSUES = {
  minAboveRef: 'min_price_above_ref_price',
  piecePriceRequired: 'piece_price_required',
} as const;

const cents = amountCentsSchema;
const optionalText = optionalTextSchema;

const fabricFields = z.object({
  /** "روزا", "كريب كوريا". */
  name: z.string().trim().min(1).max(80),
  /** Kind of cloth, free text ("كريب", "قطن"). */
  type: optionalText(60).default(null),
  defaultSupplierId: idSchema.nullable().default(null),
  /** SPEC §3: the negotiable reference price and the floor that triggers a warning. */
  refPricePerMeterCents: cents,
  minPricePerMeterCents: cents,
  /** SPEC §2.3: suggests a kg-bought roll's length; updated by measurements. */
  estCmPerKg: z.int().min(1).max(1_000_000).nullable().default(null),
  /** A ready piece that can also be sold whole at piecePriceCents (SPEC §2.3). */
  sellableAsPiece: z.boolean().default(false),
  piecePriceCents: cents.nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  notes: optionalText(1000).default(null),
});

function fabricRules(
  fabric: Pick<
    z.infer<typeof fabricFields>,
    'refPricePerMeterCents' | 'minPricePerMeterCents' | 'sellableAsPiece' | 'piecePriceCents'
  >,
  context: z.RefinementCtx,
): void {
  if (fabric.minPricePerMeterCents > fabric.refPricePerMeterCents) {
    context.addIssue({
      code: 'custom',
      path: ['minPricePerMeterCents'],
      message: CATALOG_ISSUES.minAboveRef,
    });
  }
  if (fabric.sellableAsPiece && fabric.piecePriceCents === null) {
    context.addIssue({
      code: 'custom',
      path: ['piecePriceCents'],
      message: CATALOG_ISSUES.piecePriceRequired,
    });
  }
}

/** What a user edits (forms, REST body). */
export const fabricInputSchema = fabricFields.superRefine(fabricRules);
export type FabricInput = z.input<typeof fabricInputSchema>;
export type FabricFields = z.output<typeof fabricInputSchema>;

/** The full record: sync payload and stored shape. */
export const fabricSchema = recordBaseSchema.extend(fabricFields.shape).superRefine(fabricRules);
export type Fabric = z.output<typeof fabricSchema>;

const variantFields = z.object({
  fabricId: idSchema,
  /** "روزا أحمر": the colour is the variant (SPEC §2.2). */
  colorName: z.string().trim().min(1).max(60),
  /** Below this remaining length the colour shows as running low (BUILD_PROMPTS 3.3). */
  lowStockThresholdCm: z.int().min(0).max(10_000_000).default(500),
});
export const variantInputSchema = variantFields;
export type VariantInput = z.input<typeof variantInputSchema>;
export const variantSchema = recordBaseSchema.extend(variantFields.shape);
export type Variant = z.output<typeof variantSchema>;

const supplierFields = z.object({
  name: z.string().trim().min(1).max(80),
  /** Western digits (inputs normalise Arabic-Indic ones first). */
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/)
    .nullable()
    .or(z.literal('').transform(() => null))
    .default(null),
  notes: optionalText(1000).default(null),
});
export const supplierInputSchema = supplierFields;
export type SupplierInput = z.input<typeof supplierInputSchema>;
export const supplierSchema = recordBaseSchema.extend(supplierFields.shape);
export type Supplier = z.output<typeof supplierSchema>;

/** Records as the API returns them: with the server_seq of their current version. */
const withServerSeq = { serverSeq: z.int().positive() };
export const storedFabricSchema = recordBaseSchema.extend(fabricFields.shape).extend(withServerSeq);
export const storedVariantSchema = variantSchema.extend(withServerSeq);
export const storedSupplierSchema = supplierSchema.extend(withServerSeq);
export type StoredFabric = z.output<typeof storedFabricSchema>;
export type StoredVariant = z.output<typeof storedVariantSchema>;
export type StoredSupplier = z.output<typeof storedSupplierSchema>;

export const voidRequestSchema = z.object({
  /** Required: every void says why (CLAUDE.md). */
  reason: z.string().trim().min(1).max(500),
});
export type VoidRequest = z.infer<typeof voidRequestSchema>;
