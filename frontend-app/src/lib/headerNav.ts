import { authApi } from '@/api/authApi';
import { usernameFromJwt } from '@/lib/authCallback';
import { signedOut } from '@/slices/authSlice';
import type { AppDispatch, RootState } from '@/store/store';

/**
 * Site-wide nav swap. Every `*.html` page ships the template's static
 * "LOG IN / SIGN UP" pair inside `.menu-area`; when the user is authenticated
 * we replace those two anchors (same classes, same shape) with "{username} /
 * SIGN OUT" and remove the Login/Sign Up entries from the dropdown.
 *
 * Reuses the existing `.login` and `.signup` CSS so the buttons stay visually
 * identical across pages — only label, icon, href, and click target change.
 */

const SUBMENU_AUTH_LINKS = [
  'login.html',
  'signup.html',
] as const;

export function applyHeaderNav(state: RootState, dispatch: AppDispatch): void {
  const isAuthed = state.auth.status === 'authenticated';
  if (isAuthed) {
    switchToAuthed(state.auth.accessToken, dispatch);
  }
}

function switchToAuthed(accessToken: string | null, dispatch: AppDispatch): void {
  const menuArea = document.querySelector<HTMLElement>('.menu-area');
  if (!menuArea) return;

  const loginBtn = menuArea.querySelector<HTMLAnchorElement>('a.login');
  const signupBtn = menuArea.querySelector<HTMLAnchorElement>('a.signup');

  const username = accessToken ? usernameFromJwt(accessToken) : null;
  const profileLabel = (username ?? 'My profile').toUpperCase();

  if (loginBtn) {
    loginBtn.setAttribute('href', 'members/me');
    loginBtn.setAttribute('data-app-nav', 'profile');
    const iconEl = loginBtn.querySelector('i');
    if (iconEl) iconEl.className = 'icofont-user';
    const labelEl = loginBtn.querySelector('span');
    if (labelEl) labelEl.textContent = profileLabel;
  }

  if (signupBtn) {
    signupBtn.setAttribute('href', '#');
    signupBtn.setAttribute('data-app-action', 'signout');
    signupBtn.setAttribute('data-app-nav', 'signout');
    const iconEl = signupBtn.querySelector('i');
    if (iconEl) iconEl.className = 'icofont-power';
    const labelEl = signupBtn.querySelector('span');
    if (labelEl) labelEl.textContent = 'SIGN OUT';
    bindSignOut(signupBtn, dispatch);
  }

  // Hide Login / Sign Up entries in the dropdown submenu.
  menuArea
    .querySelectorAll<HTMLLIElement>('ul.submenu li')
    .forEach((li) => {
      const href = li.querySelector('a')?.getAttribute('href') ?? '';
      if ((SUBMENU_AUTH_LINKS as readonly string[]).includes(href)) {
        li.style.display = 'none';
      }
    });
}

function bindSignOut(button: HTMLAnchorElement, dispatch: AppDispatch): void {
  if (button.dataset.appBound === '1') return;
  button.dataset.appBound = '1';
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await dispatch(authApi.endpoints.logout.initiate())
        .unwrap()
        .catch(() => undefined);
    } finally {
      dispatch(signedOut());
      window.location.replace('login.html');
    }
  });
}
