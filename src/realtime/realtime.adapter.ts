import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import { Env } from '../config/env';

/** Socket.io with the API's CORS allow-list (exact origins, never `*`) and small message limits. */
export class RealtimeAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.env.CORS_ORIGINS.length > 0 ? this.env.CORS_ORIGINS : false },
      maxHttpBufferSize: 16 * 1024,
      pingTimeout: 20_000,
    }) as Server;
  }
}
