import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { ENV, Env } from '../config/env';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Liveness probe. Public, read-only, and reveals no secrets or infrastructure details. */
  @Public()
  @Get()
  check() {
    return { status: 'ok', paymentsMode: this.env.PAYMENTS_MODE };
  }
}
