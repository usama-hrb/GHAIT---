import { describe, expect, it } from 'vitest';
import {
  accountListQuerySchema,
  changePasswordRequestSchema,
  deactivateAccountSchema,
  newCashierAccountSchema,
  newPartnerAccountSchema,
  TEMPORARY_PASSWORD_ALPHABET,
  TEMPORARY_PASSWORD_GROUP_SIZE,
  TEMPORARY_PASSWORD_GROUPS,
} from './accounts.js';
import { PARTNER_OWN_RECORDS, partnerViewOf, recordForAccount } from './access.js';

const PARTNER = crypto.randomUUID();
const OTHER = crypto.randomUUID();

describe('what an account request can carry (ADR 0024)', () => {
  it('has no role anywhere: a request that names one is refused', () => {
    const fields = { username: 'amina', displayName: 'Amina' };
    expect(newCashierAccountSchema.safeParse(fields).success).toBe(true);
    expect(newCashierAccountSchema.safeParse({ ...fields, role: 'owner' }).success).toBe(false);
    expect(newCashierAccountSchema.safeParse({ ...fields, partnerId: PARTNER }).success).toBe(
      false,
    );
    expect(newCashierAccountSchema.safeParse({ ...fields, passwordHash: 'x' }).success).toBe(false);
    expect(newPartnerAccountSchema.safeParse({ ...fields, partnerId: PARTNER }).success).toBe(true);
    expect(newPartnerAccountSchema.safeParse(fields).success).toBe(false);
    expect(
      newPartnerAccountSchema.safeParse({ ...fields, partnerId: PARTNER, role: 'owner' }).success,
    ).toBe(false);
  });

  it('lower-cases the username and trims the display name', () => {
    expect(
      newCashierAccountSchema.parse({ username: ' Amina.B ', displayName: '  Amina  ' }),
    ).toEqual({ username: 'amina.b', displayName: 'Amina' });
    expect(newCashierAccountSchema.safeParse({ username: 'a', displayName: 'Amina' }).success).toBe(
      false,
    );
  });

  it('wants a reason to switch an account off', () => {
    expect(deactivateAccountSchema.safeParse({}).success).toBe(false);
    expect(deactivateAccountSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(deactivateAccountSchema.parse({ reason: ' left ' })).toEqual({ reason: 'left' });
  });

  it('filters the list by type and status only', () => {
    expect(accountListQuerySchema.parse({})).toEqual({});
    expect(accountListQuerySchema.parse({ role: 'partner', status: 'inactive' })).toEqual({
      role: 'partner',
      status: 'inactive',
    });
    expect(accountListQuerySchema.safeParse({ role: 'king' }).success).toBe(false);
    expect(accountListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('asks for the new password twice, and at least 12 characters', () => {
    const request = {
      currentPassword: 'temporary',
      newPassword: 'a long enough password',
      confirmPassword: 'a long enough password',
    };
    expect(changePasswordRequestSchema.safeParse(request).success).toBe(true);
    const mismatch = changePasswordRequestSchema.safeParse({
      ...request,
      confirmPassword: 'other',
    });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]).toMatchObject({
      path: ['confirmPassword'],
      message: 'password_mismatch',
    });
    expect(
      changePasswordRequestSchema.safeParse({
        ...request,
        newPassword: 'short',
        confirmPassword: 'short',
      }).success,
    ).toBe(false);
  });

  it('draws temporary passwords from letters and digits that cannot be mistaken for each other', () => {
    for (const confusing of ['0', 'O', '1', 'l', 'I']) {
      expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(confusing);
    }
    expect(new Set(TEMPORARY_PASSWORD_ALPHABET).size).toBe(TEMPORARY_PASSWORD_ALPHABET.length);
    expect(TEMPORARY_PASSWORD_GROUPS * TEMPORARY_PASSWORD_GROUP_SIZE).toBeGreaterThanOrEqual(16);
  });
});

describe("a partner's account receives its own money and the shop's, not another partner's (PS1–PS3)", () => {
  it('keeps contributions, draws and settlement shares of the linked partner only', () => {
    expect(PARTNER_OWN_RECORDS).toEqual(['capital_move', 'partner_draw', 'settlement_share']);
    for (const entity of PARTNER_OWN_RECORDS) {
      const own = { id: 'a', partnerId: PARTNER };
      expect(partnerViewOf(entity, own, PARTNER)).toBe(own);
      expect(partnerViewOf(entity, { id: 'b', partnerId: OTHER }, PARTNER)).toBeNull();
      expect(partnerViewOf(entity, own, null)).toBeNull();
    }
  });

  it("shows other partners' names and shares, but not how to reach them or what was noted", () => {
    const other = {
      id: OTHER,
      name: 'Bilal',
      ownershipBp: 2500,
      phone: '0600',
      notes: 'private',
      exitNote: 'owed 100',
    };
    expect(partnerViewOf('partner', other, PARTNER)).toEqual({
      ...other,
      phone: null,
      notes: null,
      exitNote: null,
    });
    const mine = { ...other, id: PARTNER };
    expect(partnerViewOf('partner', mine, PARTNER)).toBe(mine);
  });

  it('leaves the shop-wide records alone', () => {
    const sale = { id: 's', totalCents: 100 };
    expect(partnerViewOf('sale', sale, PARTNER)).toBe(sale);
    expect(partnerViewOf('profit_split_rule', sale, PARTNER)).toBe(sale);
  });

  it("applies the role's cut first and the partner's cut after, per account", () => {
    const move = { partnerId: OTHER };
    expect(recordForAccount({ role: 'owner', partnerId: null }, 'capital_move', move)).toBe(move);
    expect(
      recordForAccount({ role: 'partner', partnerId: PARTNER }, 'capital_move', move),
    ).toBeNull();
    expect(recordForAccount({ role: 'cashier', partnerId: null }, 'capital_move', move)).toBeNull();
    const own = { partnerId: PARTNER };
    expect(recordForAccount({ role: 'partner', partnerId: PARTNER }, 'capital_move', own)).toBe(
      own,
    );
  });
});
