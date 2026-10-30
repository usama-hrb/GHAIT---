import { createHash, randomBytes } from 'node:crypto';
import { type Role, roleSchema } from '@fabric/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { AppHttpException } from '../../common/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';

const ISSUER = 'fabric-shop';
const AUDIENCE = 'fabric-shop-api';

const claimsSchema = z.object({ sub: z.uuid(), role: roleSchema, sid: z.uuid() });
export type AccessClaims = z.infer<typeof claimsSchema>;

/** Short-lived HS256 access tokens, and opaque refresh tokens stored only as a sha256. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  signAccess(user: { id: string; role: Role }, sessionId: string): Promise<string> {
    return this.jwt.signAsync(
      { role: user.role, sid: sessionId },
      {
        subject: user.id,
        secret: this.config.auth.accessSecret,
        expiresIn: this.config.auth.accessTtlSeconds,
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  /** Throws 401 for a bad signature, wrong issuer/audience, expiry or unexpected claims. */
  async verifyAccess(token: string): Promise<AccessClaims> {
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync<object>(token, {
        secret: this.config.auth.accessSecret,
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
