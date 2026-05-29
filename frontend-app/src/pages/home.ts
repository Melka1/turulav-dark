import { parseApiError } from '@/api/baseQuery';
import { profilesApi } from '@/api/profilesApi';
import { usersApi } from '@/api/usersApi';
import { registerPage, type PageBinder, type PageContext } from '@/pages';
import { escapeHtml, formatRelativeActive } from '@/lib/format';
import {
  bindRedirectFilter,
  bindSidebarMemberFilters,
  readHomeBannerForm,
} from '@/lib/memberFilter';
import { formatProfession } from '@/lib/professions';
const ONLINE_FILTER_ALL = '__all__';
import type { NewMemberItemDto, ProfileWithUserDto } from '@/types/api';

const NEW_MEMBERS_LIMIT = 10;
const ONLINE_MEMBERS_LIMIT = 10;
const FALLBACK_AVATAR = 'assets/images/member/01.jpg';
const SHIMMER_STYLE_ID = 'app-home-shimmer-style';

/**
 * The home page banner-form is profession-flavoured ("I am a Painter / Looking
 * for Photographer / City") and lives in `.banner-section`. It redirects to
 * /members.html with the chosen filters. Any sidebar widgets on the page reuse
 * the standard gender-based redirect via bindSidebarMemberFilters().
 */
const bindHome: PageBinder = async (ctx) => {
  void bindSidebarMemberFilters(ctx);

  const form = document.querySelector<HTMLFormElement>(
    'section.banner-section form.banner-form',
  );
  if (form) {
    const viewerHasProfession = await prefillHomeProfession(ctx, form);
    // The "I am a" select represents the viewer's own profession. When the
    // signed-in viewer already has a profession on their profile, re-asking
    // is noise — hide the row and drop it from the URL. Guests (and signed-in
    // viewers without a profession) still see and submit the field, since the
    // backend has no other source for it.
    if (viewerHasProfession) {
      const wrap = form.querySelector<HTMLElement>('.gender');
      if (wrap) wrap.style.display = 'none';
    }
    bindRedirectFilter(form, (f) => {
      const state = readHomeBannerForm(f);
      if (ctx.getState().auth.status === 'authenticated') {
        delete state.viewerProfession;
      }
      return state;
    });
  }

  void loadNewMembers(ctx);
  void loadOnlineMembers(ctx);
};

