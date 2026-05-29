import { io, type Socket } from 'socket.io-client';

import { env } from '@/env';
import { store } from '@/store/store';

let socket: Socket | null = null;
let started = false;
let connectedUserId: string | null = null;

function currentToken(): string {
  return store.getState().auth.accessToken ?? '';
}

function connect(userId: string): void {
  if (socket?.connected && connectedUserId === userId) return;
  if (socket) disconnect();

  connectedUserId = userId;
  socket = io(`${env.apiHost}/presence`, {
    transports: ['websocket'],
    // Callback form re-reads the token on every reconnect, so a refreshed
    // Supabase token gets picked up automatically without churning the socket.
    auth: (cb) => cb({ token: currentToken() }),
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  socket.on('connect_error', (err) => {
    console.warn('[presence] connect_error:', err.message);
  });
}

function disconnect(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
  connectedUserId = null;
}

function sync(): void {
  const { status, userId } = store.getState().auth;
  if (status === 'authenticated' && userId) {
    connect(userId);
  } else {
    disconnect();
  }
}

/**
 * Drives presence over a single WebSocket connection.
 *
 * - Opens `${apiHost}/presence` while authenticated; the server flips the user
 *   online on connect and offline on disconnect (no polling).
 * - Reconnects with backoff on transient drops; the auth callback re-reads the
 *   access token each time, so Supabase token refreshes don't churn the socket.
 * - Closes on sign-out, so peers see offline immediately.
 */
export function startPresence(): void {
  if (started) return;
  started = true;

  store.subscribe(sync);
  sync();
}
