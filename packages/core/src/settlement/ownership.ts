import { assertInteger, BASIS_POINTS_PER_WHOLE, splitByWeights } from '../numeric/index.js';

/** partner.ownership_bp and partner.is_owner (SPEC §6, §13). */
export interface PartnerOwnership {
  partnerId: string;
  /** 5000 = 50%. The two partners add up to 10000. */
  ownershipBp: number;
  /** The owner (the user) gets the owner share; the other partner gets the partner share. */
  isOwner: boolean;
}

/** Checks the two partners of SPEC §6 and returns them owner first. */
export function ownerAndPartner(
  partners: readonly PartnerOwnership[],
): [owner: PartnerOwnership, partner: PartnerOwnership] {
  const [first, second, ...rest] = partners;
  if (!first || !second || rest.length > 0) {
    throw new RangeError(`expected exactly two partners, got ${String(partners.length)}`);
  }
  if (first.isOwner === second.isOwner) {
    throw new RangeError('exactly one partner must be the owner');
  }
  if (first.partnerId === second.partnerId) throw new RangeError('partner ids must differ');
  for (const { partnerId, ownershipBp } of partners) {
    assertInteger(ownershipBp, `ownershipBp of ${partnerId}`, 0);
  }
  if (first.ownershipBp + second.ownershipBp !== BASIS_POINTS_PER_WHOLE) {
    throw new RangeError(
      `ownership must add up to ${String(BASIS_POINTS_PER_WHOLE)} bp, got ${String(first.ownershipBp + second.ownershipBp)}`,
    );
  }
  return first.isOwner ? [first, second] : [second, first];
}

/**
 * Splits an amount between the partners by ownership, exactly: largest remainder, and an odd
 * cent on an even split goes to the owner (S5). T10: 10000 at 50/50 → 5000/5000.
 */
export function splitByOwnership(
  amountCents: number,
  partners: readonly PartnerOwnership[],
): { partnerId: string; amountCents: number }[] {
  const [owner, partner] = ownerAndPartner(partners);
  const [ownerCents = 0, partnerCents = 0] = splitByWeights(amountCents, [
    owner.ownershipBp,
    partner.ownershipBp,
  ]);
  return [
    { partnerId: owner.partnerId, amountCents: ownerCents },
    { partnerId: partner.partnerId, amountCents: partnerCents },
  ];
}
