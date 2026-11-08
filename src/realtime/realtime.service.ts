import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Sends live updates. Rooms decide who receives what, and only the server puts sockets in rooms:
 * `user:<id>` (that customer only, after their token is verified), `staff` (admins), and
 * `product:<id>` (public stock level of one product). With no socket server running (tests, scripts)
 * every call is a no-op, so real-time is never required for the API to work.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  toUser(userId: string, event: string, data: unknown) {
    if (!userId || userId.startsWith('guest:')) return;
    this.server?.to(`user:${userId}`).emit(event, data);
  }

  toStaff(event: string, data: unknown) {
    this.server?.to('staff').emit(event, data);
  }

  toProduct(productId: string, event: string, data: unknown) {
    this.server?.to(`product:${productId}`).emit(event, data);
  }
}
