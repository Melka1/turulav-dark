import { authApi } from '@/api/authApi';
import { signedOut, tokensRefreshed } from '@/slices/authSlice';
import { store } from '@/store/store';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

let timerId: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<void> | null = null;

async function refreshNow(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = store.getState().auth.refreshToken;
  if (!refreshToken) return;

  refreshInFlight = (async () => {
    try {
      const result = await store
        .dispatch(authApi.endpoints.refresh.initiate({ refreshToken }))
        .unwrap();
      const expiresAt = new Date(
        Date.now() + result.session.expiresIn * 1000,
      ).toISOString();
      store.dispatch(
        tokensRefreshed({
          accessToken: result.session.accessToken,
          refreshToken: result.session.refreshToken,
          expiresAt,
        }),
      );
    } catch {
      store.dispatch(signedOut());
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

function startTimer(): void {
  if (timerId !== null) return;
  timerId = setInterval(() => {
    void refreshNow();
  }, REFRESH_INTERVAL_MS);
}

function stopTimer(): void {
  if (timerId === null) return;
  clearInterval(timerId);
  timerId = null;
}

/**
 * Keep the access token warm while the user is signed in. The base query already
 * refreshes reactively (on 401) and proactively (when expiresAt is in the past
 * at request time), but a tab that sits idle making no requests would otherwise
 * carry a stale access token until the next click. The hourly tick refreshes in
 * the background so the session never goes cold mid-session.
 *
 * Wired to `auth.status` via a store subscription: signedOut() — from explicit
 * logout or a failed refresh — automatically clears the timer.
 */
export function startTokenRefreshScheduler(): void {
  const sync = (): void => {
    const isAuthed = store.getState().auth.status === 'authenticated';
    if (isAuthed) startTimer();
    else stopTimer();
  };
  sync();
  store.subscribe(sync);
}
