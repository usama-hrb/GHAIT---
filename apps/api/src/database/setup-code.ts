import { createHmac, randomBytes } from 'node:crypto';
import {
  formatSetupCode,
  normalizeSetupCode,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_LENGTH,
} from '@fabric/contracts';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { AppConfig } from '../config/index.js';
import type { ControlTx } from './control/operate.js';
import * as controlSchema from './control/schema.js';
import { ShopRefused } from './shop-names.js';

/**
 * The setup code of a new shop (ADR 0029 section 6): the one thing that lets a stranger who knows
 * the address make the first owner of a shop. 12 characters from an alphabet of 32 are 60 bits. The
 * alphabet is Crockford's: the digits and the letters but I, L, O and U, so a code read aloud or
 * copied by hand is not mistaken. It is shown once, on the operator's terminal; only an HMAC of it
 * is kept. The shape of a code (the alphabet, reading what was typed, the form it is shown in) is
 * in `@fabric/contracts`, because the sign-up form reads a typed code the same way; making and
 * hashing a code need Node's `crypto` and are here.
 */
export { formatSetupCode, normalizeSetupCode, SETUP_CODE_ALPHABET, SETUP_CODE_LENGTH };
/** How long a code can be used after it was made. */
export const SETUP_CODE_VALID_DAYS = 7;
/**
 * Wrong tries a shop's waiting code takes before it is stopped (ADR 0029, Step 6): the operator
 * then makes a new one. A wrong try is a code of the right shape that is not the waiting one.
 * 10 tries against 2^60 codes is a chance of about one in 10^17 for the guesser.
 */
export const SETUP_CODE_MAX_FAILED_TRIES = 10;

/**
 * A new code. Each character is a random byte's low 5 bits, so every character is as likely as
 * any other: 256 is a multiple of 32, so there is no bias to remove. `bytes` is the source of
 * randomness, the system's by default.
 */
export function newSetupCode(bytes: (size: number) => Uint8Array = randomBytes): string {
  const random = bytes(SETUP_CODE_LENGTH);
  if (random.length !== SETUP_CODE_LENGTH) throw new Error('The source of randomness fell short');
  return Array.from(random, (byte) => SETUP_CODE_ALPHABET.charAt(byte & 31)).join('');
}

/**
 * The HMAC-SHA256 that is kept in place of the code. The shop is part of what is signed, so a code
 * of one shop is no code of another even if the same text came up twice. The parts are written as
 * a JSON list, so no choice of shop and code can read as another choice (a separator between them
 * could be moved).
 */
export function hashSetupCode(secret: string, shopId: string, code: string): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(['fabric-shop/setup-code', shopId, code]))
    .digest('hex');
}

/** The secret that setup codes are hashed with, or a refusal that says how to set it. */
export function requireSetupCodeSecret(config: AppConfig): string {
  const secret = config.multiShop?.setupCodeSecret;
  if (!secret) {
    throw new ShopRefused(
      'SETUP_CODE_SECRET is not set. It hashes setup codes and must be at least 32 characters: ' +
        'generate one (for example `openssl rand -base64 48`), put it in .env and restart the stack.',
    );
  }
  return secret;
}

export interface IssuedSetupCode {
  /** In clear, once: the caller shows it and forgets it. Never logged, never stored. */
  readonly code: string;
  readonly expiresAt: Date;
  /** How many codes still waiting to be used were stopped by this one. */
  readonly replaced: number;
}

/**
 * Makes a code for a shop, in the transaction of the caller. A code that is still waiting (not
 * used, not stopped, not run out) is stopped first, because the operator makes a new one when the
 * old one was lost or may have been seen: only one code works at a time. Rows are never deleted; a
 * stopped code has `revoked_at`. Writes `shop.setup_code_made` with the expiry and the count, never
 * the code.
 */
export async function issueSetupCode(
  tx: ControlTx,
  request: {
    readonly config: AppConfig;
    readonly shopId: string;
    readonly actor: string;
    readonly now: Date;
  },
): Promise<IssuedSetupCode> {
  const secret = requireSetupCodeSecret(request.config);
  const stopped = await tx
    .update(controlSchema.shopSetupCode)
    .set({ revokedAt: request.now })
    .where(
      and(
        eq(controlSchema.shopSetupCode.shopId, request.shopId),
        isNull(controlSchema.shopSetupCode.usedAt),
        isNull(controlSchema.shopSetupCode.revokedAt),
        gt(controlSchema.shopSetupCode.expiresAt, request.now),
      ),
    )
    .returning({ id: controlSchema.shopSetupCode.id });
  const code = newSetupCode();
  const expiresAt = new Date(request.now.getTime() + SETUP_CODE_VALID_DAYS * 24 * 60 * 60 * 1000);
  await tx.insert(controlSchema.shopSetupCode).values({
    shopId: request.shopId,
    codeHash: hashSetupCode(secret, request.shopId, code),
    expiresAt,
    createdAt: request.now,
  });
  await tx.insert(controlSchema.shopEvent).values({
    shopId: request.shopId,
    actor: request.actor,
    action: 'shop.setup_code_made',
    detail: { expiresAt: expiresAt.toISOString(), replaced: stopped.length },
  });
  return { code, expiresAt, replaced: stopped.length };
}
