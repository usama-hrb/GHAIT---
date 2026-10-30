import { describe, expect, it } from 'vitest';
import {
  CATALOG_ISSUES,
  fabricInputSchema,
  fabricSchema,
  SYNC_ENTITIES,
  supplierInputSchema,
  syncOpSchema,
  syncPullQuerySchema,
  variantInputSchema,
} from './index.js';

const rosa = { name: ' روزا ', refPricePerMeterCents: 2000, minPricePerMeterCents: 1800 };

describe('fabric', () => {
  it('fills defaults and trims', () => {
    expect(fabricInputSchema.parse(rosa)).toEqual({
      name: 'روزا',
      type: null,
      defaultSupplierId: null,
      refPricePerMeterCents: 2000,
      minPricePerMeterCents: 1800,
      estCmPerKg: null,
      sellableAsPiece: false,
      piecePriceCents: null,
      tags: [],
      notes: null,
    });
  });

  it('turns blank optional text into null', () => {
    expect(fabricInputSchema.parse({ ...rosa, type: '  ', notes: '' })).toMatchObject({
      type: null,
      notes: null,
    });
  });

  it('refuses a minimum above the reference price', () => {
    const result = fabricInputSchema.safeParse({ ...rosa, minPricePerMeterCents: 2100 });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['minPricePerMeterCents'],
        message: CATALOG_ISSUES.minAboveRef,
      }),
    ]);
  });

  it('needs a piece price when the fabric sells as a whole piece', () => {
    const result = fabricInputSchema.safeParse({ ...rosa, sellableAsPiece: true });
    expect(result.error?.issues[0]).toMatchObject({
      path: ['piecePriceCents'],
      message: CATALOG_ISSUES.piecePriceRequired,
    });
    expect(
      fabricInputSchema.safeParse({ ...rosa, sellableAsPiece: true, piecePriceCents: 10_000 })
        .success,
    ).toBe(true);
  });

  it('accepts only integer, non-negative cents', () => {
    expect(fabricInputSchema.safeParse({ ...rosa, refPricePerMeterCents: 20.5 }).success).toBe(
      false,
    );
    expect(fabricInputSchema.safeParse({ ...rosa, minPricePerMeterCents: -1 }).success).toBe(false);
  });

  it('a full record has the base fields', () => {
    const record = {
      ...rosa,
      id: crypto.randomUUID(),
      createdAt: '2026-10-29T10:00:00.000Z',
      updatedAt: '2026-10-29T10:00:00.000Z',
      deviceId: 'desk-1',
      voidedAt: null,
    };
    expect(fabricSchema.safeParse(record).success).toBe(true);
    expect(fabricSchema.safeParse({ ...record, deviceId: 'bad id' }).success).toBe(false);
    expect(SYNC_ENTITIES.fabric.schema).toBe(fabricSchema);
  });
});

describe('variant and supplier', () => {
  it('defaults the low-stock threshold to 5 m', () => {
    expect(
      variantInputSchema.parse({ fabricId: crypto.randomUUID(), colorName: 'أحمر' })
        .lowStockThresholdCm,
    ).toBe(500);
  });

  it('accepts a phone number or nothing', () => {
    expect(supplierInputSchema.parse({ name: 'مورد', phone: '+212 6 12 34 56 78' }).phone).toBe(
      '+212 6 12 34 56 78',
    );
    expect(supplierInputSchema.parse({ name: 'مورد', phone: '' }).phone).toBeNull();
    expect(supplierInputSchema.safeParse({ name: 'مورد', phone: 'call me' }).success).toBe(false);
  });
});

describe('sync envelope', () => {
  const op = {
    opId: crypto.randomUUID(),
    entity: 'fabric',
    entityId: crypto.randomUUID(),
    kind: 'upsert',
    payload: {},
    deviceId: 'desk-1',
    clientTs: '2026-10-29T10:00:00.000+01:00',
    baseServerSeq: null,
  };

  it('accepts a well-formed op', () => {
    expect(syncOpSchema.safeParse(op).success).toBe(true);
  });

  it('rejects unknown entities and kinds', () => {
    expect(syncOpSchema.safeParse({ ...op, entity: 'unicorn' }).success).toBe(false);
    expect(syncOpSchema.safeParse({ ...op, kind: 'delete' }).success).toBe(false);
  });

  it('pages the pull with defaults', () => {
    expect(syncPullQuerySchema.parse({})).toEqual({ since: 0, limit: 200 });
    expect(syncPullQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
