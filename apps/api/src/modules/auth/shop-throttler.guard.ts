import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { currentShop } from '../../database/index.js';

/**
 * The rate limiter of the sign-in routes, counting each client address once for each shop (ADR
 * 0029). One shop's guesses at a password then never use up another shop's allowance, and the
 * counters of two shops that share an address stay apart. On a one-shop server there is no shop,
 * and the key is the address alone, as it always was.
 */
@Injectable()
export class ShopThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const address = typeof request['ip'] === 'string' ? request['ip'] : '';
    const shop = currentShop();
    return Promise.resolve(shop ? `${shop.id}:${address}` : address);
  }
}
