import { type PartnerAccount, partnerAccount } from '@fabric/core';
import { z } from 'zod';
import { recordBaseSchema } from './catalog.js';
import { amountCentsSchema, idSchema, isoDateSchema, optionalTextSchema } from './common.js';
import type { ValidationIssue } from './errors.js';

const partnerFields = z.object({
  name: z.string().trim().min(1).max(80),
  /** 5000 = 50% (SPEC §6). The owner and the partners add up to 10000 (S4). */
  ownershipBp: z.int().min(0).max(10_000),
  /** The owner is the user, and there is one; every other partner gets a partner's share (SPEC §6). */
  isOwner: z.boolean(),
  /** How to reach them. */
  phone: optionalTextSchema(40).default(null),
  /** What they are to the shop, in the owner's words ("managing partner", "silent partner"). */
  title: optionalTextSchema(60).default(null),
  /** The day they became a partner. */
  startDate: isoDateSchema.nullable().default(null),
  notes: optionalTextSchema(1000).default(null),
});

/** SPEC §13 `partner`. */
export const partnerInputSchema = partnerFields;
export type PartnerInput = z.input<typeof partnerInputSchema>;
export const partnerSchema = recordBaseSchema.extend(partnerFields.shape);
export type Partner = z.output<typeof partnerSchema>;

export const CAPITAL_MOVE_TYPES = ['contribution', 'retained_profit', 'withdrawal'] as const;

/**
 * SPEC §13 `capital_move`: positive for a contribution or retained profit, negative for a
 * withdrawal (SPEC §8.4). Created, or voided with a reason; never edited (PA3).
 */
export const capitalMoveSchema = recordBaseSchema.extend({
  partnerId: idSchema,
  type: z.enum(CAPITAL_MOVE_TYPES),
  amountCents: z.int(),
  date: isoDateSchema,
  note: optionalTextSchema(500),
  /** The settlement that kept this retained profit (BUILD_PROMPTS 4.3); null for the rest. */
  settlementId: idSchema.nullable().default(null),
});
export type CapitalMove = z.output<typeof capitalMoveSchema>;

/** SPEC §13 `partner_draw`: a partner taking profit, with a reason (SPEC §8.4). Created or voided. */
export const partnerDrawSchema = recordBaseSchema.extend({
  partnerId: idSchema,
  amountCents: amountCentsSchema.min(1),
  date: isoDateSchema,
  reason: z.string().trim().min(1).max(500),
  /** The zakat report this draw pays, the partner's part by ownership (BUILD_PROMPTS 5.1, Z7). */
  zakatReportId: idSchema.nullable().default(null),
});
export type PartnerDraw = z.output<typeof partnerDrawSchema>;

/** What the owner enters: money a partner puts in, or (rarely) takes back (SPEC §8.4). */
export const newCapitalMoveSchema = z
  .object({
    partnerId: idSchema,
    kind: z.enum(['contribution', 'withdrawal']),
    amountCents: amountCentsSchema.min(1),
    date: isoDateSchema,
    note: optionalTextSchema(500).default(null),
  })
  .superRefine((input, context) => {
    if (input.kind === 'withdrawal' && input.note === null) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'capital_withdrawal_reason_required',
      });
    }
  });
export type NewCapitalMove = z.output<typeof newCapitalMoveSchema>;
export type NewCapitalMoveInput = z.input<typeof newCapitalMoveSchema>;

export const newPartnerDrawSchema = z.object({
  partnerId: idSchema,
  amountCents: amountCentsSchema.min(1),
  date: isoDateSchema,
  reason: z.string().trim().min(1).max(500),
});
export type NewPartnerDrawInput = z.input<typeof newPartnerDrawSchema>;

export const PARTNER_ISSUES = {
  retainedByHand: 'capital_retained_profit_from_settlement_only',
  wrongSign: 'capital_move_wrong_sign',
  reasonRequired: 'capital_withdrawal_reason_required',
  fixed: 'partner_money_record_is_fixed',
  /** S4, S17: there is one owner. */
  secondOwner: 'partner_second_owner',
  /** The owner stays the owner, and a partner never becomes the owner. */
  ownerFixed: 'partner_owner_flag_fixed',
  /** Everyone's part of the shop adds up to 100%, never more (S4). */
  ownershipOver: 'partner_ownership_over_100',
  /** The owner's table is saved whole, and it adds up to exactly 100% (S4). */
  ownershipShort: 'partner_ownership_under_100',
  /** The table has to include the owner. */
  noOwner: 'partner_owner_missing',
} as const;

/**
 * The table of participants as the owner saves it, whole (the "Partners" form): exactly one owner,
 * and the parts everyone owns add up to exactly 100% (S4). A single record is checked by
 * checkPartnerWrite, which only refuses more than 100% so a shop can be changed record by record.
 */
