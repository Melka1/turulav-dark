import { parseApiError } from '@/api/baseQuery';
import { blocksApi } from '@/api/blocksApi';
import { friendsApi } from '@/api/friendsApi';
import { groupsApi } from '@/api/groupsApi';
import { profilesApi } from '@/api/profilesApi';
import { usersApi } from '@/api/usersApi';
import { bindActivityTab } from '@/pages/activity';
import {
  bindOwnAvatarUpload,
  bindOwnCoverUpload,
} from '@/pages/profileAvatar';
import { renderCompletionRing } from '@/pages/profileCompletion';
import { bindProfileMedia } from '@/pages/profileMedia';
import { bindOwnProfileEditors } from '@/pages/profileEdit';
import { registerPage, type PageBinder, type PageContext } from '@/pages';
import { signedOut } from '@/slices/authSlice';
import { showConfirm } from '@/lib/confirmModal';
import { bindJoinGroupWidget } from '@/lib/joinGroupWidget';
import { bindLikeMemberWidget } from '@/lib/likeMemberWidget';
import { bindSidebarMemberFilters } from '@/lib/memberFilter';
import { renderGroupAvatarStack } from '@/lib/groupAvatarStack';
import { formatProfession } from '@/lib/professions';
import { showToast } from '@/lib/toast';
import {
  calculateAge,
  escapeHtml,
  formatAddress,
  formatDate,
  formatHeight,
  formatRelativeActive,
  formatWeight,
  genderLabel,
  genderList,
  joinList,
  notSet,
  titleCase,
} from '@/lib/format';
import type {
  FriendItemDto,
  FriendshipStatus,
  GroupDto,
  ProfileDto,
  PublicProfileDto,
  PublicUserDto,
  UserDto,
} from '@/types/api';

const GROUP_FALLBACK_AVATAR = 'assets/images/group/group-page/01.jpg';
const FRIEND_FALLBACK_AVATAR = 'assets/images/member/01.jpg';

type HeaderView = {
  displayName: string;
  username: string;
  isOnline: boolean;
  lastActiveAt: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
};

const SELF_SENTINEL = 'me';

const bindProfile: PageBinder = async (ctx) => {
  const targetUserId = readTargetUserId();

  void bindSidebarMemberFilters(ctx);
  void bindLikeMemberWidget(ctx);
  void bindJoinGroupWidget(ctx);

  // Mask the template's hardcoded "William Smith / 27-02-1996 / …" values
  // with shimmer placeholders before any fetch, so first-load doesn't briefly
  // flash someone else's data.
  showProfileShimmer();

  if (targetUserId !== null && targetUserId !== SELF_SENTINEL) {
    await renderPublicProfile(ctx, targetUserId);
    return;
  }

  await renderOwnProfile(ctx);
};

const SHIMMER_STYLE_ID = 'app-shimmer-style';

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
    .app-shimmer.block {
      display: block;
      height: 0.9em;
      margin-bottom: 8px;
    }
    .app-shimmer.block:last-child { margin-bottom: 0; }
    @keyframes app-shimmer-slide {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
}

function shimmerSpan(width: string): string {
  return `<span class="app-shimmer" style="width:${width};"></span>`;
}

function showProfileShimmer(): void {
  ensureShimmerStyle();

  const crumb = document.querySelector<HTMLElement>(
    '.page-header-section .breadcrumb li.active',
  );
  if (crumb) crumb.innerHTML = shimmerSpan('140px');

  const header = document.querySelector<HTMLElement>(
    '.member-profile .profile-item:not(.d-none)',
  );
  if (header) {
    const nameNode = header.querySelector<HTMLElement>('.profile-name h4');
    if (nameNode) nameNode.innerHTML = shimmerSpan('200px');
    const activeNode = header.querySelector<HTMLElement>('.profile-name p');
    if (activeNode) activeNode.innerHTML = shimmerSpan('120px');
  }

  const tab = document.querySelector<HTMLElement>('#profile.tab-pane');
  if (!tab) return;

  tab.querySelectorAll<HTMLElement>('.info-card .info-details').forEach(
    (el, idx) => {
      // Vary widths slightly so the placeholder row doesn't read like a table.
      const width = `${90 + ((idx * 37) % 90)}px`;
      el.innerHTML = shimmerSpan(width);
    },
  );

  tab
    .querySelectorAll<HTMLElement>('.info-card .info-card-content > p')
    .forEach((p) => {
      p.innerHTML = `
        <span class="app-shimmer block" style="width:100%;"></span>
        <span class="app-shimmer block" style="width:96%;"></span>
        <span class="app-shimmer block" style="width:88%;"></span>
        <span class="app-shimmer block" style="width:62%;"></span>
      `;
    });
}

