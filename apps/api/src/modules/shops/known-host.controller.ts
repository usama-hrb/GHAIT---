import { Controller, Get, HttpStatus, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AppHttpException, ZodQuery } from '../../common/index.js';
import { Public } from '../auth/index.js';
import { ShopsService } from './shops.service.js';

const knownHostQuerySchema = z.object({ domain: z.string().min(1).max(253) });

/** What every refusal says, so a caller learns nothing about which names are shops. */
function refused(): AppHttpException {
  return new AppHttpException('not_found', 'Not found', HttpStatus.NOT_FOUND);
}

/**
 * The `ask` address of Caddy's on-demand certificates (ADR 0029, Step 7). Before Caddy asks Let's
 * Encrypt for a certificate it calls `GET /internal/known-host?domain=<name>` here, on the Docker
 * network, and goes on only for a 2xx answer. Without it anybody could point a name at the server
 * and use up the Let's Encrypt limits.
 *
 * Caddy removes the `/api` prefix, so this route is also reachable by the public as
 * `/api/internal/known-host`. Two layers keep it shut: the site block of Caddy answers 404 for
 * `/api/internal/*`, and this route refuses any request that has an `X-Forwarded-For` header,
 * because Caddy's `reverse_proxy` adds one to every request it passes on and Caddy's own `ask`
 * request, which goes straight to the API, has none. That holds only while the API port is not
 * reachable from outside the Docker network (docs/runbooks/deploy.md).
 *
 * It is outside the host rule of `ShopsModule` (the request comes to the name `api`, no shop's
 * address) and it opens no shop: it reads the control database only.
 */
@ApiExcludeController()
@Public()
@Controller('internal')
export class KnownHostController {
  constructor(private readonly shops: ShopsService) {}

  @Get('known-host')
  async knownHost(
    @ZodQuery(knownHostQuerySchema) query: z.infer<typeof knownHostQuerySchema>,
    @Req() request: Request,
  ): Promise<void> {
    if (request.headers['x-forwarded-for'] !== undefined) throw refused();
    if (!(await this.shops.hasOpenShopAt(query.domain))) throw refused();
  }
}
