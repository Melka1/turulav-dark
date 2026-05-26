import { parseApiError } from '@/api/baseQuery';
import { profilesApi } from '@/api/profilesApi';
import { usersApi } from '@/api/usersApi';
import { authApi } from '@/api/authApi';
import { registerPage, type PageBinder, type PageContext } from '@/pages';
import { escapeHtml, formatRelativeActive } from '@/lib/format';
import { renderPagination } from '@/lib/pagination';
import {
  applyProfileDefaultsToFilterForm,
  applyStateToMembersForm,
  parseFilterStateFromUrl,
  readMembersFilterForm,
} from '@/lib/memberFilter';
import { PROFESSIONS } from '@/lib/professions';
import { signedOut } from '@/slices/authSlice';
import type {
  ProfileWithUserDto,
  SearchProfilesQuery,
} from '@/types/api';

const SORT_LABEL_TO_VALUE: Record<string, SearchProfilesQuery['sort']> = {
  'most active': 'most_active',
};

const FALLBACK_AVATAR = 'assets/images/member/01.jpg';

type OptionalFilterId = 'age' | 'country' | 'profession' | 'city' | 'q';

type OptionalFilterSpec = {
  id: OptionalFilterId;
  label: string;
  /** Class applied to the wrapper div so existing `.age`/`.city`-targeted CSS rules still apply. */
  wrapperClass?: string;
  /** True when this filter has any meaningful value in the given state. */
  hasValue: (state: SearchProfilesQuery) => boolean;
  renderControl: (state: SearchProfilesQuery) => string;
};

/** Filters that are shown on a cold visit; can still be removed via the × button. */
const DEFAULT_VISIBLE: ReadonlyArray<OptionalFilterId> = ['age', 'country'];

const COUNTRY_OPTIONS: ReadonlyArray<string> = [
  'USA',
  'UK',
  'Spain',
  'Brazil',
  'France',
  'Newzeland',
  'Australia',
  'Bangladesh',
  'Turki',
  'Chine',
  'India',
  'Canada',
];

function ageOptions(selected: number | undefined): string {
  const parts = ['<option value="">Any</option>'];
  for (let a = 18; a <= 65; a++) {
    parts.push(
      `<option value="${a}"${a === selected ? ' selected' : ''}>${a}</option>`,
    );
  }
  return parts.join('');
}

// Match the look of the fixed filter inputs (orange theme, see
// `.member-filter .member-filter-inner .filter-form .custom-select select`
// in style.css). Selects ride the existing CSS via `.custom-select`; inputs
// have no equivalent rule so we apply the same look inline.
const EXTRA_INPUT_STYLE =
  'background:#fa8128;color:#fff;border:1px solid rgba(255,255,255,0.1);padding:7px 10px;outline:none;box-shadow:none;width:100%;';

const OPTIONAL_FILTERS: ReadonlyArray<OptionalFilterSpec> = [
  {
    id: 'age',
    label: 'Age range',
    wrapperClass: 'age',
    hasValue: (s) => Boolean(s.minAge || s.maxAge),
    renderControl: (s) => `
      <div class="right d-flex justify-content-between w-100">
        <div class="custom-select">
          <select name="age-start">${ageOptions(s.minAge)}</select>
        </div>
        <div class="custom-select">
          <select name="age-end">${ageOptions(s.maxAge)}</select>
        </div>
      </div>
    `,
  },
  {
    id: 'country',
    label: 'Country',
    hasValue: (s) => Boolean(s.country),
    renderControl: (s) => {
      const options = [
        '<option value="">Choose Your Country</option>',
        ...COUNTRY_OPTIONS.map(
          (c) =>
            `<option value="${escapeHtml(c)}"${c === s.country ? ' selected' : ''}>${escapeHtml(c)}</option>`,
        ),
      ].join('');
      return `<div class="custom-select right w-100"><select name="country">${options}</select></div>`;
    },
  },
  {
    id: 'profession',
    label: 'Profession',
    hasValue: (s) => Boolean(s.profession),
    renderControl: (s) => {
      const options = [
        '<option value="">Profession</option>',
        ...PROFESSIONS.map(
          (p) =>
            `<option value="${escapeHtml(p.key)}"${p.key === s.profession ? ' selected' : ''}>${escapeHtml(p.label)}</option>`,
        ),
      ].join('');
      return `<div class="custom-select right w-100"><select name="profession">${options}</select></div>`;
    },
  },
  {
    id: 'city',
    label: 'City',
    hasValue: (s) => Boolean(s.city),
    renderControl: (s) =>
      `<input type="text" name="city" placeholder="City" value="${escapeHtml(s.city ?? '')}" style="${EXTRA_INPUT_STYLE}" />`,
  },
  {
    id: 'q',
    label: 'Search by name',
    hasValue: (s) => Boolean(s.q),
    renderControl: (s) =>
      `<input type="text" name="q" placeholder="Search by name" value="${escapeHtml(s.q ?? '')}" style="${EXTRA_INPUT_STYLE}" />`,
  },
];

