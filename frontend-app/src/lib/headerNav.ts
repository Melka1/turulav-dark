import { authApi } from '@/api/authApi';
import { blogApi } from '@/api/blogApi';
import { usernameFromJwt } from '@/lib/authCallback';
import { cachePosts } from '@/lib/blogCache';
import { escapeHtml } from '@/lib/format';
import { signedOut } from '@/slices/authSlice';
import type { AppDispatch, RootState } from '@/store/store';
import type { BlogPostDto } from '@/types/api';

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

function hrefBasename(href: string): string {
  const path = href.split('?')[0]?.split('#')[0] ?? '';
  return path.split('/').pop() ?? '';
}

export function applyHeaderNav(state: RootState, dispatch: AppDispatch): void {
  const isAuthed = state.auth.status === 'authenticated';
  if (isAuthed) {
    switchToAuthed(state.auth.accessToken, dispatch);
  }
  void populateBlogDropdown(dispatch);
}

/**
 * Replaces the static "Blog / Blog Single" submenu under the Blog top-level
 * nav with "All Posts" plus the N most recent posts. Runs on every page load
 * — failures are silent (the static placeholder stays). Also primes the
 * blog cache so a click into a single post renders without a fetch.
 */
const DROPDOWN_LIMIT = 5;

async function populateBlogDropdown(dispatch: AppDispatch): Promise<void> {
  const submenu = findBlogSubmenu();
  if (!submenu) return;

  let posts: BlogPostDto[] = [];
  try {
    const data = await dispatch(
      blogApi.endpoints.listBlogPosts.initiate({
        limit: DROPDOWN_LIMIT,
        sort: 'recent',
      }),
    ).unwrap();
    posts = data.items;
  } catch {
    return;
  }

  cachePosts(posts);

  const currentSlug = currentBlogSlug();
  const items: string[] = [];
  // Clean URLs — `.html` triggers a query-string-dropping 301 under cleanUrls.
  items.push(submenuItem('All Posts', 'blog', isOnBlogList()));
  for (const post of posts) {
    const href = `blog-single?slug=${encodeURIComponent(post.slug)}`;
    items.push(submenuItem(post.title, href, post.slug === currentSlug));
  }
  submenu.innerHTML = items.join('');
}

function findBlogSubmenu(): HTMLUListElement | null {
  const items = document.querySelectorAll<HTMLLIElement>('.menu > li');
  for (const li of items) {
    const anchor = li.querySelector(':scope > a');
    const label = anchor?.textContent?.trim().toLowerCase();
    if (label === 'blog') {
      return li.querySelector<HTMLUListElement>(':scope > ul.submenu');
    }
  }
  return null;
}

function submenuItem(label: string, href: string, active: boolean): string {
  const cls = active ? ' class="active"' : '';
  return `<li><a href="${escapeHtml(href)}"${cls}>${escapeHtml(label)}</a></li>`;
}

function isOnBlogList(): boolean {
  return document.body.getAttribute('data-app-page') === 'blog';
}

function currentBlogSlug(): string | null {
  if (document.body.getAttribute('data-app-page') !== 'blog-single') return null;
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  return slug ? slug.trim() : null;
}

function switchToAuthed(accessToken: string | null, dispatch: AppDispatch): void {
  const menuArea = document.querySelector<HTMLElement>('.menu-area');
  if (!menuArea) return;

  const loginBtn = menuArea.querySelector<HTMLAnchorElement>('a.login');
  const signupBtn = menuArea.querySelector<HTMLAnchorElement>('a.signup');

  const username = accessToken ? usernameFromJwt(accessToken) : null;
  const profileLabel = (username ?? 'My profile').toUpperCase();

  if (loginBtn) {
    loginBtn.setAttribute('href', '/members/me');
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
      if ((SUBMENU_AUTH_LINKS as readonly string[]).includes(hrefBasename(href))) {
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
      window.location.replace('/login.html');
    }
  });
}
