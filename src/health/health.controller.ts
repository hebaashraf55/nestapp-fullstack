import { Controller, Get, Inject } from '@nestjs/common';
import { ENV, Env } from '../config/env';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Liveness probe. Public, read-only, and reveals no secrets or infrastructure details. */
  @Get()
  check() {
    return { status: 'ok', paymentsMode: this.env.PAYMENTS_MODE };
  }
}
