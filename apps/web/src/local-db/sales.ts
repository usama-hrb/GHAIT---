import {
  buildSaleAggregate,
  buildSaleVoid,
  checkSaleAggregate,
  checkSaleVoid,
  type Customer,
  type Fabric,
  type NewSaleInput,
  newSaleSchema,
  type PricedSale,
  priceSale,
  type Roll,
  rollLedgerOf,
  type Sale,
  type SaleFigures,
  saleFigures,
  type SaleLine,
  type SaleVoid,
  type StockMove,
  type Variant,
  voidPayloadSchema,
  type WriteOff,
} from '@fabric/contracts';
import {
  amountDueCents,
  proposeRolls,
  type RollLedger,
  type RollState,
  rollState,
  rollsOldestFirst,
  type RollTake,
} from '@fabric/core';
import { shopToday } from '@/shared/lib/dates';
import type { Local, ShopDatabase } from './db';
import { parseOrThrow, ValidationError } from './errors';
import type { LocalStore } from './store';
import type { SettingsRepository } from './tables';

/** A roll of a colour as the POS offers it. */
export interface RollChoice {
  roll: Local<Roll>;
  ledger: RollLedger;
  state: RollState;
  purchaseDate: string;
  /** Nothing taken off yet: a ready piece can still be sold whole (P5). */
  untouched: boolean;
}

export interface SaleLineView {
  line: Local<SaleLine>;
  roll: Local<Roll> | undefined;
  variant: Local<Variant> | undefined;
  fabric: Local<Fabric> | undefined;
  figures: SaleFigures['lines'][number] | undefined;
}

export interface SaleView {
  sale: Local<Sale>;
  customer: Local<Customer> | undefined;
  lines: SaleLineView[];
  figures: SaleFigures;
  saleVoid: Local<SaleVoid> | undefined;
  /** Written off as a bad debt (SPEC §4.1). */
  writeOff: Local<WriteOff> | undefined;
}

export interface SaleSummary {
  sale: Local<Sale>;
  customerName: string | null;
  lineCount: number;
  dueCents: number;
}

const newest = (a: Local<Sale>, b: Local<Sale>) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

interface LocalHistory {
  roll: Local<Roll>;
  moves: Local<StockMove>[];
}

async function historiesOf(
  db: ShopDatabase,
  rollIds: readonly string[],
): Promise<Map<string, LocalHistory>> {
  const ids = [...new Set(rollIds)];
  const [rolls, moves] = await Promise.all([
    db.rolls.bulkGet(ids),
    db.stockMoves.where('rollId').anyOf(ids).toArray(),
  ]);
  const histories = new Map<string, LocalHistory>();
  for (const roll of rolls) {
    if (roll) histories.set(roll.id, { roll, moves: moves.filter((m) => m.rollId === roll.id) });
  }
  return histories;
}

/**
 * Sales at the counter (SPEC §3, §4). A sale is saved with its lines, stock moves and the cash
 * paid there, and one outbox op, in one local transaction; the server prices it again with the
 * same functions (buildSaleAggregate → @fabric/core computeSaleLine). A void is its own op.
 */
export class SalesRepository {
  constructor(
    private readonly store: LocalStore,
    private readonly settings: SettingsRepository,
  ) {}

  /** The colour's rolls that still have cloth, oldest purchase first (as proposeRolls takes them). */
  async rollsOfColor(variantId: string): Promise<RollChoice[]> {
    const { db } = this.store;
    const rolls = await db.rolls.where('variantId').equals(variantId).toArray();
    const [histories, purchases, threshold] = await Promise.all([
      historiesOf(
        db,
        rolls.map((roll) => roll.id),
      ),
      db.purchases.bulkGet([...new Set(rolls.map((roll) => roll.purchaseId))]),
      this.settings.get('remnant_threshold_cm', shopToday()),
    ]);
    const dateOf = new Map(
      purchases.flatMap((purchase) => (purchase ? [[purchase.id, purchase.date] as const] : [])),
    );
    const choices = rolls.flatMap((roll): RollChoice[] => {
      const history = histories.get(roll.id);
      if (!history) return [];
      const ledger = rollLedgerOf(roll, history.moves);
      if (ledger.remainingCm <= 0) return [];
      return [
        {
          roll,
          ledger,
          state: rollState(ledger.remainingCm, roll.status === 'remnant', threshold),
          purchaseDate: dateOf.get(roll.purchaseId) ?? roll.createdAt.slice(0, 10),
          untouched: ledger.remainingCm === ledger.basisLengthCm && ledger.costs.length === 0,
        },
      ];
    });
    const byId = new Map(choices.map((choice) => [choice.roll.id, choice]));
    return rollsOldestFirst(choices.map(onHand)).flatMap((roll) => {
      const choice = byId.get(roll.id);
      return choice ? [choice] : [];
    });
  }

