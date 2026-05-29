import { store } from '@/store/store';
import { env } from '@/env';
import { readCurrentPage, runPage } from '@/pages';
import { enforceAuthGuard } from '@/lib/authGuard';
import { applyHeaderNav } from '@/lib/headerNav';
import { applyPasswordToggles } from '@/lib/passwordToggle';
import { mountToastContainer } from '@/lib/toast';
import { startTokenRefreshScheduler } from '@/lib/tokenRefreshScheduler';
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
        refreshToken: result.session.refreshToken,
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

  mountToastContainer();
  neutralizeHashLinks();

  await refreshIfExpired();
  startTokenRefreshScheduler();
  // Presence heartbeat paused — too chatty. Re-enable when we throttle further.
  // startPresenceHeartbeat();

  const page = readCurrentPage();
  console.info(`[boot] page="${page}" mode=${env.mode} mocks=${env.useMocks}`);

  if (!enforceAuthGuard(page, store.getState())) return;

  applyHeaderNav(store.getState(), store.dispatch);
  applyPasswordToggles();

  await runPage({ page, dispatch: store.dispatch, getState: store.getState });
  applyPasswordToggles();
}

/**
 * Template ships dozens of decorative `<a href="#">` / `href="#0"` placeholders
 * (social icons, dropdown carets, etc.). On pages with `<base href="/">` —
 * e.g. blog-single.html, where we need it for the /blog/:slug rewrite —
 * those would resolve to `/#` and yank the user back to the home page.
 * Swallow the click instead.
 */
function neutralizeHashLinks(): void {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (href === '#' || href === '#0') event.preventDefault();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void boot();
  });
} else {
  void boot();
}
