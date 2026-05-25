import type { RootState } from '@/store/store';

type AuthRequirement = 'authenticated' | 'unauthenticated' | 'any';

/**
 * Per-page auth requirement. Pages not listed default to 'any'.
 * Extend as more slices land (e.g., profile/members become 'authenticated').
 */
const pageAuth: Record<string, AuthRequirement> = {
  signup: 'unauthenticated',
  login: 'unauthenticated',
  profile: 'authenticated',
  members: 'authenticated',
  groups: 'authenticated',
};

// Root-absolute so the redirect target doesn't depend on the current path —
// e.g. /members/<uuid> rewrites to profile.html but stays in /members/* in the
// URL bar, so a relative 'login.html' from there resolves to /members/login,
// which the vercel.json rewrite then sends back to profile → redirect loop.
const POST_LOGIN_DESTINATION = '/profile.html';
const LOGIN_PAGE = '/login.html';

/**
 * Returns `true` if the page should continue rendering. Returns `false` (and
 * triggers a navigation) when the auth state mandates a redirect.
 */
export function enforceAuthGuard(page: string, state: RootState): boolean {
  const requirement = pageAuth[page] ?? 'any';
  const isAuthed = state.auth.status === 'authenticated';

  if (requirement === 'authenticated' && !isAuthed) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.replace(`${LOGIN_PAGE}?next=${next}`);
    return false;
  }
  if (requirement === 'unauthenticated' && isAuthed) {
    window.location.replace(POST_LOGIN_DESTINATION);
    return false;
  }
  return true;
}