function setupDynamicFilters(
  form: HTMLFormElement,
  initial: SearchProfilesQuery,
): void {
  const extrasContainer = form.querySelector<HTMLElement>(
    '[data-app-filter-extras]',
  );
  const addDetails = form.querySelector<HTMLDetailsElement>(
    '[data-app-filter-add]',
  );
  const menu = form.querySelector<HTMLUListElement>('[data-app-filter-menu]');
  if (!extrasContainer || !addDetails || !menu) return;

  // Defaults are always shown on cold load; any filter with a URL value also
  // shows so a redirected search (e.g. ?profession=PHOTOGRAPHER from the home
  // banner) lands with that control already populated and visible.
  const visible = new Set<OptionalFilterId>(DEFAULT_VISIBLE);
  for (const f of OPTIONAL_FILTERS) {
    if (f.hasValue(initial)) visible.add(f.id);
  }

  /**
   * Best-effort read of the current value(s) of a rendered filter so we
   * don't lose user edits when re-rendering after an add/remove.
   */
  const currentState = (): SearchProfilesQuery => {
    const out: SearchProfilesQuery = { ...initial };
    for (const f of OPTIONAL_FILTERS) {
      if (!visible.has(f.id)) continue;
      if (f.id === 'age') {
        const min = form.querySelector<HTMLSelectElement>('select[name="age-start"]')?.value;
        const max = form.querySelector<HTMLSelectElement>('select[name="age-end"]')?.value;
        out.minAge = min ? Number(min) : undefined;
        out.maxAge = max ? Number(max) : undefined;
      } else {
        const node = form.querySelector<HTMLInputElement | HTMLSelectElement>(
          `[name="${f.id}"]`,
        );
        if (node) (out as Record<string, unknown>)[f.id] = node.value || undefined;
      }
    }
    return out;
  };

  const renderExtras = (): void => {
    const state = currentState();
    extrasContainer.innerHTML = OPTIONAL_FILTERS.filter((f) => visible.has(f.id))
      .map((f) => {
        const wrapperClass = f.wrapperClass ? ` class="${f.wrapperClass}"` : '';
        return `
          <div data-app-extra="${f.id}"${wrapperClass} style="position:relative;">
            ${f.renderControl(state)}
            <button
              type="button"
              data-app-remove="${f.id}"
              aria-label="Remove ${escapeHtml(f.label)} filter"
              style="position:absolute;top:-8px;right:-8px;width:20px;height:20px;background:#c2185b;color:#fff;border:0;border-radius:50%;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:2;"
            >×</button>
          </div>
        `;
      })
      .join('');
  };

  const renderMenu = (): void => {
    const available = OPTIONAL_FILTERS.filter((f) => !visible.has(f.id));
    if (available.length === 0) {
      menu.innerHTML = `<li style="padding:8px 14px;color:#888;font-size:13px;">No more filters</li>`;
      return;
    }
    menu.innerHTML = available
      .map(
        (f) =>
          `<li><button type="button" data-app-add="${f.id}" style="display:block;width:100%;text-align:left;background:transparent;border:0;color:#eee;padding:8px 14px;cursor:pointer;font:inherit;">${escapeHtml(f.label)}</button></li>`,
      )
      .join('');
  };

  extrasContainer.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-app-remove]',
    );
    if (!btn) return;
    const id = btn.dataset.appRemove as OptionalFilterId;
    visible.delete(id);
    renderExtras();
    renderMenu();
  });

  menu.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-app-add]',
    );
    if (!btn) return;
    const id = btn.dataset.appAdd as OptionalFilterId;
    visible.add(id);
    renderExtras();
    renderMenu();
    addDetails.open = false;
  });

  document.addEventListener('click', (event) => {
    if (!addDetails.contains(event.target as Node)) addDetails.open = false;
  });

  renderExtras();
  renderMenu();
}

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

  // Seed the form. URL params are an explicit user intent (e.g. they just
  // submitted the home banner) and should win wholesale — combining them with
  // profile defaults would silently add gender/seeking/country filters the
  // user never picked, narrowing results unexpectedly. Profile prefill only
  // runs on a cold visit with no URL filters.
  //
  // Order matters: setupDynamicFilters renders the dynamic controls
  // (age/country/profession/city/q) — only after that can the prefill
  // / apply-URL helpers find those `<select>` and `<input>` nodes.
  const urlState = parseFilterStateFromUrl(window.location.search);
  const hasUrlFilters = Object.keys(urlState).length > 0;
  setupDynamicFilters(form, urlState);
  if (!hasUrlFilters) {
    await prefillFromProfile(ctx, form);
  }
  applyStateToMembersForm(form, urlState);

  let state: SearchProfilesQuery = { ...readMembersFilterForm(form), ...urlState };

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
        window.location.replace('/login.html?next=/members');
        return;
      }
      renderError(grid, err, ctx);
      if (totalNode) totalNode.textContent = '—';
      if (paginationList) paginationList.innerHTML = '';
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // `profession` and `city` are now read directly from injected controls
    // when their filter rows are visible — removing the row drops the value
    // by design. `viewerProfession` has no in-page control, so we preserve it
    // across resubmits from its initial URL state.
    state = {
      ...readMembersFilterForm(form),
      viewerProfession: state.viewerProfession,
      sort: state.sort,
      page: 1,
    };
    void runSearch();
  });

  sortSelect?.addEventListener('change', () => {
    state = { ...state, sort: readSort(sortSelect), page: 1 };
    void runSearch();
  });

  void runSearch();
};

async function prefillFromProfile(
  ctx: PageContext,
  form: HTMLFormElement,
): Promise<void> {
  if (ctx.getState().auth.status !== 'authenticated') return;
  try {
    const me = await ctx
      .dispatch(usersApi.endpoints.getMe.initiate())
      .unwrap();
    applyProfileDefaultsToFilterForm(form, me.profile);
  } catch {
    // Pre-fill is best-effort — a failure here just leaves the dropdowns
    // empty, which is the prior behavior.
  }
}

function readSort(select: HTMLSelectElement): SearchProfilesQuery['sort'] {
  const text = select.options[select.selectedIndex]?.text.trim().toLowerCase() ?? '';
  return SORT_LABEL_TO_VALUE[text];
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
  const name = escapeHtml(item.displayName || item.username);
  const avatar = item.avatarUrl ? escapeHtml(item.avatarUrl) : FALLBACK_AVATAR;
  const activeText = item.isOnline
    ? 'Active now'
    : escapeHtml(formatRelativeActive(item.lastActiveAt));
  const href = `/members/${encodeURIComponent(item.userId)}`;
  return `
    <div class="col">
      <div class="lab-item member-item style-1 style-2" data-app-user-id="${escapeHtml(item.userId)}">
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
