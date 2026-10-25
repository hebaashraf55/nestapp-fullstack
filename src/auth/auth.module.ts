import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, Env } from '../config/env';
import { AuthGuard, DemoReadOnlyGuard, RolesGuard } from './guards';
import { TokenService } from './token.service';

/** Order matters: authenticate first, then the demo read-only rule, then role checks. */
@Module({})
export class AuthModule {
  static register(env: Env): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: ENV, useValue: env },
        TokenService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
      exports: [TokenService],
    };
  }
}
