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
import type { NewMemberItemDto } from '@/types/api';

const NEW_MEMBERS_LIMIT = 10;
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
    await prefillHomeProfession(ctx, form);
    // The "I am a" select represents the viewer's own profession. For
    // signed-in viewers the backend already has this from the session
    // profile, so we drop it from the wire to avoid double-specifying.
    // Guests must send it — the backend has no other source.
    bindRedirectFilter(form, (f) => {
      const state = readHomeBannerForm(f);
      if (ctx.getState().auth.status === 'authenticated') {
        delete state.viewerProfession;
      }
      return state;
    });
  }

  void loadNewMembers(ctx);
};

async function prefillHomeProfession(
  ctx: PageContext,
  form: HTMLFormElement,
): Promise<void> {
  if (ctx.getState().auth.status !== 'authenticated') return;
  try {
    const me = await ctx
      .dispatch(usersApi.endpoints.getMe.initiate())
      .unwrap();
    const label = formatProfession(me.profile.profession);
    if (!label) return;
    const select = form.querySelector<HTMLSelectElement>('select#gender');
    if (!select) return;
    const target = label.trim().toLowerCase();
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i]!.text.trim().toLowerCase() === target) {
        select.selectedIndex = i;
        return;
      }
    }
  } catch {
    // Best-effort; leave the form untouched on failure.
  }
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
