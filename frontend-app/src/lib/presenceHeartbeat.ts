import { usersApi } from '@/api/usersApi';
import { env } from '@/env';
import { store } from '@/store/store';

const HEARTBEAT_INTERVAL_MS = 45 * 1000;
const PRESENCE_PATH = '/users/me/presence';

let timerId: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastKnownAccessToken: string | null = null;
let lastStatus: 'idle' | 'authenticated' | 'unauthenticated' = 'idle';

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function shouldBeAlive(): boolean {
  return store.getState().auth.status === 'authenticated' && isVisible();
}

async function ping(): Promise<void> {
  try {
    await store
      .dispatch(usersApi.endpoints.presenceHeartbeat.initiate())
      .unwrap();
  } catch {
    // Best-effort; a dropped ping just means the next one runs.
  }
}

/**
 * Fire DELETE outside the RTK pipeline so it survives navigation (keepalive)
 * and so it can run after the auth slice has cleared the in-memory token —
 * we hold onto the last-known token while authenticated for exactly this.
 */
function sendOffline(token: string | null): void {
  if (!token) return;
  try {
    void fetch(`${env.backendUrl}${PRESENCE_PATH}`, {
      method: 'DELETE',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${token}`,
        'ngrok-skip-browser-warning': '1',
      },
    });
  } catch {
    // best-effort
  }
}

function startTimer(): void {
  if (timerId !== null) return;
  void ping();
  timerId = setInterval(() => void ping(), HEARTBEAT_INTERVAL_MS);
}

function stopTimer(): void {
  if (timerId === null) return;
  clearInterval(timerId);
  timerId = null;
}

function sync(): void {
  const { status, accessToken } = store.getState().auth;
  if (status === 'authenticated' && accessToken) {
    lastKnownAccessToken = accessToken;
  }

  if (lastStatus === 'authenticated' && status === 'unauthenticated') {
    stopTimer();
    sendOffline(lastKnownAccessToken);
    lastKnownAccessToken = null;
  } else if (shouldBeAlive()) {
    startTimer();
  } else {
    stopTimer();
  }
  lastStatus = status;
}

/**
 * Drives presence for the signed-in user.
 *
 * - Pings POST /users/me/presence every 45s while authenticated + tab visible
 *   (well under the 120s `presence.offlineThresholdSeconds` backend window).
 * - Sends DELETE on tab hide, page unload, and explicit sign-out, so peers see
 *   the user flip to offline immediately instead of waiting for the threshold.
 */
export function startPresenceHeartbeat(): void {
  if (started) return;
  started = true;

  store.subscribe(sync);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopTimer();
        if (store.getState().auth.status === 'authenticated') {
          sendOffline(store.getState().auth.accessToken);
        }
      } else if (shouldBeAlive()) {
        startTimer();
      }
    });
  }

  if (typeof window !== 'undefined') {
    // pagehide covers real unload and the bfcache freeze on iOS Safari, where
    // `beforeunload` doesn't reliably fire.
    window.addEventListener('pagehide', () => {
      stopTimer();
      if (store.getState().auth.status === 'authenticated') {
        sendOffline(store.getState().auth.accessToken);
      }
    });
  }

  sync();
}
