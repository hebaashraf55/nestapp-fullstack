import { io, type Socket } from 'socket.io-client';
import { API_ORIGIN } from '../api/client';
import { getSession } from '../auth/session';

/*
 * One shared Socket.io connection for live updates. It is an extra, never a requirement: every screen
 * still loads its data from the API and keeps working (with polling where it matters) if the socket
 * cannot connect. The access token is sent on each (re)connect and checked by the server; without one
 * the connection only receives public product stock.
 */
let socket: Socket | null = null;
let connectedAs: string | null = null;

const enabled = () => import.meta.env.MODE !== 'test' && typeof window !== 'undefined';

export function getSocket(): Socket | null {
  if (!enabled()) return null;
  const who = getSession()?.user.id ?? null;
  if (socket && connectedAs !== who) {
    // Signed in or out: reconnect so the server puts this socket in the right rooms.
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    connectedAs = who;
    socket = io(API_ORIGIN || undefined, {
      path: '/api/socket',
      auth: (cb) => cb({ token: getSession()?.accessToken }),
      reconnectionDelayMax: 30_000,
    });
  }
  return socket;
}
