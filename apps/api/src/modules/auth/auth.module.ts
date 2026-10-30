import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { AuditModule } from '../audit/index.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionsRepository } from './sessions.repository.js';
import { TokenService } from './token.service.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [
    AuditModule,
    // Secrets are passed per call from the validated config.
    JwtModule.register({}),
    // Only the routes with @UseGuards(ThrottlerGuard) are limited, each by its own throttler
    // (AuthController skips the other): login (AUTH_LOGIN_RATE_LIMIT a minute per client IP) and
    // refresh (AUTH_REFRESH_RATE_LIMIT).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [
        { name: 'login', ttl: 60_000, limit: config.auth.loginRateLimit },
        { name: 'refresh', ttl: 60_000, limit: config.auth.refreshRateLimit },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordHasher,
    UsersRepository,
    SessionsRepository,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
