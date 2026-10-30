import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** OWASP Password Storage Cheat Sheet minimum for argon2id (the library's default algorithm). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordHasher {
  /** Verified when the username does not exist, so a miss takes as long as a wrong password. */
  private readonly dummyHash = hash('timing-equaliser-not-a-password', ARGON2_OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /** False on a wrong password or an unreadable hash; never throws for bad input. */
  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    try {
      const ok = await verify(passwordHash ?? (await this.dummyHash), password);
      return passwordHash !== null && ok;
    } catch {
      return false;
    }
  }
}
