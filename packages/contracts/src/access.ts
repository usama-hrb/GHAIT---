import type { Role } from './auth.js';
import type { ValidationIssue } from './errors.js';
import type { SyncEntity, SyncOp } from './sync.js';

/**
 * What each role may see and change (SPEC §11, BUILD_PROMPTS 5.3, docs/accounting-assumptions.md
 * RL1–RL5). The API enforces it; the screens only hide what the API would refuse.
 *
 * - owner: everything.
 * - partner: reads everything, changes nothing (the AuthGuard refuses every write).
 * - cashier: sells and takes payments. It never receives a cost, a profit or any record of the
 *   partners' money, because the device keeps a copy of whatever the server sends it.
 */

export type ReadAccess = 'all' | 'redacted' | 'none';

export interface EntityAccess {
  /** What a pull sends: the record, the record without its cost (`redacted`), or nothing. */
  read: ReadAccess;
  /** The ops of this entity the role may push. */
  push: readonly SyncOp['kind'][];
}

const SEES: EntityAccess = { read: 'all', push: [] };
const NOTHING: EntityAccess = { read: 'none', push: [] };

/**
 * The cashier's view of every synced entity. A new entity must be listed here: the compiler
 * refuses the table without it, so nothing is exposed to the cashier by omission (RL2).
 */
export const CASHIER_ACCESS = {
  // The catalog and the stock: what is sold, at what price, how much is left. Costs are cut out.
  fabric: SEES,
  variant: SEES,
  // The picture of a colour, for its tile: the till shows it, only the owner sets it.
  photo: SEES,
  roll: { read: 'redacted', push: [] },
  stock_move: SEES,
  // Selling: a sale with its payment, customers and their payments.
  customer: { read: 'all', push: ['upsert'] },
  sale: { read: 'all', push: ['append'] },
  sale_line: SEES,
  payment: { read: 'all', push: ['append'] },
  payment_allocation: SEES,
  sale_void: SEES,
  sale_return: SEES,
  // Only the few settings the till needs.
  setting: { read: 'redacted', push: [] },
  // Everything about buying, debts to suppliers, expenses, partners, profit and zakat.
  supplier: NOTHING,
  purchase: NOTHING,
  supplier_payment: NOTHING,
  write_off: NOTHING,
  expense: NOTHING,
  recurring_expense: NOTHING,
  partner: NOTHING,
  capital_move: NOTHING,
  partner_draw: NOTHING,
  profit_split_rule: NOTHING,
  settlement: NOTHING,
  settlement_share: NOTHING,
  locked_cost: NOTHING,
  cash_adjustment: NOTHING,
  zakat_report: NOTHING,
  sync_conflict: NOTHING,
} as const satisfies Record<SyncEntity, EntityAccess>;

/** The settings a cashier's device receives (RL1). */
export const CASHIER_SETTING_KEYS: readonly string[] = [
  'money_display_unit',
  'shop_name',
  'remnant_threshold_cm',
];

/**
 * Whether `role` sees what a roll cost, what a sale earned and the shop's profit (SPEC §11): the
 * owner and the partner do; a cashier does not. Screens use it to leave those figures out; the
 * API's refusal (above) is what keeps them from the cashier's device.
 */
export function mayReadCosts(role: Role): boolean {
  return role !== 'cashier';
}

/** Whether a device signed in as `role` is sent records of `entity`. */
export function mayRead(role: Role, entity: SyncEntity): boolean {
  return role !== 'cashier' || CASHIER_ACCESS[entity].read !== 'none';
}

/** Whether `role` may push an op of this kind on `entity`. */
export function mayPush(role: Role, entity: SyncEntity, kind: SyncOp['kind']): boolean {
  if (role === 'owner') return true;
  if (role === 'partner') return false;
  return (CASHIER_ACCESS[entity].push as readonly SyncOp['kind'][]).includes(kind);
}

/**
 * A record as `role` may receive it, or null when it must not be sent at all. A cashier gets no
 * roll cost (the length and the rest are all the till needs) and only its settings (RL1).
 */
export function redactForRole<R extends object>(
  role: Role,
  entity: SyncEntity,
  record: R,
): R | null {
  if (role !== 'cashier') return record;
  const access = CASHIER_ACCESS[entity];
  if (access.read === 'none') return null;
  if (access.read === 'all') return record;
  if (entity === 'roll') return { ...record, costTotalCents: 0 };
  if (entity === 'setting') {
    const key = (record as { key?: unknown }).key;
    return typeof key === 'string' && CASHIER_SETTING_KEYS.includes(key) ? record : null;
  }
  return null;
}

export const ACCESS_ISSUES = {
  belowCostByCashier: 'cashier_cannot_confirm_below_cost',
  refundByCashier: 'cashier_cannot_refund',
} as const;

/**
 * What a cashier may not put inside an op they are otherwise allowed to push (RL3): confirming
 * a sale under cost is the owner's decision, and cash does not leave the till as a refund.
 */
export function cashierPushIssues(entity: SyncEntity, payload: unknown): ValidationIssue[] {
  const issue = (path: (string | number)[], message: string): ValidationIssue[] => [
    { path, message, code: 'custom' },
  ];
  if (entity === 'sale') {
    const sale = (payload as { sale?: { confirmedBelowCost?: unknown } } | null)?.sale;
    if (sale?.confirmedBelowCost === true) {
      return issue(['sale', 'confirmedBelowCost'], ACCESS_ISSUES.belowCostByCashier);
    }
  }
  if (entity === 'payment') {
    const payment = (payload as { payment?: { kind?: unknown } } | null)?.payment;
    if (payment?.kind !== 'payment')
      return issue(['payment', 'kind'], ACCESS_ISSUES.refundByCashier);
  }
  return [];
}