async function prefillHomeProfession(
  ctx: PageContext,
  form: HTMLFormElement,
): Promise<boolean> {
  if (ctx.getState().auth.status !== 'authenticated') return false;
  try {
    const me = await ctx
      .dispatch(usersApi.endpoints.getMe.initiate())
      .unwrap();
    const label = formatProfession(me.profile.profession);
    if (!label) return false;
    const select = form.querySelector<HTMLSelectElement>('select#gender');
    if (!select) return true;
    const target = label.trim().toLowerCase();
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i]!.text.trim().toLowerCase() === target) {
        select.selectedIndex = i;
        break;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function loadOnlineMembers(ctx: PageContext): Promise<void> {
  const grid = document.querySelector<HTMLElement>(
    'section.top-member-section .grid-memberlist',
  );
  if (!grid) return;

  const filterButtons = document.querySelector<HTMLElement>(
    'section.top-member-section .button-group',
  );
  if (filterButtons) filterButtons.innerHTML = '';

  // The template's functions.js initialises Isotope on `.grid-memberlist`
  // at `window.load`, which absolute-positions items and fixes the container
  // height. We rerender that container's contents, so the stale height/inline
  // styles leak past and overlap the next section. Drop the Isotope styles
  // and lay out the grid ourselves — with !important so a late Isotope init
  // (e.g., when images finish loading on deployed sites) can't overwrite us.
  applyOnlineGridLayout(grid);
  // Re-assert after `window.load` in case Isotope inits after our render.
  defendAgainstIsotope(grid);

  ensureShimmerStyle();
  renderOnlineShimmer(grid);

  try {
    const data = await ctx
      .dispatch(
        profilesApi.endpoints.searchProfiles.initiate({
          online: true,
          sort: 'most_active',
          limit: ONLINE_MEMBERS_LIMIT,
        }),
      )
      .unwrap();
    renderOnlineMembers(grid, data.items);
    if (filterButtons) renderOnlineFilters(filterButtons, grid, data.items);
    applyOnlineGridLayout(grid);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    renderOnlineError(grid, err?.message ?? 'Could not load online members.');
  }
}

function applyOnlineGridLayout(grid: HTMLElement): void {
  grid.style.setProperty('position', 'static', 'important');
  grid.style.setProperty('height', 'auto', 'important');
  grid.style.setProperty('display', 'grid', 'important');
  grid.style.setProperty(
    'grid-template-columns',
    'repeat(auto-fill, minmax(220px, 1fr))',
    'important',
  );
  grid.style.setProperty('gap', '24px', 'important');
}

function defendAgainstIsotope(grid: HTMLElement): void {
  const reapply = (): void => applyOnlineGridLayout(grid);
  if (document.readyState === 'complete') {
    // window.load already fired — Isotope (if any) has run. Re-assert and
    // also schedule one more on next frame to win against any deferred work.
    reapply();
    requestAnimationFrame(reapply);
    return;
  }
  // window.load hasn't fired yet — Isotope will init then. Reapply right
  // after, plus one frame later to outrun any internal layout passes.
  window.addEventListener(
    'load',
    () => {
      reapply();
      requestAnimationFrame(reapply);
    },
    { once: true },
  );
}

function renderOnlineFilters(
  buttons: HTMLElement,
  grid: HTMLElement,
  items: ProfileWithUserDto[],
): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.profession) continue;
    if (seen.has(item.profession)) continue;
    seen.set(item.profession, formatProfession(item.profession) ?? item.profession);
  }

  const options = [
    { key: ONLINE_FILTER_ALL, label: 'Show all', icon: 'icofont-heart-alt' },
    ...Array.from(seen.entries()).map(([key, label]) => ({
      key,
      label: `New ${pluralizeProfession(label)}`,
      icon: 'icofont-users-alt-3',
    })),
  ];

  buttons.innerHTML = options
    .map(
      (opt, i) => `
        <li class="button ${i === 0 ? 'is-checked ' : ''}filter-btn"
            data-app-online-filter="${escapeHtml(opt.key)}">
          <i class="${opt.icon}"></i> ${escapeHtml(opt.label)}
        </li>
      `,
    )
    .join('');

  buttons.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-app-online-filter]',
      );
      if (!target) return;
      // Block functions.js's jQuery-delegated `.filter-btn` handler from
      // firing stale Isotope filtering against the new card markup.
      event.stopPropagation();
      const key = target.dataset.appOnlineFilter ?? ONLINE_FILTER_ALL;
      buttons
        .querySelectorAll<HTMLElement>('[data-app-online-filter]')
        .forEach((el) => el.classList.toggle('is-checked', el === target));
      grid
        .querySelectorAll<HTMLElement>('[data-app-user-id]')
        .forEach((el) => {
          const show =
            key === ONLINE_FILTER_ALL || el.dataset.appProfession === key;
          el.style.display = show ? '' : 'none';
        });
    },
    true,
  );
}

