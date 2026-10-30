import {
  buildStockMove,
  type Fabric,
  type NewStockMoveInput,
  newStockMoveSchema,
  nextFabricEstimate,
  type Purchase,
  type Roll,
  rollLedgerOf,
  type StockMove,
  type Variant,
} from '@fabric/contracts';
import { type RollLedger, type RollState, rollState } from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import { matchesSearch } from '@/shared/lib/search';
import type { Local } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';
import type { FabricsRepository, RollsTable, SettingsRepository } from './tables';

/** Where a colour stands: out of stock, at or under its low-stock threshold, or fine. */
export type ColorStockState = 'in_stock' | 'low' | 'out';

export interface ColorStock {
  variant: Local<Variant>;
  /** Σ of what is left on its rolls (never below 0 per roll). */
  remainingCm: number;
  /** Rolls with something left. */
  rollCount: number;
  state: ColorStockState;
}

export interface FabricStock {
  fabric: Local<Fabric>;
  colors: ColorStock[];
  remainingCm: number;
}

export interface RollView {
  roll: Local<Roll>;
  variant: Local<Variant> | undefined;
  fabric: Local<Fabric> | undefined;
  purchase: Local<Purchase> | undefined;
  /** History order (creation time, then id), as costed. */
  moves: Local<StockMove>[];
  ledger: RollLedger;
  state: RollState;
}

const ROLL_CODE = /^R-[A-Z]{1,3}\d{4,6}$/;

/** Map.groupBy (ES2024; the project targets ES2023). */
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

function historyOrder(a: Local<StockMove>, b: Local<StockMove>): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Stock (SPEC §14.2, BUILD_PROMPTS 3.3): what is left per fabric and colour, each roll's history
 * and costs, and the stock actions (loss, stocktake, measurement, remnant). Every figure comes
 * from @fabric/core through the moves; nothing is stored as an editable number.
 */