export function checkPartnerSet(
  partners: readonly Pick<Partner, 'isOwner' | 'ownershipBp' | 'voidedAt'>[],
): ValidationIssue[] {
  const issue = (path: string, message: string) => [{ path: [path], message, code: 'custom' }];
  const people = partners.filter(({ voidedAt }) => voidedAt === null);
  const owners = people.filter(({ isOwner }) => isOwner).length;
  if (owners === 0) return issue('isOwner', PARTNER_ISSUES.noOwner);
  if (owners > 1) return issue('isOwner', PARTNER_ISSUES.secondOwner);
  const total = people.reduce((sum, { ownershipBp }) => sum + ownershipBp, 0);
  if (total > 10_000) return issue('ownershipBp', PARTNER_ISSUES.ownershipOver);
  return total < 10_000 ? issue('ownershipBp', PARTNER_ISSUES.ownershipShort) : [];
}

/**
 * A partner record written (S4, S17): there is one owner and it stays that way, and the parts
 * everyone owns add up to at most 100%. A shop with several partners is changed record by record,
 * so the total may be short while it is being changed; the settlement asks for exactly 100%
 * (@fabric/core participantsOf).
 */
export function checkPartnerWrite(
  next: Pick<Partner, 'id' | 'isOwner' | 'ownershipBp' | 'voidedAt'>,
  current: Pick<Partner, 'isOwner'> | undefined,
  others: readonly Pick<Partner, 'id' | 'isOwner' | 'ownershipBp' | 'voidedAt'>[],
): ValidationIssue[] {
  const issue = (path: string, message: string) => [{ path: [path], message, code: 'custom' }];
  if (current && current.isOwner !== next.isOwner)
    return issue('isOwner', PARTNER_ISSUES.ownerFixed);
  if (next.voidedAt !== null) return [];
  const rest = others.filter((other) => other.id !== next.id && other.voidedAt === null);
  if (next.isOwner && rest.some((other) => other.isOwner)) {
    return issue('isOwner', PARTNER_ISSUES.secondOwner);
  }
  const total = rest.reduce((sum, other) => sum + other.ownershipBp, next.ownershipBp);
  return total > 10_000 ? issue('ownershipBp', PARTNER_ISSUES.ownershipOver) : [];
}

/** The capital_move a contribution or withdrawal records (withdrawals are negative). */
export function capitalMoveFields(
  input: NewCapitalMove,
): Omit<CapitalMove, keyof z.infer<typeof recordBaseSchema>> {
  return {
    partnerId: input.partnerId,
    type: input.kind,
    amountCents: input.kind === 'withdrawal' ? -input.amountCents : input.amountCents,
    date: input.date,
    note: input.note,
    settlementId: null,
  };
}

/**
 * Re-checks a capital move a device pushed: only contributions and withdrawals are entered by
 * hand (retained profit comes from a settlement, BUILD_PROMPTS 4.3), with the right sign, and a
 * withdrawal says why.
 */
export function checkCapitalMove(move: CapitalMove): ValidationIssue[] {
  const issue = (path: string, message: string) => [{ path: [path], message, code: 'custom' }];
  if (move.type === 'retained_profit') return issue('type', PARTNER_ISSUES.retainedByHand);
  if (move.settlementId !== null) return issue('settlementId', PARTNER_ISSUES.retainedByHand);
  if (move.type === 'contribution' ? move.amountCents <= 0 : move.amountCents >= 0) {
    return issue('amountCents', PARTNER_ISSUES.wrongSign);
  }
  if (move.type === 'withdrawal' && move.note === null)
    return issue('note', PARTNER_ISSUES.reasonRequired);
  return [];
}

/** Retained profit goes only with its settlement, when the period is unlocked (PA3). */
export function checkCapitalMoveVoid(move: CapitalMove): ValidationIssue[] {
  return move.type === 'retained_profit'
    ? [{ path: ['type'], message: PARTNER_ISSUES.retainedByHand, code: 'custom' }]
    : [];
}

/** A capital move, draw or cash count is never edited after it is recorded: only voided (PA3). */
export function checkUnchanged<R extends { id: string }>(
  current: R,
  next: R,
  fields: readonly (keyof R)[],
  message: string = PARTNER_ISSUES.fixed,
): ValidationIssue[] {
  const changed = fields.find(
    (field) => JSON.stringify(current[field]) !== JSON.stringify(next[field]),
  );
  return changed === undefined ? [] : [{ path: [String(changed)], message, code: 'custom' }];
}

/** A partner's account from their records (@fabric/core partnerAccount). */
export function partnerAccountOf(
  partnerId: string,
  records: {
    capitalMoves: readonly CapitalMove[];
    draws: readonly PartnerDraw[];
    /** Their settlement shares (BUILD_PROMPTS 4.3); none before the first settlement. */
    shares?: readonly { partnerId: string; amountCents: number; voided?: boolean }[];
  },
): PartnerAccount {
  return partnerAccount({
    capitalMoves: records.capitalMoves
      .filter((move) => move.partnerId === partnerId)
      .map((move) => ({
        type: move.type,
        amountCents: move.amountCents,
        voided: move.voidedAt !== null,
      })),
    shares: (records.shares ?? []).filter((share) => share.partnerId === partnerId),
    draws: records.draws
      .filter((draw) => draw.partnerId === partnerId)
      .map((draw) => ({ amountCents: draw.amountCents, voided: draw.voidedAt !== null })),
  });
}
