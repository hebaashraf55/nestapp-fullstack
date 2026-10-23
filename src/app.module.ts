import { DynamicModule, Module } from '@nestjs/common';
import { ENV, Env } from './config/env';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  /** The environment is validated once at startup and injected, instead of being read ad hoc. */
  static register(env: Env): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
    };
  }
}