export class InventoryRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly rolls: RollsTable,
    private readonly fabrics: FabricsRepository,
    private readonly settings: SettingsRepository,
  ) {}

  /** Fabrics with their colours and what is left; `rollMatch` when the search is a roll code. */
  async overview(search = ''): Promise<{ fabrics: FabricStock[]; rollMatch: Local<Roll> | null }> {
    const { db } = this.store;
    const [fabrics, variants, rolls, moves] = await Promise.all([
      db.fabrics.toArray(),
      db.variants.toArray(),
      db.rolls.toArray(),
      db.stockMoves.toArray(),
    ]);
    const movesByRoll = groupBy(moves, (move) => move.rollId);
    const remaining = new Map(
      rolls.map((roll) => [
        roll.id,
        rollLedgerOf(roll, movesByRoll.get(roll.id) ?? []).remainingCm,
      ]),
    );
    const rollsByVariant = groupBy(rolls, (roll) => roll.variantId);
    const code = search.trim().toUpperCase();
    const rollMatch = ROLL_CODE.test(code)
      ? (rolls.find((roll) => roll.shortCode === code) ?? null)
      : null;

    const stock = fabrics
      .filter((fabric) => fabric.voidedAt === null)
      .map((fabric) => {
        const colors = variants
          .filter((variant) => variant.fabricId === fabric.id && variant.voidedAt === null)
          .map((variant): ColorStock => {
            const left = (rollsByVariant.get(variant.id) ?? [])
              .map((roll) => remaining.get(roll.id) ?? 0)
              .filter((cm) => cm > 0);
            const remainingCm = left.reduce((sum, cm) => sum + cm, 0);
            const state: ColorStockState =
              remainingCm === 0
                ? 'out'
                : remainingCm <= variant.lowStockThresholdCm
                  ? 'low'
                  : 'in_stock';
            return { variant, remainingCm, rollCount: left.length, state };
          })
          .sort((a, b) => a.variant.colorName.localeCompare(b.variant.colorName, 'ar'));
        return {
          fabric,
          colors,
          remainingCm: colors.reduce((sum, color) => sum + color.remainingCm, 0),
        };
      })
      .filter(({ fabric, colors }) =>
        matchesSearch(search, [
          fabric.name,
          fabric.type,
          ...fabric.tags,
          ...colors.map((color) => color.variant.colorName),
        ]),
      )
      .sort((a, b) => a.fabric.name.localeCompare(b.fabric.name, 'ar'));
    return { fabrics: rollMatch ? [] : stock, rollMatch };
  }

  /** The colour's rolls, those with something left first. */
  async rollsOfColor(variantId: string): Promise<RollView[]> {
    const rolls = await this.store.db.rolls.where('variantId').equals(variantId).toArray();
    const views = await Promise.all(rolls.map((roll) => this.viewOf(roll)));
    return views.sort(
      (a, b) =>
        Number(a.state === 'empty') - Number(b.state === 'empty') ||
        a.roll.shortCode.localeCompare(b.roll.shortCode),
    );
  }

  async roll(id: string): Promise<RollView | undefined> {
    const roll = await this.store.db.rolls.get(id);
    return roll ? this.viewOf(roll) : undefined;
  }

  /**
   * Records a loss, a stocktake count or a measurement as an append-only stock move (and its
   * outbox op). A measurement of a kg roll also updates the fabric's est_cm_per_kg (C11).
   */
  async record(input: NewStockMoveInput): Promise<string> {
    const parsed = parseOrThrow(newStockMoveSchema, input);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    const id = crypto.randomUUID();
    // A measurement of a kg roll: the fabric's estimate is updated after the move is saved.
    const measured = await db.transaction('rw', [db.rolls, db.stockMoves, db.outbox], async () => {
      const roll = await db.rolls.get(parsed.rollId);
      if (!roll) throw new Error(`No roll ${parsed.rollId}`);
      const moves = await db.stockMoves.where('rollId').equals(roll.id).toArray();
      const ledger = rollLedgerOf(roll, moves);
      const built = buildStockMove(parsed, ledger, { id, deviceId, now });
      if (!built.ok) throw new ValidationError(built.issues);
      await db.stockMoves.put({ ...built.move, serverSeq: null });
      await db.outbox.add({
        opId: crypto.randomUUID(),
        entity: 'stock_move',
        entityId: id,
        kind: 'append',
        payload: built.move,
        deviceId,
        clientTs: now,
        baseServerSeq: null,
        state: 'pending',
        error: null,
      });
      return built.move.type === 'length_correction' && roll.lengthEstimated
        ? { roll, totalCm: ledger.basisLengthCm + built.move.deltaCm }
        : null;
    });
    this.store.changed();
    if (measured) await this.updateFabricEstimate(measured);
    return id;
  }

  /** Marks a roll as a remnant by hand (or clears the mark); below the threshold it is one anyway. */
  setRemnant(rollId: string, marked: boolean): Promise<void> {
    return this.rolls.setStatus(rollId, marked ? 'remnant' : 'active');
  }

  private async viewOf(roll: Local<Roll>): Promise<RollView> {
    const { db } = this.store;
    const [moves, variant, purchase, threshold] = await Promise.all([
      db.stockMoves.where('rollId').equals(roll.id).toArray(),
      db.variants.get(roll.variantId),
      db.purchases.get(roll.purchaseId),
      this.settings.get('remnant_threshold_cm', shopToday()),
    ]);
    const fabric = variant ? await db.fabrics.get(variant.fabricId) : undefined;
    const ledger = rollLedgerOf(roll, moves);
    return {
      roll,
      variant,
      fabric,
      purchase,
      moves: moves.sort(historyOrder),
      ledger,
      state: rollState(ledger.remainingCm, roll.status === 'remnant', threshold),
    };
  }

  private async updateFabricEstimate({
    roll,
    totalCm,
  }: {
    roll: Local<Roll>;
    totalCm: number;
  }): Promise<void> {
    const { db } = this.store;
    const [variant, purchase] = await Promise.all([
      db.variants.get(roll.variantId),
      db.purchases.get(roll.purchaseId),
    ]);
    const fabric = variant ? await db.fabrics.get(variant.fabricId) : undefined;
    if (!fabric || purchase?.weightG == null) return;
    // Earlier measurements of this fabric's kg rolls (C11: the first replaces the initial guess).
    const variantIds = (await db.variants.where('fabricId').equals(fabric.id).toArray()).map(
      (v) => v.id,
    );
    const kgRolls = (await db.rolls.where('variantId').anyOf(variantIds).toArray()).filter(
      (other) => other.lengthEstimated && other.id !== roll.id,
    );
    let measurementsSoFar = 0;
    for (const other of kgRolls) {
      const corrected = await db.stockMoves
        .where('rollId')
        .equals(other.id)
        .filter((move) => move.type === 'length_correction')
        .count();
      if (corrected > 0) measurementsSoFar += 1;
    }
    const estCmPerKg = nextFabricEstimate({
      policy: await this.settings.get('est_cm_per_kg_policy', shopToday()),
      current: fabric.estCmPerKg,
      measurementsSoFar,
      measuredTotalCm: totalCm,
      weightG: purchase.weightG,
    });
    if (estCmPerKg === fabric.estCmPerKg) return;
    await this.fabrics.save(
      {
        name: fabric.name,
        type: fabric.type,
        defaultSupplierId: fabric.defaultSupplierId,
        refPricePerMeterCents: fabric.refPricePerMeterCents,
        minPricePerMeterCents: fabric.minPricePerMeterCents,
        estCmPerKg,
        sellableAsPiece: fabric.sellableAsPiece,
        piecePriceCents: fabric.piecePriceCents,
        tags: fabric.tags,
        notes: fabric.notes,
      },
      fabric.id,
    );
  }
}
