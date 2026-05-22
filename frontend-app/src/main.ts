import { store } from '@/store/store';
import { env } from '@/env';
import { readCurrentPage, runPage } from '@/pages';
import { enforceAuthGuard } from '@/lib/authGuard';
import { applyHeaderNav } from '@/lib/headerNav';
import { applyPasswordToggles } from '@/lib/passwordToggle';
import { authApi } from '@/api/authApi';
import { signedOut, tokensRefreshed } from '@/slices/authSlice';
import '@/pages/binders';

declare global {
  interface Window {
    __TURULAV__?: {
      store: typeof store;
      env: typeof env;
    };
  }
}

/**
 * On page load, if the stored access token is past its expiry but a refresh
 * token is still on hand, swap it out before any page code runs. Without this,
 * the very first request would 401, the base query would refresh, and the page
 * would flicker through an unauthenticated state.
 */
async function refreshIfExpired(): Promise<void> {
  const { accessToken, refreshToken, expiresAt } = store.getState().auth;
  if (!accessToken || !refreshToken) return;
  const isExpired = !!expiresAt && Date.parse(expiresAt) <= Date.now();
  if (!isExpired) return;

  try {
    const result = await store
      .dispatch(authApi.endpoints.refresh.initiate({ refreshToken }))
      .unwrap();
    const newExpiresAt = new Date(
      Date.now() + result.session.expiresIn * 1000,
    ).toISOString();
    store.dispatch(
      tokensRefreshed({
        accessToken: result.session.accessToken,
        expiresAt: newExpiresAt,
      }),
    );
  } catch {
    store.dispatch(signedOut());
  }
}

async function boot(): Promise<void> {
  if (env.useMocks) {
    const { startMocks } = await import('@/mocks/browser');
    try {
      await startMocks();
    } catch (err) {
      console.error('[boot] MSW failed to start', err);
    }
  }

  window.__TURULAV__ = { store, env };

  await refreshIfExpired();

  const page = readCurrentPage();
  console.info(`[boot] page="${page}" mode=${env.mode} mocks=${env.useMocks}`);

  if (!enforceAuthGuard(page, store.getState())) return;

  applyHeaderNav(store.getState(), store.dispatch);
  applyPasswordToggles();

  await runPage({ page, dispatch: store.dispatch, getState: store.getState });
  applyPasswordToggles();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void boot();
  });
} else {
  void boot();
}