  /** Which rolls a length of this colour takes (SPEC §4, P11); `taken` is already in the cart. */
  async propose(
    variantId: string,
    wantedCm: number,
    taken: ReadonlyMap<string, number> = new Map(),
  ): Promise<{ takes: (RollTake & { choice: RollChoice })[]; shortCm: number }> {
    const choices = await this.rollsOfColor(variantId);
    const byId = new Map(choices.map((choice) => [choice.roll.id, choice]));
    const proposal = proposeRolls(
      choices.map((choice) => ({
        ...onHand(choice),
        remainingCm: choice.ledger.remainingCm - (taken.get(choice.roll.id) ?? 0),
      })),
      wantedCm,
    );
    return {
      takes: proposal.takes.flatMap((take) => {
        const choice = byId.get(take.rollId);
        return choice ? [{ ...take, choice }] : [];
      }),
      shortCm: proposal.shortCm,
    };
  }

  /** The sale priced on the rolls as they are on this device (live POS figures and warnings). */
  async preview(input: NewSaleInput): Promise<PricedSale> {
    const parsed = parseOrThrow(newSaleSchema, input);
    const histories = await historiesOf(
      this.store.db,
      parsed.lines.map((line) => line.rollId),
    );
    return priceSale(parsed, histories);
  }

  /** Saves the sale; throws ValidationError when it is invalid or unconfirmed under cost. */
  async create(input: NewSaleInput): Promise<string> {
    const parsed = parseOrThrow(newSaleSchema, input);
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    const saleId = crypto.randomUUID();
    await db.transaction(
      'rw',
      [
        db.rolls,
        db.stockMoves,
        db.sales,
        db.saleLines,
        db.payments,
        db.paymentAllocations,
        db.outbox,
      ],
      async () => {
        const histories = await historiesOf(
          db,
          parsed.lines.map((line) => line.rollId),
        );
        const built = buildSaleAggregate(
          parsed,
          histories,
          {
            saleId,
            lineIds: parsed.lines.map(() => crypto.randomUUID()),
            moveIds: parsed.lines.map(() => crypto.randomUUID()),
            paymentId: crypto.randomUUID(),
            allocationId: crypto.randomUUID(),
          },
          { deviceId, now },
        );
        if (!built.ok) throw new ValidationError(built.issues);
        const { aggregate } = built;
        // The server's own check, here too: a bug shows up before it reaches the outbox.
        const issues = checkSaleAggregate(aggregate, histories);
        if (issues.length > 0) throw new ValidationError(issues);
        await db.sales.put({ ...aggregate.sale, serverSeq: null });
        await db.saleLines.bulkPut(aggregate.lines.map((line) => ({ ...line, serverSeq: null })));
        await db.stockMoves.bulkPut(aggregate.moves.map((move) => ({ ...move, serverSeq: null })));
        if (aggregate.payment) await db.payments.put({ ...aggregate.payment, serverSeq: null });
        if (aggregate.allocation) {
          await db.paymentAllocations.put({ ...aggregate.allocation, serverSeq: null });
        }
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'sale',
          entityId: saleId,
          kind: 'append',
          payload: aggregate,
          deviceId,
          clientTs: now,
          baseServerSeq: null,
          state: 'pending',
          error: null,
        });
      },
    );
    this.store.changed();
    return saleId;
  }

  /**
   * Cancels a sale (P13): its cloth goes back on the rolls (a reversal per line) and what was
   * paid on it is refunded. The reason is required and goes to the audit log.
   */
  async voidSale(saleId: string, reason: string): Promise<void> {
    const payload = parseOrThrow(voidPayloadSchema, { reason });
    const { db } = this.store;
    const deviceId = await this.store.deviceId();
    const now = this.store.now().toISOString();
    await db.transaction(
      'rw',
      [
        db.sales,
        db.saleLines,
        db.stockMoves,
        db.payments,
        db.paymentAllocations,
        db.saleVoids,
        db.outbox,
      ],
      async () => {
        const sale = await db.sales.get(saleId);
        if (!sale) throw new Error(`No sale ${saleId}`);
        if (sale.voidedAt !== null) return;
        const lineIds = (await db.saleLines.where('saleId').equals(saleId).toArray()).map(
          (line) => line.id,
        );
        const moves = (await db.stockMoves.where('refId').anyOf(lineIds).toArray()).filter(
          (move) => move.type === 'sale',
        );
        const records = {
          sale,
          moves,
          allocations: await db.paymentAllocations.where('saleId').equals(saleId).toArray(),
        };
        const aggregate = buildSaleVoid(
          { reason: payload.reason, date: shopToday(this.store.now()) },
          records,
          {
            voidId: crypto.randomUUID(),
            reversalIds: moves.map(() => crypto.randomUUID()),
            refundId: crypto.randomUUID(),
          },
          { deviceId, now },
        );
        const issues = checkSaleVoid(aggregate, records);
        if (issues.length > 0) throw new ValidationError(issues);
        await db.saleVoids.put({ ...aggregate.saleVoid, serverSeq: null });
        await db.stockMoves.bulkPut(
          aggregate.reversals.map((move) => ({ ...move, serverSeq: null })),
        );
        if (aggregate.refund) await db.payments.put({ ...aggregate.refund, serverSeq: null });
        await db.sales.put({ ...sale, voidedAt: now, updatedAt: now, deviceId });
        await db.outbox.add({
          opId: crypto.randomUUID(),
          entity: 'sale_void',
          entityId: aggregate.saleVoid.id,
          kind: 'append',
          payload: aggregate,
          deviceId,
          clientTs: now,
          baseServerSeq: null,
          state: 'pending',
          error: null,
        });
      },
    );
    this.store.changed();
  }

  async get(id: string): Promise<SaleView | undefined> {
    const { db } = this.store;
    const sale = await db.sales.get(id);
    if (!sale) return undefined;
    // Entry order once synced (the server numbers them in order); by id until then.
    const unsynced = Number.MAX_SAFE_INTEGER;
    const lines = (await db.saleLines.where('saleId').equals(id).toArray()).sort(
      (a, b) => (a.serverSeq ?? unsynced) - (b.serverSeq ?? unsynced) || a.id.localeCompare(b.id),
    );
    const rollIds = lines.map((line) => line.rollId);
    const [histories, allocations, saleVoid, customer, moves, writeOff] = await Promise.all([
      historiesOf(db, rollIds),
      db.paymentAllocations.where('saleId').equals(id).toArray(),
      db.saleVoids.where('saleId').equals(id).first(),
      sale.customerId ? db.customers.get(sale.customerId) : undefined,
      db.stockMoves
        .where('refId')
        .anyOf(lines.map((line) => line.id))
        .toArray(),
      db.writeOffs.where('saleId').equals(id).first(),
    ]);
    const ledgers = new Map(
      [...histories].map(([rollId, history]) => [
        rollId,
        rollLedgerOf(history.roll, history.moves),
      ]),
    );
    const figures = saleFigures(
      sale,
      lines,
      moves.filter((move) => move.type === 'sale'),
      ledgers,
      allocations,
    );
    const variants = await db.variants.bulkGet(
      lines.map((line) => histories.get(line.rollId)?.roll.variantId ?? ''),
    );
    const fabrics = await db.fabrics.bulkGet(variants.map((variant) => variant?.fabricId ?? ''));
    return {
      sale,
      customer,
      lines: lines.map((line, index) => ({
        line,
        roll: histories.get(line.rollId)?.roll,
        variant: variants[index],
        fabric: fabrics[index],
        figures: figures.lines.find((entry) => entry.lineId === line.id),
      })),
      figures,
      saleVoid,
      writeOff,
    };
  }

  /** Newest first, with the customer's name and what is still due. */
  async list(): Promise<SaleSummary[]> {
    const { db } = this.store;
    const [sales, lines, allocations, customers] = await Promise.all([
      db.sales.toArray(),
      db.saleLines.toArray(),
      db.paymentAllocations.toArray(),
      db.customers.toArray(),
    ]);
    const customerName = new Map(customers.map((customer) => [customer.id, customer.name]));
    return sales.sort(newest).map((sale) => ({
      sale,
      customerName: sale.customerId ? (customerName.get(sale.customerId) ?? null) : null,
      lineCount: lines.filter((line) => line.saleId === sale.id).length,
      dueCents:
        sale.voidedAt === null
          ? amountDueCents(
              sale.totalCents,
              allocations.filter((a) => a.saleId === sale.id).map((a) => a.amountCents),
            )
          : 0,
    }));
  }
}

function onHand(choice: RollChoice) {
  return {
    id: choice.roll.id,
    remainingCm: choice.ledger.remainingCm,
    purchaseDate: choice.purchaseDate,
    createdAt: choice.roll.createdAt,
    shortCode: choice.roll.shortCode,
  };
}
