import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokenService } from '../auth/token.service';
import { Role } from '../users/role';
import { UsersService } from '../users/users.service';
import { RealtimeService } from './realtime.service';

const MAX_PRODUCT_ROOMS = 20;
const OBJECT_ID = /^[0-9a-f]{24}$/;

/**
 * Socket.io endpoint at /api/socket. CORS comes from the adapter (the same exact-match allow-list as the
 * HTTP API). A connection without a token, or with an invalid, expired or revoked one, stays anonymous:
 * it can follow public product stock and nothing else.
 */
@WebSocketGateway({ path: '/api/socket', serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(socket: Socket) {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length > 4096) return;
    const claims = this.tokens.verify(token);
    if (!claims) return;
    try {
      const user = await this.users.findById(claims.userId);
      // Same rule as the HTTP guard: a bumped tokenVersion revokes every earlier token.
      if (!user || user.tokenVersion !== claims.tokenVersion) return;
      await socket.join(`user:${user.id}`);
      if (user.role === Role.ADMIN) await socket.join('staff');
      socket.data.userId = user.id;
    } catch (error) {
      this.logger.warn(`Realtime: could not identify a connection: ${String(error)}`);
    }
  }

  /** Follow one product's stock (public data). */
  @SubscribeMessage('product.watch')
  async watch(@ConnectedSocket() socket: Socket, @MessageBody() productId: unknown) {
    if (typeof productId !== 'string' || !OBJECT_ID.test(productId)) return { ok: false };
    const rooms = [...socket.rooms].filter((r) => r.startsWith('product:'));
    if (rooms.length >= MAX_PRODUCT_ROOMS) await socket.leave(rooms[0]!);
    await socket.join(`product:${productId}`);
    return { ok: true };
  }

  @SubscribeMessage('product.unwatch')
  async unwatch(@ConnectedSocket() socket: Socket, @MessageBody() productId: unknown) {
    if (typeof productId === 'string') await socket.leave(`product:${productId}`);
    return { ok: true };
  }
}
