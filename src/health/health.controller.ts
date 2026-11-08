import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { ModuleRef } from '@nestjs/core';
import type { Response } from 'express';
import type { Connection } from 'mongoose';
import { Public } from '../auth/decorators';
import { CacheService } from '../cache/cache.service';
import { ENV, Env } from '../config/env';
import { JobsService } from '../jobs/jobs.service';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);

/** Health probes. Public and read-only; they report up/down only, never hosts, versions or errors. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly jobs?: JobsService,
  ) {}

  /** Kept for existing monitors: the process is up. */
  @Public()
  @Get()
  check() {
    return { status: 'ok', paymentsMode: this.env.PAYMENTS_MODE };
  }

  /** Liveness: the process answers. Restart it if this fails. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Readiness: the database answers a ping (and Redis, when configured). Send traffic only while this
   * is 200; it is 503 while a dependency is down.
   */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const database = await this.database();
    const cache = this.cache
      ? (await this.cache.healthy())
        ? this.cache.backend
        : 'down'
      : 'memory';
    const ready = database !== 'down' && cache !== 'down';
    res.status(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not-ready',
      checks: {
        database,
        cache,
        jobsWorker: this.jobs?.workerRunning ? 'running' : 'off',
      },
    };
  }

  private async database(): Promise<'up' | 'down' | 'not-configured'> {
    if (!this.env.MONGODB_URI) return 'not-configured';
    try {
      const connection = this.moduleRef.get<Connection>(getConnectionToken(), { strict: false });
      if (connection.readyState !== 1 || !connection.db) return 'down';
      await withTimeout(connection.db.admin().ping(), 2000);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
