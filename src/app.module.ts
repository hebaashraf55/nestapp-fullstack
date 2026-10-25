import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ENV, Env } from './config/env';
import { HealthController } from './health/health.controller';
import { UsersModule } from './users/users.module';

@Module({})
export class AppModule {
  /** The environment is validated once at startup and injected, instead of being read ad hoc. */
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [UsersModule.register(env), AuthModule.register(env)],
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
    };
  }
}
