import { CM_PER_METER } from '../length/index.js';
import { applyBasisPoints, assertInteger, mulDivRoundHalfUp } from '../numeric/index.js';

/*
 * ┌──────────────────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS A CALCULATION TOOL, NOT A FATWA (SPEC §10).                                  │
 * │ Every rule below is a setting that the owner chooses from the scholarly opinion they │
 * │ follow (Morocco, Maliki school by default). The defaults are provisional until they  │
 * │ are reviewed with a trusted scholar (SPEC §17.1). Never present the result as a      │
 * │ religious ruling.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────────────────┘
 */

/** 2.5% of the zakat base. */
export const ZAKAT_RATE_BP = 250;

/** The nisab as a weight of metal (SPEC §10): 85 g of gold, or 595 g of silver. */
export const NISAB_GRAMS = { gold: 85, silver: 595 } as const;

/** SPEC §10 [قابل للإعداد]: stored in the `setting` table, snapshotted with each report. */
export interface ZakatSettings {
  /** The metal the nisab is measured in. Default gold. */
  nisabMetal: keyof typeof NISAB_GRAMS;
  /** Goods at their market (reference) price, or at cost. Default market. */
  goodsValuation: 'market' | 'cost';
  /** Doubtful customer debts are listed apart; the owner decides whether they count. Default no. */
  includeDoubtfulDebts: boolean;
}

export const DEFAULT_ZAKAT_SETTINGS: Readonly<ZakatSettings> = {
  nisabMetal: 'gold',
  goodsValuation: 'market',
  includeDoubtfulDebts: false,
};

/** One roll still in stock on the hawl date. Furniture, equipment and rent are never goods. */
export interface ZakatGoodsItem {
  rollId: string;
  remainingCm: number;
  /** The fabric's (or variant's) reference price on the hawl date. */
  refPricePerMeterCents: number;
  /** Its stock value at cost (unallocatedCostCents). */
  costCents: number;
}

/** What a customer owes on the hawl date (customerBalance, when positive). */
export interface ZakatReceivable {
  customerId: string;
  amountCents: number;
  doubtful: boolean;
}

/** The shop's position on the hawl date, as gathered by the app (BUILD_PROMPTS 5.1). */
export interface ZakatSnapshot {
  /** A lunar year has passed since the last hawl (the app computes it on the Hijri calendar). */
  hawlCompleted: boolean;
  goods: readonly ZakatGoodsItem[];
  cashCents: number;
  receivables: readonly ZakatReceivable[];
  /** Debts the shop owes now: suppliers, customer credits, others. */
  debtsDueCents: number;
  /** Entered by hand with its date (SPEC §10). Required for the chosen nisab metal. */
  goldPricePerGramCents?: number;
  silverPricePerGramCents?: number;
}

export interface ZakatResult {
  /** Each roll's value under the chosen valuation, for the report. */
  goods: { rollId: string; valueCents: number }[];
  goodsCents: number;
  cashCents: number;
  /** Receivables in the base: the expected ones, plus the doubtful ones if the setting says so. */
  receivablesCents: number;
  /** Doubtful receivables, shown apart whether or not they count. */
  doubtfulReceivablesCents: number;
  debtsDueCents: number;
  /** goods + cash + receivables − debts due; may be negative. */
  baseCents: number;
  nisabCents: number;
  reachesNisab: boolean;
  hawlCompleted: boolean;
  /** base × 2.5%, rounded half up, when the nisab is reached and the hawl completed; else 0. */
  zakatDueCents: number;
  settings: ZakatSettings;
}

/**
 * Zakat on trade goods for a managing merchant ("مدير", SPEC §10, T14):
 * base = goods + cash + receivables expected to be collected − debts due on the shop,
 * zakat = base × 2.5% if the base reaches the nisab and the hawl has passed.
 * The shop's third is capital and is already inside the base. Who bears it (each partner by
 * ownership) and recording its payment are BUILD_PROMPTS 5.1.
 */
export function computeZakat(
  snapshot: ZakatSnapshot,
  settings: ZakatSettings = DEFAULT_ZAKAT_SETTINGS,
): ZakatResult {
  assertInteger(snapshot.cashCents, 'cashCents', 0);
  assertInteger(snapshot.debtsDueCents, 'debtsDueCents', 0);

  const goods = snapshot.goods.map((item) => {
    assertInteger(item.remainingCm, `remainingCm of ${item.rollId}`, 0);
    assertInteger(item.refPricePerMeterCents, `refPricePerMeterCents of ${item.rollId}`, 0);
    assertInteger(item.costCents, `costCents of ${item.rollId}`, 0);
    const valueCents =
      settings.goodsValuation === 'market'
        ? mulDivRoundHalfUp(item.refPricePerMeterCents, item.remainingCm, CM_PER_METER)
        : item.costCents;
    return { rollId: item.rollId, valueCents };
  });
  const goodsCents = goods.reduce((sum, item) => sum + item.valueCents, 0);

  let expected = 0;
  let doubtful = 0;
  for (const receivable of snapshot.receivables) {
    assertInteger(receivable.amountCents, `receivable of ${receivable.customerId}`, 1);
    if (receivable.doubtful) doubtful += receivable.amountCents;
    else expected += receivable.amountCents;
  }
  const receivablesCents = settings.includeDoubtfulDebts ? expected + doubtful : expected;

  const pricePerGram =
    settings.nisabMetal === 'gold'
      ? snapshot.goldPricePerGramCents
      : snapshot.silverPricePerGramCents;
  if (pricePerGram === undefined) {
    throw new RangeError(`a ${settings.nisabMetal} price is needed for the nisab`);
  }
  assertInteger(pricePerGram, `${settings.nisabMetal}PricePerGramCents`, 1);
  const nisabCents = NISAB_GRAMS[settings.nisabMetal] * pricePerGram;
  assertInteger(nisabCents, 'nisabCents');

  const baseCents = goodsCents + snapshot.cashCents + receivablesCents - snapshot.debtsDueCents;
  assertInteger(baseCents, 'baseCents');
  const reachesNisab = baseCents >= nisabCents;
  const zakatDueCents =
    reachesNisab && snapshot.hawlCompleted ? applyBasisPoints(baseCents, ZAKAT_RATE_BP) : 0;

  return {
    goods,
    goodsCents,
    cashCents: snapshot.cashCents,
    receivablesCents,
    doubtfulReceivablesCents: doubtful,
    debtsDueCents: snapshot.debtsDueCents,
    baseCents,
    nisabCents,
    reachesNisab,
    hawlCompleted: snapshot.hawlCompleted,
    zakatDueCents,
    settings: { ...settings },
  };
}
