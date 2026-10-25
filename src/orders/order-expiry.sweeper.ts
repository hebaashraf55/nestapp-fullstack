import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { OrdersService } from './orders.service';

const SWEEP_EVERY_MS = 60_000;

/** Gives stock back from abandoned unpaid orders even if their owners never return. */
@Injectable()
export class OrderExpirySweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpirySweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly orders: OrdersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    // Needs a database, and tests drive `expireOverdue()` directly instead of waiting on a timer.
    if (this.env.MONGODB_URI === undefined || this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.orders.expireOverdue().catch((error: unknown) => {
        this.logger.error(`Order expiry sweep failed: ${String(error)}`);
      });
    }, SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
