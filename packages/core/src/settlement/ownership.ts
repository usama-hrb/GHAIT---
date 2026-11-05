import { assertInteger, BASIS_POINTS_PER_WHOLE, splitByWeights } from '../numeric/index.js';

/** partner.ownership_bp and partner.is_owner (SPEC §6, §13). */
export interface PartnerOwnership {
  partnerId: string;
  /** 5000 = 50%. Everyone's ownership adds up to 10000. */
  ownershipBp: number;
  /** The owner (the user) is exactly one of the participants; every other one is a partner. */
  isOwner: boolean;
}

/**
 * Checks the participants of SPEC §6: the owner and one or more partners, whose ownership adds up
 * to 100% (S4). Returns them in the order every split uses: the owner first, then the partners by
 * id. Odd cents fall in that order, so every device and the server share them the same way (S17).
 */
export function participantsOf(partners: readonly PartnerOwnership[]): PartnerOwnership[] {
  if (partners.length < 2) {
    throw new RangeError(
      `expected an owner and at least one partner, got ${String(partners.length)}`,
    );
  }
  const owners = partners.filter(({ isOwner }) => isOwner);
  const [owner] = owners;
  if (!owner || owners.length !== 1) throw new RangeError('exactly one partner must be the owner');
  if (new Set(partners.map(({ partnerId }) => partnerId)).size !== partners.length) {
    throw new RangeError('partner ids must differ');
  }
  let total = 0;
  for (const { partnerId, ownershipBp } of partners) {
    assertInteger(ownershipBp, `ownershipBp of ${partnerId}`, 0);
    total += ownershipBp;
  }
  if (total !== BASIS_POINTS_PER_WHOLE) {
    throw new RangeError(
      `ownership must add up to ${String(BASIS_POINTS_PER_WHOLE)} bp, got ${String(total)}`,
    );
  }
  // Code-unit order, not localeCompare: the same on every device.
  const others = partners
    .filter(({ isOwner }) => !isOwner)
    .sort((a, b) => (a.partnerId < b.partnerId ? -1 : a.partnerId > b.partnerId ? 1 : 0));
  return [owner, ...others];
}

/**
 * Splits an amount between the participants by ownership, exactly: largest remainder, and an odd
 * cent on an even split goes to the owner, then to the partners in id order (S5, S17). T10: 10000
 * at 50/50 → 5000/5000. Owner first, then the partners by id.
 */
export function splitByOwnership(
  amountCents: number,
  partners: readonly PartnerOwnership[],
): { partnerId: string; amountCents: number }[] {
  const participants = participantsOf(partners);
  const parts = splitByWeights(
    amountCents,
    participants.map(({ ownershipBp }) => ownershipBp),
  );
  return participants.map(({ partnerId }, index) => ({
    partnerId,
    amountCents: parts[index] ?? 0,
  }));
}
