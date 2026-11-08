import { DynamicModule, Global, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { CacheService } from './cache.service';

@Global()
@Module({})
export class CacheModule {
  static register(env: Env): DynamicModule {
    return {
      module: CacheModule,
      providers: [{ provide: ENV, useValue: env }, CacheService],
      exports: [CacheService],
    };
  }
}
