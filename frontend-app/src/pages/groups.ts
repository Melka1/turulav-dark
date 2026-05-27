import { parseApiError } from '@/api/baseQuery';
import { authApi } from '@/api/authApi';
import { groupsApi } from '@/api/groupsApi';
import { registerPage, type PageBinder, type PageContext } from '@/pages';
import { escapeHtml } from '@/lib/format';
import { renderGroupAvatarStack } from '@/lib/groupAvatarStack';
import { renderPagination } from '@/lib/pagination';
import { signedOut } from '@/slices/authSlice';
import type { GroupDto, SearchGroupsQuery } from '@/types/api';

const FALLBACK_AVATAR = 'assets/images/group/01.jpg';

const bindGroups: PageBinder = async (ctx) => {
  const form = document.querySelector<HTMLFormElement>(
    'form[data-app-form="groups-search"]',
  );
  const queryInput = form?.querySelector<HTMLInputElement>('input[name="q"]') ?? null;
  const grid = document.querySelector<HTMLElement>(
    'section.group-page-section .groups-wrapper .row',
  );
  const totalNode = document.querySelector<HTMLElement>(
    '.group-search .group-count p:nth-child(2)',
  );
  const paginationList = document.querySelector<HTMLUListElement>(
    'section.group-page-section .paginations ul',
  );

  if (!form || !grid) {
    console.warn('[groups] expected anchors missing on this page');
    return;
  }

  let state: SearchGroupsQuery = { page: 1, limit: 20 };
  let joinedIds: Set<string> = new Set();

  // Fire /groups/me alongside the first /groups/search so cards know which
  // ones the viewer has joined. Failures here are non-fatal — we just render
  // without "Joined" badges.
  void ctx
    .dispatch(groupsApi.endpoints.getMyGroups.initiate())
    .unwrap()
    .then((mine) => {
      joinedIds = new Set(mine.map((g) => g.id));
      // If the initial /groups/search already rendered, repaint with badges.
      const data = currentResult();
      if (data) renderGrid(grid, data.items, joinedIds);
    })
    .catch(() => undefined);

  const currentResult = (): { items: GroupDto[] } | null => {
    const sel = groupsApi.endpoints.searchGroups.select(state)(ctx.getState());
    return sel.data ?? null;
  };

  const runSearch = async (): Promise<void> => {
    renderLoading(grid);
    try {
      const data = await ctx
        .dispatch(groupsApi.endpoints.searchGroups.initiate(state))
        .unwrap();
      renderGrid(grid, data.items, joinedIds);
      if (totalNode) totalNode.textContent = data.total.toLocaleString();
      renderPagination(paginationList, data, (page) => {
        state = { ...state, page };
        void runSearch();
      });
    } catch (raw) {
      const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
      if (err?.code === 'INVALID_CREDENTIALS') {
        ctx.dispatch(signedOut());
        window.location.replace('/login.html?next=/active-group');
        return;
      }
      renderError(grid, err, ctx);
      if (totalNode) totalNode.textContent = '—';
      if (paginationList) paginationList.innerHTML = '';
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = queryInput?.value.trim() ?? '';
    state = { ...state, q: q || undefined, page: 1 };
    void runSearch();
  });

  void runSearch();
};

function renderLoading(grid: HTMLElement): void {
  grid.innerHTML = `
    <div class="col-12" style="text-align:center;padding:32px 0;opacity:0.7;">
      <p>Loading groups…</p>
    </div>
  `;
}

function renderGrid(
  grid: HTMLElement,
  items: GroupDto[],
  joinedIds: Set<string>,
): void {
  if (items.length === 0) {
    grid.innerHTML = `
      <div class="col-12" style="text-align:center;padding:48px 0;opacity:0.8;">
        <p>No groups match your search.</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = items.map((g) => cardHtml(g, joinedIds.has(g.id))).join('');
}

function cardHtml(group: GroupDto, joined: boolean): string {
  const name = escapeHtml(group.name);
  const description = escapeHtml(group.description ?? '');
  const avatar = group.avatarUrl ? escapeHtml(group.avatarUrl) : FALLBACK_AVATAR;
  const joinedBadge = joined
    ? `<span class="badge bg-theme" style="margin-left:8px;font-size:0.75rem;">Joined</span>`
    : '';
  return `
    <div class="col-lg-6">
      <div class="group-item lab-item style-1" data-app-group-slug="${escapeHtml(group.slug)}">
        <div class="lab-inner d-flex flex-wrap align-items-center p-4">
          <div class="lab-thumb me-md-4 mb-4 mb-md-0">
            <img src="${avatar}" alt="${name}">
          </div>
          <div class="lab-content">
            <h4>${name}${joinedBadge}</h4>
            <p>${description || '—'}</p>
            <ul class="img-stack d-flex">
              ${renderGroupAvatarStack(group)}
            </ul>
            <div class="test">
              <a href="#" class="lab-btn" data-app-group-slug="${escapeHtml(group.slug)}">
                <i class="icofont-users-alt-5"></i>View Group
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderError(
  grid: HTMLElement,
  err: ReturnType<typeof parseApiError>,
  ctx: PageContext,
): void {
  if (err?.code === 'EMAIL_UNVERIFIED') {
    renderVerifyBanner(grid, ctx);
    return;
  }
  const message = err?.message ?? 'Something went wrong loading groups.';
  grid.innerHTML = `
    <div class="col-12" style="text-align:center;padding:48px 0;">
      <p style="color:#e84a5f;">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderVerifyBanner(grid: HTMLElement, ctx: PageContext): void {
  grid.innerHTML = `
    <div class="col-12">
      <div style="padding:32px;border:1px solid #3a1f24;border-radius:8px;background:#1f1418;text-align:center;">
        <h4 style="margin:0 0 12px;">Verify your email to browse community</h4>
        <p style="margin:0 0 16px;opacity:0.85;">
          Click the verification link we sent to your email, then come back and refresh.
        </p>
        <button class="lab-btn" type="button" data-app-action="resend-from-groups">
          <span>Resend verification email</span>
        </button>
        <p data-app-target="resend-status" style="margin-top:12px;min-height:1em;opacity:0.85;"></p>
      </div>
    </div>
  `;
  const button = grid.querySelector<HTMLButtonElement>(
    '[data-app-action="resend-from-groups"]',
  );
  const status = grid.querySelector<HTMLElement>(
    '[data-app-target="resend-status"]',
  );
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    const email = readEmailFromJwt(ctx);
    if (!email) {
      status.textContent = 'Sign out and back in to resend the email.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Sending…';
    try {
      await ctx
        .dispatch(authApi.endpoints.resendVerification.initiate({ email }))
        .unwrap();
      status.textContent = `Sent to ${email}. Check your inbox.`;
    } catch {
      status.textContent = 'Could not resend right now. Please try again.';
      button.disabled = false;
    }
  });
}

function readEmailFromJwt(ctx: PageContext): string | null {
  const token = ctx.getState().auth.accessToken;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

registerPage('groups', bindGroups);
