import { parseApiError } from '@/api/baseQuery';
import { profilesApi } from '@/api/profilesApi';
import { authApi } from '@/api/authApi';
import { registerPage, type PageBinder, type PageContext } from '@/pages';
import { escapeHtml, formatRelativeActive } from '@/lib/format';
import { renderPagination } from '@/lib/pagination';
import { signedOut } from '@/slices/authSlice';
import type {
  Gender,
  ProfileWithUserDto,
  SearchProfilesQuery,
} from '@/types/api';

const GENDER_LABEL_TO_VALUE: Record<string, Gender> = {
  male: 'male',
  female: 'female',
  others: 'other',
  other: 'other',
  'non binary': 'non_binary',
  'non-binary': 'non_binary',
};

const SORT_LABEL_TO_VALUE: Record<string, SearchProfilesQuery['sort']> = {
  'most active': 'most_active',
};

const FALLBACK_AVATAR = 'assets/images/member/01.jpg';

const bindMembers: PageBinder = async (ctx) => {
  const form = document.querySelector<HTMLFormElement>(
    'section.member-page-section form.filter-form',
  );
  const sortSelect = document.querySelector<HTMLSelectElement>(
    '#member-cat',
  );
  const grid = document.querySelector<HTMLElement>(
    'section.member-page-section .member-wrapper .row',
  );
  const totalNode = document.querySelector<HTMLElement>(
    '.all-member p:nth-child(2)',
  );
  const paginationList = document.querySelector<HTMLUListElement>(
    '.paginations ul',
  );

  if (!form || !grid) {
    console.warn('[members] expected anchors missing on this page');
    return;
  }

  let state: SearchProfilesQuery = {};

  const runSearch = async (): Promise<void> => {
    renderLoading(grid);
    try {
      const data = await ctx
        .dispatch(profilesApi.endpoints.searchProfiles.initiate(state))
        .unwrap();
      renderGrid(grid, data.items);
      if (totalNode) totalNode.textContent = data.total.toLocaleString();
      renderPagination(paginationList, data, (page) => {
        state = { ...state, page };
        void runSearch();
      });
    } catch (raw) {
      const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
      if (err?.code === 'INVALID_CREDENTIALS') {
        ctx.dispatch(signedOut());
        window.location.replace('login.html?next=members.html');
        return;
      }
      renderError(grid, err, ctx);
      if (totalNode) totalNode.textContent = '—';
      if (paginationList) paginationList.innerHTML = '';
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    state = { ...readFilters(form), sort: state.sort, page: 1 };
    void runSearch();
  });

  sortSelect?.addEventListener('change', () => {
    state = { ...state, sort: readSort(sortSelect), page: 1 };
    void runSearch();
  });

  // Initial empty-filter load so the page isn't blank on entry.
  void runSearch();
};

function readFilters(form: HTMLFormElement): SearchProfilesQuery {
  const data = new FormData(form);
  const out: SearchProfilesQuery = {};

  const genderOption = selectedOptionText(form, 'gender');
  const genderValue = mapGender(genderOption);
  if (genderValue) out.gender = genderValue;

  const seekingOption = selectedOptionText(form, 'seeking');
  const seekingValue = mapGender(seekingOption);
  if (seekingValue) out.seeking = seekingValue;

  const minAge = parseAge(selectedOptionText(form, 'age-start'));
  if (minAge) out.minAge = minAge;
  const maxAge = parseAge(selectedOptionText(form, 'age-end'));
  if (maxAge) out.maxAge = maxAge;

  const countryOption = selectedOptionText(form, 'country');
  if (countryOption && !/choose/i.test(countryOption)) out.country = countryOption;

  const q = (data.get('q') as string | null)?.trim();
  if (q) out.q = q;

  return out;
}

function readSort(select: HTMLSelectElement): SearchProfilesQuery['sort'] {
  const text = select.options[select.selectedIndex]?.text.trim().toLowerCase() ?? '';
  return SORT_LABEL_TO_VALUE[text];
}

function selectedOptionText(
  form: HTMLFormElement,
  name: string,
): string | null {
  const select = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (!select) return null;
  const opt = select.options[select.selectedIndex];
  return opt ? opt.text.trim() : null;
}

function mapGender(label: string | null): Gender | undefined {
  if (!label) return undefined;
  if (/^(i am a|looking for)$/i.test(label)) return undefined;
  return GENDER_LABEL_TO_VALUE[label.toLowerCase()];
}

function parseAge(label: string | null): number | undefined {
  if (!label) return undefined;
  const n = Number(label);
  return Number.isFinite(n) && n >= 18 && n <= 120 ? n : undefined;
}

function renderLoading(grid: HTMLElement): void {
  grid.innerHTML = `
    <div class="col" style="grid-column:1/-1;text-align:center;padding:32px 0;opacity:0.7;">
      <p>Loading members…</p>
    </div>
  `;
}

function renderGrid(grid: HTMLElement, items: ProfileWithUserDto[]): void {
  if (items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 0;opacity:0.8;">
        <p>No members match your filters.</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = items.map(cardHtml).join('');
}

function cardHtml(item: ProfileWithUserDto): string {
  const name = escapeHtml(item.displayName || item.user.username);
  const avatar = item.avatarUrl ? escapeHtml(item.avatarUrl) : FALLBACK_AVATAR;
  const activeText = item.user.isOnline
    ? 'Active now'
    : escapeHtml(formatRelativeActive(item.user.lastActiveAt));
  const href = `members/${encodeURIComponent(item.user.id)}`;
  return `
    <div class="col">
      <div class="lab-item member-item style-1 style-2" data-app-user-id="${escapeHtml(item.user.id)}">
        <a href="${href}" class="lab-inner" style="text-decoration:none;color:inherit;">
          <div class="lab-thumb">
            <img src="${avatar}" alt="${name}">
          </div>
          <div class="lab-content">
            <h6><span>${name}</span></h6>
            <p>${activeText}</p>
          </div>
        </a>
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
  const message = err?.message ?? 'Something went wrong loading members.';
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:48px 0;">
      <p style="color:#e84a5f;">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderVerifyBanner(grid: HTMLElement, ctx: PageContext): void {
  grid.innerHTML = `
    <div style="grid-column:1/-1;padding:32px;border:1px solid #3a1f24;border-radius:8px;background:#1f1418;text-align:center;">
      <h4 style="margin:0 0 12px;">Verify your email to browse members</h4>
      <p style="margin:0 0 16px;opacity:0.85;">
        Click the verification link we sent to your email, then come back and refresh.
      </p>
      <button class="lab-btn" type="button" data-app-action="resend-from-members">
        <span>Resend verification email</span>
      </button>
      <p data-app-target="resend-status" style="margin-top:12px;min-height:1em;opacity:0.85;"></p>
    </div>
  `;
  const button = grid.querySelector<HTMLButtonElement>(
    '[data-app-action="resend-from-members"]',
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

registerPage('members', bindMembers);
