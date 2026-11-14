import { createHash, hkdfSync, randomBytes } from 'node:crypto';
import { type Role, roleSchema } from '@fabric/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { AppHttpException } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { currentShop, type ShopRef } from '../../database/index.js';

const ISSUER = 'fabric-shop';
const AUDIENCE = 'fabric-shop-api';

const claimsSchema = z.object({
  sub: z.uuid(),
  role: roleSchema,
  sid: z.uuid(),
  /** The shop the token was made for (ADR 0029). Only in multi-shop mode. */
  shop: z.uuid().optional(),
});
export type AccessClaims = z.infer<typeof claimsSchema>;

/**
 * Short-lived HS256 access tokens, and opaque refresh tokens stored only as a sha256.
 *
 * In multi-shop mode (ADR 0029) a token is made for one shop. It carries the shop's id in a `shop`
 * claim, and it is signed with a key derived from the server's secret and that shop's id (HKDF), so
 * a token of one shop does not even pass the signature check at another shop's address. The claim is
 * then compared with the shop of the request as a second, separate check. A token made before the
 * shop claim existed has neither, so it is refused once and the app asks for a new one with its
 * refresh cookie. The shop of the request is the one its address chose (`bindShop`); a request
 * that is bound to no shop cannot make or check a token.
 */
@Injectable()
export class TokenService {
  /** The derived keys, by shop id: deriving is cheap, but it need not be done for every request. */
  private readonly shopKeys = new Map<string, Buffer>();

  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The shop of the running request in multi-shop mode; undefined on a one-shop server. */
  private shop(): ShopRef | undefined {
    if (!this.config.multiShop) return undefined;
    const shop = currentShop();
    if (!shop) throw new Error('An access token needs the shop of the request, and none is bound');
    return shop;
  }

  private keyOf(shop: ShopRef | undefined): string | Buffer {
    if (!shop) return this.config.auth.accessSecret;
    const known = this.shopKeys.get(shop.id);
    if (known) return known;
    const key = Buffer.from(
      hkdfSync(
        'sha256',
        this.config.auth.accessSecret,
        Buffer.alloc(0),
        `fabric-shop/access-token/${shop.id}`,
        32,
      ),
    );
    this.shopKeys.set(shop.id, key);
    return key;
  }

  signAccess(user: { id: string; role: Role }, sessionId: string): Promise<string> {
    const shop = this.shop();
    return this.jwt.signAsync(
      { role: user.role, sid: sessionId, ...(shop ? { shop: shop.id } : {}) },
      {
        subject: user.id,
        secret: this.keyOf(shop),
        expiresIn: this.config.auth.accessTtlSeconds,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  /**
   * Throws 401 for a bad signature, wrong issuer/audience, expiry, unexpected claims, or (in
   * multi-shop mode) a token made for another shop or for none.
   */
  async verifyAccess(token: string): Promise<AccessClaims> {
    const shop = this.shop();
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync<object>(token, {
        secret: this.keyOf(shop),
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw new AppHttpException(
        'unauthorized',
        'Invalid or expired access token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new AppHttpException('unauthorized', 'Invalid access token', HttpStatus.UNAUTHORIZED);
    }
    if (shop && claims.data.shop !== shop.id) {
      throw new AppHttpException(
        'unauthorized',
        'This access token is not for this shop',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return claims.data;
  }

  /** 256 random bits; only the hash is stored. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
