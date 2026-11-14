import { timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AppHttpException } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import {
  ControlDatabase,
  controlSchema,
  currentShop,
  hashSetupCode,
  normalizeSetupCode,
  requireSetupCodeSecret,
  SETUP_CODE_MAX_FAILED_TRIES,
} from '../../database/index.js';
import { signUpClosed } from '../auth/index.js';
import { FailedTries } from './failed-tries.js';

/** Failed tries one client address may make, on any shop, in a window of this length. */
export const SETUP_CODE_ADDRESS_MAX_FAILED = 5;
export const SETUP_CODE_ADDRESS_WINDOW_MS = 15 * 60 * 1000;

/** A code that was checked and is still to be marked used. */
export interface SetupCodeTicket {
  readonly id: string;
}

const tooManyTries = () =>
  new AppHttpException(
    'too_many_requests',
    'Too many wrong setup codes from this address. Try again later.',
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * The setup code at the sign-up page of a shop (ADR 0029, Step 6). Present only when the server
 * serves many shops: there the first owner of a shop needs the code its operator made, and a
 * one-shop server has no such service.
 *
 * It answers one way to every code that does not open the sign-up: wrong, in the wrong shape, old,
 * used, stopped or for another shop all get `signUpClosed`, the answer of a closed sign-up, so a
 * stranger learns nothing about a code or whether a shop waits for its owner. Tries are limited
 * twice. For each shop, the code that is waiting takes `SETUP_CODE_MAX_FAILED_TRIES` wrong tries
 * and is then stopped for good (the operator makes a new one); that count is in the control
 * database, so it holds across restarts. For each client address, `SETUP_CODE_ADDRESS_MAX_FAILED`
 * failed tries in a window block the address for the rest of the window, whatever it sends, with a
 * 429 that says nothing about the code.
 */
@Injectable()
export class SetupCodes {
  private readonly secret: string;
  private readonly addresses = new FailedTries(
    SETUP_CODE_ADDRESS_MAX_FAILED,
    SETUP_CODE_ADDRESS_WINDOW_MS,
  );

  constructor(
    private readonly control: ControlDatabase,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    // The server does not start without it: a sign-up that cannot check a code must not open.
    this.secret = requireSetupCodeSecret(config);
  }

  /**
   * Checks `typed` against the code of the shop this request is bound to, without using it. Returns
   * the ticket to give to `use` once the owner is made, or refuses.
   */
  async check(typed: string | undefined, client: string): Promise<SetupCodeTicket> {
    const shop = currentShop();
    if (!shop) throw new Error('A sign-up on a server with many shops is bound to its shop');
    const now = new Date();
    if (this.addresses.blocked(client, now.getTime())) throw tooManyTries();

    const code = typed === undefined ? null : normalizeSetupCode(typed);
    const waiting = code === null ? undefined : await this.waitingCode(shop.id, now);
    if (code === null || !waiting) {
      // Nothing can be guessed here: no code of the right shape, or no code waiting at all.
      this.addresses.fail(client, now.getTime());
      throw signUpClosed();
    }
    if (!sameHash(waiting.codeHash, hashSetupCode(this.secret, shop.id, code))) {
      this.addresses.fail(client, now.getTime());
      await this.countWrongTry(waiting.id, shop.id, now);
      throw signUpClosed();
    }
    return { id: waiting.id };
  }

  /**
   * Marks the checked code used, when the owner is made and before the request commits. Nothing
   * is lost if it fails: the request fails with it and the owner is not made. It refuses if the
   * code was used, stopped or has run out since `check`, which is the one-use rule held by the
   * database and not by the order of two requests.
   */
  async use(ticket: SetupCodeTicket): Promise<void> {
    const now = new Date();
    await this.control.db.transaction(async (tx) => {
      const [used] = await tx
        .update(controlSchema.shopSetupCode)
        .set({ usedAt: now })
        .where(
          and(
            eq(controlSchema.shopSetupCode.id, ticket.id),
            isNull(controlSchema.shopSetupCode.usedAt),
            isNull(controlSchema.shopSetupCode.revokedAt),
            gt(controlSchema.shopSetupCode.expiresAt, now),
          ),
        )
        .returning({ shopId: controlSchema.shopSetupCode.shopId });
      if (!used) throw signUpClosed();
      await tx.insert(controlSchema.shopEvent).values({
        shopId: used.shopId,
        actor: 'api',
        action: 'shop.setup_code_used',
        detail: { codeId: ticket.id },
      });
    });
  }

  /** The code of an active shop that can still be used: not used, not stopped, not run out. */
  private async waitingCode(
    shopId: string,
    now: Date,
  ): Promise<{ id: string; codeHash: string } | undefined> {
    const [row] = await this.control.db
      .select({
        id: controlSchema.shopSetupCode.id,
        codeHash: controlSchema.shopSetupCode.codeHash,
      })
      .from(controlSchema.shopSetupCode)
      .innerJoin(controlSchema.shop, eq(controlSchema.shop.id, controlSchema.shopSetupCode.shopId))
      .where(
        and(
          eq(controlSchema.shopSetupCode.shopId, shopId),
          eq(controlSchema.shop.state, 'active'),
          isNull(controlSchema.shopSetupCode.usedAt),
          isNull(controlSchema.shopSetupCode.revokedAt),
          gt(controlSchema.shopSetupCode.expiresAt, now),
        ),
      )
      .orderBy(desc(controlSchema.shopSetupCode.createdAt))
      .limit(1);
    return row;
  }

  /**
   * One more wrong try on the waiting code; the one that reaches the limit stops it and leaves
   * `shop.setup_code_locked` for the operator. In a transaction of the control database, which is
   * not the request's: the count stays although the request is refused and rolled back.
   */
  private async countWrongTry(codeId: string, shopId: string, now: Date): Promise<void> {
    await this.control.db.transaction(async (tx) => {
      const [counted] = await tx
        .update(controlSchema.shopSetupCode)
        .set({ failedTries: sql`${controlSchema.shopSetupCode.failedTries} + 1` })
        .where(
          and(
            eq(controlSchema.shopSetupCode.id, codeId),
            isNull(controlSchema.shopSetupCode.usedAt),
            isNull(controlSchema.shopSetupCode.revokedAt),
          ),
        )
        .returning({ failedTries: controlSchema.shopSetupCode.failedTries });
      if (!counted || counted.failedTries < SETUP_CODE_MAX_FAILED_TRIES) return;
      await tx
        .update(controlSchema.shopSetupCode)
        .set({ revokedAt: now })
        .where(eq(controlSchema.shopSetupCode.id, codeId));
      await tx.insert(controlSchema.shopEvent).values({
        shopId,
        actor: 'api',
        action: 'shop.setup_code_locked',
        detail: { codeId, failedTries: counted.failedTries },
      });
    });
  }
}

/** Two hex hashes compared in constant time. */
function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