function readTargetUserId(): string | null {
  // Pretty form: /members/<uuid> or /members/me (requires a server-side
  // rewrite to profile.html — see serve.json at the repo root for dev).
  // Falls back to profile.html?u=<uuid> on hosts that don't rewrite.
  const pathMatch = window.location.pathname.match(
    /\/members\/([^/?#]+)\/?$/i,
  );
  if (pathMatch) {
    const fromPath = decodeURIComponent(pathMatch[1]!).trim();
    if (fromPath.length > 0) return fromPath;
  }
  const fromQuery = new URLSearchParams(window.location.search).get('u');
  const trimmed = fromQuery?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

async function renderOwnProfile(ctx: PageContext): Promise<void> {
  hideFriendActionForSelf();
  hideBlockUserForSelf();

  try {
    const me = await ctx
      .dispatch(usersApi.endpoints.getMe.initiate())
      .unwrap();
    let currentProfile = me.profile;
    renderHeader(toHeaderView(me, currentProfile));
    renderProfileTab(currentProfile, { hideAddress: false });
    renderCompletionRing(currentProfile.completionScore);
    bindOwnProfileEditors({
      ctx,
      getProfile: () => currentProfile,
      setProfile: (next) => {
        currentProfile = next;
      },
      rerenderReadOnly: () => {
        renderHeader(toHeaderView(me, currentProfile));
        renderProfileTab(currentProfile, { hideAddress: false });
        renderCompletionRing(currentProfile.completionScore);
      },
    });
    const onImageUpdated = (next: typeof currentProfile): void => {
      currentProfile = next;
      renderHeader(toHeaderView(me, currentProfile));
      renderCompletionRing(currentProfile.completionScore);
    };
    bindOwnAvatarUpload({ ctx, onUpdated: onImageUpdated });
    bindOwnCoverUpload({ ctx, onUpdated: onImageUpdated });
    void bindActivityTab(ctx, me.id, me.id);
    void bindProfileMedia(ctx, me.id, me.id);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'INVALID_CREDENTIALS') {
      ctx.dispatch(signedOut());
      window.location.replace('/login.html');
      return;
    }
    console.error('[profile] /users/me failed', err ?? raw);
  }

  void renderGroupsTab(ctx);
  void renderFriendsTab(ctx);
}

async function renderPublicProfile(
  ctx: PageContext,
  userId: string,
): Promise<void> {
  hideOwnerOnlyAffordances();
  hideGroupsTabForOthers();
  hideFriendsTabForOthers();

  try {
    const me = await ctx
      .dispatch(usersApi.endpoints.getMe.initiate())
      .unwrap()
      .catch(() => null);
    if (me && me.id === userId) {
      // Viewing your own profile via someone-else's-shareable URL — bounce to
      // the canonical self-view so edit controls are visible.
      window.location.replace('/members/me');
      return;
    }

    const [user, profile] = await Promise.all([
      ctx.dispatch(usersApi.endpoints.getUserById.initiate(userId)).unwrap(),
      ctx
        .dispatch(profilesApi.endpoints.getProfileById.initiate(userId))
        .unwrap(),
    ]);

    renderHeader(toPublicHeaderView(user, profile));
    renderProfileTab(profile, { hideAddress: true });
    void bindRelationshipActions(ctx, userId);
    void bindActivityTab(ctx, userId, me?.id ?? null);
    void bindProfileMedia(ctx, userId, me?.id ?? null);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'INVALID_CREDENTIALS') {
      ctx.dispatch(signedOut());
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      window.location.replace(`/login.html?next=${next}`);
      return;
    }
    if (err?.code === 'NOT_FOUND') {
      renderProfileMissing();
      return;
    }
    console.error('[profile] public profile fetch failed', err ?? raw);
    renderProfileError(err?.message ?? 'Could not load this profile.');
  }
}

function toHeaderView(
  user: UserDto,
  profile: ProfileDto,
): HeaderView {
  return {
    displayName: profile.displayName || user.username,
    username: user.username,
    isOnline: user.isOnline,
    lastActiveAt: user.lastActiveAt,
    avatarUrl: profile.avatarUrl,
    coverUrl: profile.coverUrl,
  };
}

function toPublicHeaderView(
  user: PublicUserDto,
  profile: PublicProfileDto,
): HeaderView {
  return {
    displayName: profile.displayName || user.username,
    username: user.username,
    isOnline: user.isOnline,
    lastActiveAt: user.lastActiveAt,
    avatarUrl: profile.avatarUrl,
    coverUrl: profile.coverUrl,
  };
}

function renderHeader(view: HeaderView): void {
  const display = view.displayName;

  const crumb = document.querySelector<HTMLElement>(
    '.page-header-section .breadcrumb li.active',
  );
  if (crumb) crumb.textContent = display;
  document.title = `${display} — TuruLav`;

  const root = document.querySelector<HTMLElement>(
    '.member-profile .profile-item:not(.d-none)',
  );
  if (!root) return;

  const nameNode = root.querySelector<HTMLElement>('.profile-name h4');
  if (nameNode) nameNode.textContent = display;

  const activeNode = root.querySelector<HTMLElement>('.profile-name p');
  if (activeNode) {
    activeNode.textContent = view.isOnline
      ? 'Active now'
      : formatRelativeActive(view.lastActiveAt);
  }

  const avatarImg = root.querySelector<HTMLImageElement>('.profile-pic img');
  if (avatarImg && view.avatarUrl) avatarImg.src = view.avatarUrl;

  const coverImg = root.querySelector<HTMLImageElement>('.profile-cover img');
  if (coverImg && view.coverUrl) coverImg.src = view.coverUrl;
}

function hideOwnerOnlyAffordances(): void {
  const header = document.querySelector<HTMLElement>(
    '.member-profile .profile-item:not(.d-none)',
  );
  if (!header) return;
  header
    .querySelectorAll<HTMLElement>('.edit-photo, .profile-pic .custom-upload')
    .forEach((node) => {
      node.style.display = 'none';
    });
}

function hideGroupsTabForOthers(): void {
  // The groups tab on profile.html is wired to /groups/me — it only makes
  // sense on the owner's view. Until a public-groups endpoint exists, hide
  // the tab button + panel when viewing someone else.
  document
    .querySelectorAll<HTMLElement>('#nav-groups-tab, #groups')
    .forEach((node) => {
      node.style.display = 'none';
    });
}

function hideFriendsTabForOthers(): void {
  // No `GET /users/:id/friends` endpoint exists; the Friends tab is wired to
  // `/friends` (the viewer's own list). Hide it on public profile views.
  document
    .querySelectorAll<HTMLElement>('#nav-friends-tab, #friends')
    .forEach((node) => {
      node.style.display = 'none';
    });
}

function hideFriendActionForSelf(): void {
  // The "Add Friends" CTA lives in profile-contact and only makes sense on
  // another user's profile.
  const li = document.querySelector<HTMLElement>(
    '[data-app-target="friend-action-li"]',
  );
  if (li) li.style.display = 'none';
}

function hideBlockUserForSelf(): void {
  const li = document.querySelector<HTMLElement>(
    '[data-app-target="block-user-li"]',
  );
  if (li) li.style.display = 'none';
}

function renderProfileMissing(): void {
  const container = document.querySelector<HTMLElement>(
    '.profile-section .section-wrapper',
  );
  if (!container) return;
  container.innerHTML = `
    <div style="padding:48px;text-align:center;">
      <h3 style="margin-bottom:12px;">Profile not found</h3>
      <p style="opacity:0.85;margin-bottom:24px;">
        This member may have left or set their profile to private.
      </p>
      <a href="/members.html" class="lab-btn">
        <i class="icofont-users-alt-5"></i> Back to members
      </a>
    </div>
  `;
}

function renderProfileError(message: string): void {
  const container = document.querySelector<HTMLElement>(
    '.profile-section .section-wrapper',
  );
  if (!container) return;
  container.innerHTML = `
    <div style="padding:48px;text-align:center;">
      <p style="color:#e84a5f;">${escapeHtml(message)}</p>
    </div>
  `;
}

const BASE_INFO_LABELS_FULL: Record<string, (p: ProfileDto) => string> = {
  Name: (p) => notSet(p.displayName),
  "I'm a": (p) => genderLabel(p.gender),
  'Loking for a': (p) => genderList(p.seeking), // template typo retained
  'Marital Status': (p) => titleCase(p.maritalStatus),
  Profession: (p) => notSet(formatProfession(p.profession)),
  Age: (p) => calculateAge(p.dob),
  'Date of Birth': (p) => formatDate(p.dob),
  Address: (p) => formatAddress([p.address, p.city, p.country]),
};

const BASE_INFO_LABELS_PUBLIC: Record<string, (p: PublicProfileDto) => string> = {
  Name: (p) => notSet(p.displayName),
  "I'm a": (p) => genderLabel(p.gender),
  'Loking for a': (p) => genderList(p.seeking),
  'Marital Status': (p) => titleCase(p.maritalStatus),
  Profession: (p) => notSet(formatProfession(p.profession)),
  Age: (p) => calculateAge(p.dob),
  'Date of Birth': (p) => formatDate(p.dob),
  Address: (p) => formatAddress([p.city, p.country]),
};

const LOOKING_LABELS: Record<string, (p: PublicProfileDto) => string> = {
  "Things I'm looking for": (p) => notSet(p.lookingFor),
  'Whatever I like': (p) => notSet(p.likes),
};

const LIFESTYLE_LABELS: Record<string, (p: PublicProfileDto) => string> = {
  Interest: (p) => joinList(p.interests),
  'Favorite vocations spot': (p) => joinList(p.favoritePlaces),
  'Looking for': (p) => titleCase(p.relationshipType),
  Smoking: (p) => titleCase(p.smoking),
  Language: (p) => joinList(p.languages),
};

const PHYSICAL_LABELS: Record<string, (p: PublicProfileDto) => string> = {
  Height: (p) => formatHeight(p.heightCm),
  Weight: (p) => formatWeight(p.weightKg),
  'Hair Color': (p) => notSet(p.hairColor),
  'Eye Color': (p) => notSet(p.eyeColor),
  'Body Type': (p) => titleCase(p.bodyType),
  Ethnicity: (p) => titleCase(p.ethnicity),
};

function renderProfileTab(
  profile: ProfileDto | PublicProfileDto,
  options: { hideAddress: boolean },
): void {
  const tab = document.querySelector<HTMLElement>('#profile.tab-pane');
  if (!tab) return;

  const baseLabels = options.hideAddress
    ? BASE_INFO_LABELS_PUBLIC
    : (BASE_INFO_LABELS_FULL as Record<
        string,
        (p: ProfileDto | PublicProfileDto) => string
      >);

  applyCard(tab, 'Base Info', baseLabels, profile);
  applyCard(tab, 'Looking For', LOOKING_LABELS, profile);
  applyCard(tab, 'Lifestyle', LIFESTYLE_LABELS, profile);
  applyCard(tab, 'Physical info', PHYSICAL_LABELS, profile);
  applySummary(tab, profile);
}

function applyCard<T extends PublicProfileDto>(
  root: HTMLElement,
  title: string,
  labels: Record<string, (p: T) => string>,
  profile: T,
): void {
  const card = findCardByTitle(root, title);
  if (!card) return;
  const items = card.querySelectorAll<HTMLElement>('.info-list li');
  items.forEach((li) => {
    const nameNode = li.querySelector<HTMLElement>('.info-name');
    const detailsNode = li.querySelector<HTMLElement>('.info-details');
    if (!nameNode || !detailsNode) return;
    const key = (nameNode.textContent ?? '').trim();
    const formatter = labels[key];
    if (formatter) detailsNode.textContent = formatter(profile);
  });
}

function applySummary(
  root: HTMLElement,
  profile: ProfileDto | PublicProfileDto,
): void {
  const card = findCardByTitle(root, 'Myself Summary');
  if (!card) return;
  const p = card.querySelector<HTMLElement>('.info-card-content p');
  if (p) p.textContent = notSet(profile.bio);
}

function findCardByTitle(root: HTMLElement, title: string): HTMLElement | null {
  const cards = root.querySelectorAll<HTMLElement>('.info-card');
  for (const card of cards) {
    const titleNode = card.querySelector<HTMLElement>('.info-card-title h6');
    if (titleNode && (titleNode.textContent ?? '').trim() === title) {
      return card;
    }
  }
  return null;
}

async function renderGroupsTab(ctx: PageContext): Promise<void> {
  const grid = document.querySelector<HTMLElement>(
    '#groups [data-app-target="profile-groups"]',
  );
  if (!grid) return;

  const countBadge = document.querySelector<HTMLElement>(
    '#nav-groups-tab .item-number',
  );

  grid.innerHTML = `
    <div class="col-12" style="text-align:center;padding:24px 0;opacity:0.7;">
      <p>Loading your groups…</p>
    </div>
  `;
  if (countBadge) countBadge.textContent = '—';

  try {
    const groups = await ctx
      .dispatch(groupsApi.endpoints.getMyGroups.initiate())
      .unwrap();
    if (countBadge) countBadge.textContent = groups.length.toString();
    if (groups.length === 0) {
      grid.innerHTML = `
        <div class="col-12" style="padding:32px;border:1px dashed #3a1f24;border-radius:8px;background:#1f1418;text-align:center;">
          <p style="margin:0 0 12px;opacity:0.85;">You haven't joined any groups yet.</p>
          <a href="/active-group.html" class="lab-btn">
            <i class="icofont-users-alt-5"></i> Browse community
          </a>
        </div>
      `;
      return;
    }
    grid.innerHTML = groups.map(groupCardHtml).join('');
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    console.error('[profile] /groups/me failed', err ?? raw);
    const message = err?.message ?? "Couldn't load your groups.";
    grid.innerHTML = `
      <div class="col-12" style="text-align:center;padding:24px 0;">
        <p style="color:#e84a5f;">${escapeHtml(message)}</p>
      </div>
    `;
  }
}

function groupCardHtml(group: GroupDto): string {
  const name = escapeHtml(group.name);
  const description = group.description ? escapeHtml(group.description) : '—';
  const avatar = group.avatarUrl
    ? escapeHtml(group.avatarUrl)
    : GROUP_FALLBACK_AVATAR;
  return `
    <div class="col-12">
      <div class="group-item lab-item style-1" data-app-group-slug="${escapeHtml(group.slug)}">
        <div class="lab-inner d-flex flex-wrap align-items-center p-4">
          <div class="lab-thumb me-md-4 mb-4 mb-md-0">
            <img src="${avatar}" alt="${name}">
          </div>
          <div class="lab-content">
            <h4>${name}</h4>
            <p>${description}</p>
            <ul class="img-stack d-flex">
              ${renderGroupAvatarStack(group)}
            </ul>
            <div class="test">
              <a href="#" class="lab-btn" data-app-group-slug="${escapeHtml(group.slug)}">
                <i class="icofont-users-alt-5"></i> View Group
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

type FriendActionView = {
  label: string;
  enabled: boolean;
  hint?: string;
};

function friendActionView(status: FriendshipStatus): FriendActionView {
  switch (status) {
    case 'accepted':
      return { label: 'Friends ✓', enabled: true, hint: 'Click to unfriend' };
    case 'pending_out':
      return { label: 'Cancel request', enabled: true };
    case 'pending_in':
      return { label: 'Accept request', enabled: true };
    case 'blocked_by_me':
      return { label: 'Blocked', enabled: false };
    case 'blocked_by_them':
      return { label: 'Unavailable', enabled: false };
    case 'none':
    default:
      return { label: 'Add Friend', enabled: true };
  }
}

async function bindRelationshipActions(
  ctx: PageContext,
  targetUserId: string,
): Promise<void> {
  // Friend action button + "Block user" dropdown item both react to the same
  // friendship status, so we wire them through a shared applyStatus().
  const friendLink = document.querySelector<HTMLAnchorElement>(
    '[data-app-action="friend-action"]',
  );
  const friendLabel = document.querySelector<HTMLElement>(
    '[data-app-target="friend-action-label"]',
  );
  const blockLink = document.querySelector<HTMLAnchorElement>(
    '[data-app-target="block-user-li"] a',
  );

  const setFriendBusy = (busy: boolean): void => {
    if (!friendLink) return;
    friendLink.style.pointerEvents = busy ? 'none' : '';
    friendLink.style.opacity = busy ? '0.6' : '';
  };
  const setBlockBusy = (busy: boolean): void => {
    if (!blockLink) return;
    blockLink.style.pointerEvents = busy ? 'none' : '';
    blockLink.style.opacity = busy ? '0.6' : '';
  };

  let current: FriendshipStatus = 'none';
  const applyStatus = (next: FriendshipStatus): void => {
    current = next;
    if (friendLink && friendLabel) {
      const view = friendActionView(next);
      friendLabel.textContent = view.label;
      friendLink.title = view.hint ?? '';
      friendLink.style.pointerEvents = view.enabled ? '' : 'none';
      friendLink.style.opacity = view.enabled ? '' : '0.5';
    }
    if (blockLink) {
      blockLink.textContent =
        next === 'blocked_by_me' ? 'Unblock user' : 'Block user';
    }
  };

  try {
    const initial = await ctx
      .dispatch(friendsApi.endpoints.getFriendshipStatus.initiate(targetUserId))
      .unwrap();
    applyStatus(initial.status);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'INVALID_CREDENTIALS') {
      ctx.dispatch(signedOut());
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      window.location.replace(`/login.html?next=${next}`);
      return;
    }
    console.error('[profile] friendship status failed', err ?? raw);
    return;
  }

  if (friendLink) {
    friendLink.addEventListener('click', (event) => {
      event.preventDefault();
      void handleFriendAction(ctx, targetUserId, current, {
        setBusy: setFriendBusy,
        applyView: applyStatus,
      });
    });
  }

  if (blockLink) {
    blockLink.addEventListener('click', (event) => {
      event.preventDefault();
      void handleBlockAction(ctx, targetUserId, current, {
        setBusy: setBlockBusy,
        applyView: applyStatus,
      });
    });
  }
}

type FriendActionHelpers = {
  setBusy: (busy: boolean) => void;
  applyView: (next: FriendshipStatus) => void;
};

async function handleFriendAction(
  ctx: PageContext,
  targetUserId: string,
  status: FriendshipStatus,
  helpers: FriendActionHelpers,
): Promise<void> {
  helpers.setBusy(true);
  try {
    switch (status) {
      case 'none': {
        await ctx
          .dispatch(
            friendsApi.endpoints.sendFriendRequest.initiate({ targetUserId }),
          )
          .unwrap();
        helpers.applyView('pending_out');
        showToast({ level: 'success', message: 'Friend request sent.' });
        return;
      }
      case 'pending_out': {
        await ctx
          .dispatch(
            friendsApi.endpoints.cancelFriendRequest.initiate(targetUserId),
          )
          .unwrap();
        helpers.applyView('none');
        showToast({ level: 'info', message: 'Request cancelled.' });
        return;
      }
      case 'pending_in': {
        await ctx
          .dispatch(
            friendsApi.endpoints.acceptFriendRequest.initiate(targetUserId),
          )
          .unwrap();
        helpers.applyView('accepted');
        showToast({ level: 'success', message: "You're now friends." });
        return;
      }
      case 'accepted': {
        if (!window.confirm('Remove this person from your friends?')) return;
        await ctx
          .dispatch(friendsApi.endpoints.unfriend.initiate(targetUserId))
          .unwrap();
        helpers.applyView('none');
        showToast({ level: 'info', message: 'Unfriended.' });
        return;
      }
      default:
        return;
    }
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'EMAIL_UNVERIFIED') {
      showToast({
        level: 'warning',
        message: 'Verify your email before sending friend requests.',
      });
      return;
    }
    if (err?.code === 'INVALID_CREDENTIALS') {
      ctx.dispatch(signedOut());
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      window.location.replace(`/login.html?next=${next}`);
      return;
    }
    console.error('[profile] friend action failed', err ?? raw);
    showToast({
      level: 'error',
      message: err?.message ?? 'Something went wrong.',
    });
  } finally {
    helpers.setBusy(false);
  }
}

async function handleBlockAction(
  ctx: PageContext,
  targetUserId: string,
  status: FriendshipStatus,
  helpers: FriendActionHelpers,
): Promise<void> {
  const isBlocked = status === 'blocked_by_me';

  let reason: string | undefined;
  if (isBlocked) {
    const { confirmed } = await showConfirm({
      title: 'Unblock user?',
      message:
        'They will be able to send you friend requests and messages again. The prior friendship will not be restored.',
      confirmLabel: 'Unblock',
    });
    if (!confirmed) return;
  } else {
    const { confirmed, inputValue } = await showConfirm({
      title: 'Block this user?',
      message:
        'Any existing friendship or pending request will be removed. They will no longer be able to interact with you.',
      confirmLabel: 'Block user',
      danger: true,
      input: {
        label: 'Reason',
        placeholder: 'e.g. Repeated unwanted messages',
        optional: true,
        multiline: true,
        maxLength: 500,
      },
    });
    if (!confirmed) return;
    reason = inputValue ? inputValue : undefined;
  }

  helpers.setBusy(true);
  try {
    if (isBlocked) {
      await ctx
        .dispatch(blocksApi.endpoints.unblockUser.initiate(targetUserId))
        .unwrap();
      helpers.applyView('none');
      showToast({ level: 'info', message: 'User unblocked.' });
    } else {
      await ctx
        .dispatch(
          blocksApi.endpoints.blockUser.initiate({ targetUserId, reason }),
        )
        .unwrap();
      helpers.applyView('blocked_by_me');
      showToast({ level: 'success', message: 'User blocked.' });
    }
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'INVALID_CREDENTIALS') {
      ctx.dispatch(signedOut());
      const next = encodeURIComponent(
        window.location.pathname + window.location.search,
      );
      window.location.replace(`/login.html?next=${next}`);
      return;
    }
    console.error('[profile] block action failed', err ?? raw);
    showToast({
      level: 'error',
      message: err?.message ?? 'Something went wrong.',
    });
  } finally {
    helpers.setBusy(false);
  }
}

async function renderFriendsTab(ctx: PageContext): Promise<void> {
  const grid = document.querySelector<HTMLElement>(
    '[data-app-target="profile-friends"]',
  );
  if (!grid) return;

  const countBadge = document.querySelector<HTMLElement>(
    '#nav-friends-tab .item-number',
  );

  grid.innerHTML = `
    <div class="col-12" style="text-align:center;padding:24px 0;opacity:0.7;">
      <p>Loading your friends…</p>
    </div>
  `;
  if (countBadge) countBadge.textContent = '—';

  try {
    const data = await ctx
      .dispatch(friendsApi.endpoints.listFriends.initiate())
      .unwrap();
    if (countBadge) countBadge.textContent = data.total.toString();
    if (data.items.length === 0) {
      grid.innerHTML = `
        <div class="col-12" style="padding:32px;border:1px dashed #3a1f24;border-radius:8px;background:#1f1418;text-align:center;">
          <p style="margin:0 0 12px;opacity:0.85;">You haven't added any friends yet.</p>
          <a href="/members.html" class="lab-btn">
            <i class="icofont-users-alt-5"></i> Find members
          </a>
        </div>
      `;
      return;
    }
    grid.innerHTML = data.items.map(friendCardHtml).join('');
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    console.error('[profile] /friends failed', err ?? raw);
    const message = err?.message ?? "Couldn't load your friends.";
    grid.innerHTML = `
      <div class="col-12" style="text-align:center;padding:24px 0;">
        <p style="color:#e84a5f;">${escapeHtml(message)}</p>
      </div>
    `;
  }
}

function friendCardHtml(item: FriendItemDto): string {
  const name = escapeHtml(item.displayName || item.username);
  const avatar = item.avatarUrl
    ? escapeHtml(item.avatarUrl)
    : FRIEND_FALLBACK_AVATAR;
  const activeText = item.isOnline
    ? 'Active now'
    : escapeHtml(formatRelativeActive(item.lastActiveAt));
  const href = `/members/${encodeURIComponent(item.id)}`;
  return `
    <div class="col-lg-3 col-md-4 col-6">
      <div class="lab-item member-item style-1" data-app-user-id="${escapeHtml(item.id)}">
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

registerPage('profile', bindProfile);
