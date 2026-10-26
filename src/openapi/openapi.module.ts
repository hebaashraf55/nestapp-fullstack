import { Controller, DynamicModule, Get, Module } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Public } from '../auth/decorators';
import { Env, openApiEnabled } from '../config/env';
import { buildOpenApi, OpenApiDocument } from './openapi';

@Controller('openapi.json')
export class OpenApiController {
  private cached: OpenApiDocument | undefined;

  constructor(private readonly modules: ModulesContainer) {}

  /** Public and read-only. Built once, on first request, from the running application's own metadata. */
  @Public()
  @Get()
  spec(): OpenApiDocument {
    this.cached ??= buildOpenApi(this.modules);
    return this.cached;
  }
}

@Module({})
export class OpenApiModule {
  /** Registers the route only when enabled, so a production deployment has no such URL at all (404). */
  static register(env: Env): DynamicModule {
    return {
      module: OpenApiModule,
      controllers: openApiEnabled(env) ? [OpenApiController] : [],
    };
  }
}
