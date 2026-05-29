import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { usersApi } from '@/api/usersApi';
import { env } from '@/env';
import { store } from '@/store/store';

const PRESENCE_PATH = '/users/me/presence';
const CHANNEL_NAME = 'presence:online';

let started = false;
let supabase: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
// Tracks the user the channel/REST POST were established for; lets us no-op
// repeat syncs and detect user-switches that need a tear-down + re-join.
let connectedUserId: string | null = null;
let connectedToken: string | null = null;
// Held while authenticated so the unload/sign-out DELETE has a token even
// after the auth slice has cleared it.
let lastKnownAccessToken: string | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    console.warn(
      '[presence] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — ' +
        'realtime fan-out disabled; REST presence still active.',
    );
    return null;
  }
  supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    // We do not want a second Supabase auth session competing with the
    // backend-mediated session in our auth slice — the realtime client
    // just needs the JWT for channel auth (set via setAuth below).
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
}

/**
 * The auth slice clears the token before subscribers fire, and on `pagehide`
 * we want the request to survive the unload. `sendBeacon` doesn't support
 * custom headers, so we use `fetch` with `keepalive` — it has the same
 * survives-unload property and lets us send Authorization.
 */
function sendOfflineBeacon(token: string | null): void {
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

async function joinChannel(userId: string, token: string): Promise<void> {
  const client = getSupabase();
  if (!client) return;

  client.realtime.setAuth(token);

  const ch = client.channel(CHANNEL_NAME, {
    config: { presence: { key: userId } },
  });
  channel = ch;

  ch.subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') return;
    try {
      await ch.track({ user_id: userId });
    } catch (err) {
      console.warn('[presence] track failed:', err);
    }
  });
}

async function leaveChannel(): Promise<void> {
  const ch = channel;
  channel = null;
  if (!ch) return;
  try {
    await ch.untrack();
  } catch {
    // best-effort
  }
  try {
    await supabase?.removeChannel(ch);
  } catch {
    // best-effort
  }
}

async function connect(userId: string, token: string): Promise<void> {
  connectedUserId = userId;
  connectedToken = token;
  try {
    await store.dispatch(usersApi.endpoints.presenceOnline.initiate()).unwrap();
  } catch {
    // The cron sweep will fix is_online if this one-shot drops; not fatal.
  }
  await joinChannel(userId, token);
}

async function disconnect(tokenForBeacon: string | null): Promise<void> {
  connectedUserId = null;
  connectedToken = null;
  await leaveChannel();
  sendOfflineBeacon(tokenForBeacon);
}

function sync(): void {
  const { status, userId, accessToken } = store.getState().auth;

  if (status === 'authenticated' && userId && accessToken) {
    lastKnownAccessToken = accessToken;

    if (connectedUserId !== userId) {
      // First login or a user switch in the same tab — full tear-down + join.
      void (async () => {
        if (connectedUserId) await disconnect(null);
        await connect(userId, accessToken);
      })();
    } else if (connectedToken !== accessToken) {
      // Same user, refreshed token — re-auth realtime in place; don't churn.
      supabase?.realtime.setAuth(accessToken);
      connectedToken = accessToken;
    }
    return;
  }

  if (connectedUserId) {
    void disconnect(lastKnownAccessToken);
    lastKnownAccessToken = null;
  }
}

/**
 * Three-layer presence driver:
 *
 * 1. REST POST /users/me/presence — fires once per session to flip
 *    `users.is_online = true` (the column read by friends/search/online lists).
 * 2. Supabase Realtime — joins a shared presence channel and `track()`s the
 *    user, so other clients get sub-second join/leave events. We don't
 *    consume those events here yet; the channel just publishes our state.
 * 3. DELETE on unload via `fetch({ keepalive: true })` — fires on `pagehide`
 *    and on sign-out so peers see offline immediately. The backend cron sweep
 *    is the backstop for missed beacons (~2-min stale threshold).
 *
 * Note: the cron sweep won't fire on Vercel serverless — switch to Vercel
 * Cron Jobs (or move the worker off Vercel) if you stay on this host.
 */
export function startPresence(): void {
  if (started) return;
  started = true;

  store.subscribe(sync);

  if (typeof window !== 'undefined') {
    // `pagehide` covers real unload and the bfcache freeze on iOS Safari,
    // where `beforeunload` doesn't reliably fire.
    window.addEventListener('pagehide', () => {
      const token =
        store.getState().auth.accessToken ?? lastKnownAccessToken;
      sendOfflineBeacon(token);
    });
  }

  sync();
}