function pluralizeProfession(label: string): string {
  const m = label.match(/^([^(]+?)(\s*\(.+\))?$/);
  const head = (m?.[1] ?? label).trimEnd();
  const tail = m?.[2] ?? '';
  const plural = /(s|x|z|ch|sh)$/i.test(head)
    ? `${head}es`
    : /[^aeiou]y$/i.test(head)
      ? `${head.slice(0, -1)}ies`
      : `${head}s`;
  return tail ? `${plural}${tail}` : plural;
}

function renderOnlineShimmer(grid: HTMLElement): void {
  const cells = Array.from({ length: ONLINE_MEMBERS_LIMIT })
    .map(
      () => `
        <div class="grid-member">
          <div class="lab-item member-item style-1 style-2">
            <div class="lab-inner">
              <div class="lab-thumb app-shimmer-box"
                style="width:200px;height:200px;margin:0 auto;border-radius:8px;"></div>
              <div class="lab-content">
                <h6><span class="app-shimmer" style="width:70%;"></span></h6>
                <p><span class="app-shimmer" style="width:50%;"></span></p>
              </div>
            </div>
          </div>
        </div>
      `,
    )
    .join('');
  grid.innerHTML = cells;
}

function renderOnlineMembers(
  grid: HTMLElement,
  items: ProfileWithUserDto[],
): void {
  if (items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:32px 0;opacity:0.8;">
        <p>No members are online right now.</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = items.map(onlineCardHtml).join('');
}

function onlineCardHtml(item: ProfileWithUserDto): string {
  const name = escapeHtml(item.displayName || item.username);
  const avatar = item.avatarUrl ? escapeHtml(item.avatarUrl) : FALLBACK_AVATAR;
  // This section is filtered server-side via `?online=true`, so every item
  // here is online by the server's definition. The row-level `isOnline` flag
  // can lag (presence cron flips it on a ~2-min heartbeat threshold), so
  // re-deriving from it here would surface "Offline" on rows we know are
  // online. Just label them all.
  const activeText = 'Active now';
  const href = `/members/${encodeURIComponent(item.userId)}`;
  const professionAttr = item.profession
    ? ` data-app-profession="${escapeHtml(item.profession)}"`
    : '';
  return `
    <div class="grid-member" data-app-user-id="${escapeHtml(item.userId)}"${professionAttr}>
      <div class="lab-item member-item style-1 style-2">
        <a href="${href}" class="lab-inner" style="text-decoration:none;color:inherit;">
          <div class="lab-thumb" style="width:200px;margin:0 auto;">
            <img src="${avatar}" alt="${name}"
              style="width:200px;height:200px;object-fit:cover;display:block;margin:0 auto;">
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

function renderOnlineError(grid: HTMLElement, message: string): void {
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:32px 0;">
      <p style="color:#e84a5f;">${escapeHtml(message)}</p>
    </div>
  `;
}

async function loadNewMembers(ctx: PageContext): Promise<void> {
  const grid = document.querySelector<HTMLElement>(
    'section.member-section .section-wrapper > .row',
  );
  if (!grid) return;

  ensureShimmerStyle();
  renderShimmer(grid);

  try {
    const data = await ctx
      .dispatch(
        profilesApi.endpoints.getNewMembers.initiate({
          limit: NEW_MEMBERS_LIMIT,
        }),
      )
      .unwrap();
    renderNewMembers(grid, data.items);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    renderError(grid, err?.message ?? 'Could not load new members.');
  }
}

function renderShimmer(grid: HTMLElement): void {
  const cells = Array.from({ length: NEW_MEMBERS_LIMIT })
    .map(
      () => `
        <div class="col-xl-2 col-lg-3 col-md-4 col-6">
          <div class="lab-item member-item style-1">
            <div class="lab-inner">
              <div class="lab-thumb app-shimmer-box"
                style="aspect-ratio:1/1;border-radius:8px;"></div>
              <div class="lab-content">
                <h6><span class="app-shimmer" style="width:70%;"></span></h6>
                <p><span class="app-shimmer" style="width:50%;"></span></p>
              </div>
            </div>
          </div>
        </div>
      `,
    )
    .join('');
  grid.innerHTML = cells;
}

function renderNewMembers(
  grid: HTMLElement,
  items: NewMemberItemDto[],
): void {
  if (items.length === 0) {
    grid.innerHTML = `
      <div class="col-12" style="text-align:center;padding:32px 0;opacity:0.8;">
        <p>No new members to show right now.</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = items.map(cardHtml).join('');
}

function cardHtml(item: NewMemberItemDto): string {
  const name = escapeHtml(item.displayName || item.username);
  const avatar = item.avatarUrl ? escapeHtml(item.avatarUrl) : FALLBACK_AVATAR;
  const activeText = escapeHtml(
    item.activeLabel ??
      (item.isOnline ? 'Active now' : formatRelativeActive(item.lastActiveAt)),
  );
  const href = `/members/${encodeURIComponent(item.userId)}`;
  return `
    <div class="col-xl-2 col-lg-3 col-md-4 col-6">
      <div class="lab-item member-item style-1" data-app-user-id="${escapeHtml(item.userId)}">
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

function renderError(grid: HTMLElement, message: string): void {
  grid.innerHTML = `
    <div class="col-12" style="text-align:center;padding:32px 0;">
      <p style="color:#e84a5f;">${escapeHtml(message)}</p>
    </div>
  `;
}

function ensureShimmerStyle(): void {
  if (document.getElementById(SHIMMER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SHIMMER_STYLE_ID;
  style.textContent = `
    .app-shimmer {
      display: inline-block;
      height: 0.85em;
      vertical-align: middle;
      border-radius: 4px;
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0.05) 0%,
        rgba(255, 255, 255, 0.14) 50%,
        rgba(255, 255, 255, 0.05) 100%
      );
      background-size: 200% 100%;
      animation: app-shimmer-slide 1.4s ease-in-out infinite;
    }
    .app-shimmer-box {
      background: linear-gradient(
        90deg,
        #1f1418 0%,
        #2a191e 50%,
        #1f1418 100%
      );
      background-size: 200% 100%;
      animation: app-shimmer-slide 1.4s ease-in-out infinite;
    }
    @keyframes app-shimmer-slide {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
}

registerPage('home', bindHome);
