import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import { SHOP_ISSUES } from '@fabric/contracts';
import type { NextFunction, Request, Response } from 'express';
import { AppHttpException } from '../../common/index.js';
import { bindShop, type ShopRef } from '../../database/index.js';
import { ShopLookup } from './shop-lookup.js';

/** The body is the same for an address nobody owns and a closed shop: it says nothing about which. */
const UNKNOWN_ADDRESS = 'No shop is served at this address';

/**
 * The first thing a request meets in multi-shop mode (ADR 0029): the address it came to chooses the
 * shop, and everything the request does afterwards reads and writes that shop's database. Nothing
 * else is allowed to choose: not a header, a path or a token. `request.hostname` is the `Host`
 * header, or `X-Forwarded-Host` from a proxy this server trusts (`trust proxy`).
 */
@Injectable()
export class ShopHostMiddleware implements NestMiddleware {
  constructor(private readonly lookup: ShopLookup) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    this.admit(request).then(
      (shop) => {
        // The request logger, when there is one: its lines then say which shop they are about.
        const { log } = request as Partial<Pick<Request, 'log'>>;
        log?.setBindings({ shop: shop.slug });
        try {
          bindShop(shop, () => {
            next();
          });
        } catch (error) {
          next(error);
        }
      },
      (error: unknown) => {
        next(error);
      },
    );
  }

  private async admit(request: Request): Promise<ShopRef> {
    const answer = await this.lookup.resolve(request.hostname.toLowerCase());
    switch (answer.kind) {
      case 'serve':
        return answer.shop;
      case 'suspended':
        throw new AppHttpException('forbidden', 'This shop is switched off', HttpStatus.FORBIDDEN, [
          { path: [], message: 'The shop is switched off', code: SHOP_ISSUES.suspended },
        ]);
      case 'starting':
        throw new AppHttpException(
          'service_unavailable',
          'This shop is being set up. Try again in a few minutes.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      case 'updating':
        throw new AppHttpException(
          'service_unavailable',
          'This shop is being updated. Try again in a few minutes.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      case 'unknown':
        throw new AppHttpException('not_found', UNKNOWN_ADDRESS, HttpStatus.NOT_FOUND);
    }
  }
}
