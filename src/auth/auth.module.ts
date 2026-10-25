import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ENV, Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Otp, OtpSchema, RefreshToken, RefreshTokenSchema } from './auth-storage.schemas';
import { AuthGuard, DemoReadOnlyGuard, RolesGuard } from './guards';
import { MongoOtpRepository, MongoRefreshTokenRepository } from './mongo-auth.repositories';
import { OtpRepository } from './otp.repository';
import { RateLimiter } from './rate-limiter';
import { RefreshTokenRepository } from './refresh-token.repository';
import { TokenService } from './token.service';
import {
  UnavailableOtpRepository,
  UnavailableRefreshTokenRepository,
} from './unavailable-auth.repositories';

@Module({})
export class AuthModule {
  /** Order of the global guards matters: authenticate, then the demo read-only rule, then roles. */
  static register(env: Env): DynamicModule {
    const connected = env.MONGODB_URI !== undefined;
    return {
      module: AuthModule,
      imports: connected
        ? [
            MongooseModule.forFeature([
              { name: Otp.name, schema: OtpSchema },
              { name: RefreshToken.name, schema: RefreshTokenSchema },
            ]),
          ]
        : [],
      controllers: [AuthController],
      providers: [
        { provide: ENV, useValue: env },
        TokenService,
        AuthService,
        RateLimiter,
        {
          provide: OtpRepository,
          useClass: connected ? MongoOtpRepository : UnavailableOtpRepository,
        },
        {
          provide: RefreshTokenRepository,
          useClass: connected ? MongoRefreshTokenRepository : UnavailableRefreshTokenRepository,
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
      exports: [TokenService],
    };
  }
}
