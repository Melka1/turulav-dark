import { activityApi } from '@/api/activityApi';
import { usersApi } from '@/api/usersApi';
import { parseApiError } from '@/api/baseQuery';
import type { PageContext } from '@/pages';
import { signedOut } from '@/slices/authSlice';
import { escapeHtml } from '@/lib/format';
import type {
  ActivityLens,
  ActivitySort,
  PostAttachmentDto,
  PostAudience,
  PostDto,
  ReactionSummaryDto,
} from '@/types/api';

type ActivityContext = {
  ctx: PageContext;
  targetUserId: string;
  viewerUserId: string | null;
  isOwner: boolean;
};

const LENS_PANEL_IDS: Record<ActivityLens, string> = {
  personal: 'pills-personal',
  mentions: 'pills-mentions',
  favorites: 'pills-favorites',
  friends: 'pills-friends',
  groups: 'pills-groups',
};

const LENS_TAB_IDS: Record<ActivityLens, string> = {
  personal: 'pills-personal-tab',
  mentions: 'pills-mentions-tab',
  favorites: 'pills-favorites-tab',
  friends: 'pills-friends-tab',
  groups: 'pills-groups-tab',
};

const SORT_LABEL_TO_VALUE: Record<string, ActivitySort> = {
  Recent: 'recent',
  Relevant: 'relevant',
  Popular: 'popular',
  Everything: 'recent',
};

const AUDIENCE_LABEL: Record<PostAudience, { icon: string; label: string }> = {
  public: { icon: 'icofont-world', label: 'Public' },
  friends: { icon: 'icofont-users', label: 'Friends' },
  private: { icon: 'icofont-lock', label: 'Private' },
  group: { icon: 'icofont-users-alt-5', label: 'Group' },
};

type State = {
  lens: ActivityLens;
  sort: ActivitySort;
};

const state: State = {
  lens: 'personal',
  sort: 'recent',
};

export async function bindActivityTab(
  ctx: PageContext,
  targetUserId: string,
  viewerUserId: string | null,
): Promise<void> {
  const activityPane = document.querySelector<HTMLElement>('#activity');
  if (!activityPane) return;

  const actx: ActivityContext = {
    ctx,
    targetUserId,
    viewerUserId,
    isOwner: viewerUserId !== null && viewerUserId === targetUserId,
  };

  // Pills mark `pills-mentions` as `show active` by default in the template.
  // Per the spec, the composer belongs in Personal — flip the defaults.
  resetTabActiveState(activityPane);
  hideLensesForNonOwner(activityPane, actx.isOwner);
  prepareComposer(activityPane, actx);
  wirePillSwitches(activityPane, actx);
  wireSortSelect(activityPane, actx);
  clearStaticPostMarkup(activityPane);

  // Initial load.
  await refreshFeed(activityPane, actx);
}

function resetTabActiveState(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>('#pills-tab .nav-link')
    .forEach((btn) => btn.classList.remove('active'));
  root
    .querySelectorAll<HTMLElement>('.activity-content > .tab-pane')
    .forEach((pane) => pane.classList.remove('show', 'active'));

  const defaultTab = root.querySelector<HTMLElement>(
    `#${LENS_TAB_IDS[state.lens]}`,
  );
  const defaultPane = root.querySelector<HTMLElement>(
    `#${LENS_PANEL_IDS[state.lens]}`,
  );
  defaultTab?.classList.add('active');
  defaultTab?.setAttribute('aria-selected', 'true');
  defaultPane?.classList.add('show', 'active');
}

function hideLensesForNonOwner(root: HTMLElement, isOwner: boolean): void {
  if (isOwner) return;
  // Favorites / Friends / Groups are viewer-private (per the spec).
  (['favorites', 'friends', 'groups'] as ActivityLens[]).forEach((lens) => {
    const btnLi = root
      .querySelector<HTMLElement>(`#${LENS_TAB_IDS[lens]}`)
      ?.closest('li.nav-item');
    if (btnLi) (btnLi as HTMLElement).style.display = 'none';
  });
}

function prepareComposer(root: HTMLElement, actx: ActivityContext): void {
  const mentionsPane = root.querySelector<HTMLElement>('#pills-mentions');
  const composer = mentionsPane?.querySelector<HTMLElement>('.create-post');
  if (!composer) return;

  if (!actx.isOwner) {
    composer.style.display = 'none';
    return;
  }

  // Move the composer to the top of the Personal pane (spec: composer lives
  // in Personal, the template artifact placed it in Mentions).
  const personalPane = root.querySelector<HTMLElement>('#pills-personal');
  if (personalPane && composer.parentElement !== personalPane) {
    personalPane.insertBefore(composer, personalPane.firstChild);
  }

  const form = composer.querySelector<HTMLFormElement>('form.post-form');
  const input = form?.querySelector<HTMLInputElement>('input[type="text"]');
  const audienceSelect = composer.querySelector<HTMLSelectElement>(
    '.custom-select select',
  );
  const submitButton = composer.querySelector<HTMLInputElement>(
    'input[type="submit"]',
  );
  if (!form || !input || !audienceSelect || !submitButton) return;

  // Re-label audience options to plain audience values.
  audienceSelect.innerHTML = `
    <option value="public">Public</option>
    <option value="friends">Friends</option>
    <option value="private">Private</option>
  `;

  void populateComposerIdentity(composer, actx);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (body.length === 0) return;
    const audience = audienceSelect.value as PostAudience;
    submitButton.disabled = true;
    void actx.ctx
      .dispatch(
        activityApi.endpoints.createPost.initiate({ body, audience }),
      )
      .unwrap()
      .then(() => {
        input.value = '';
      })
      .catch((raw) => {
        const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
        if (err?.code === 'INVALID_CREDENTIALS') {
          actx.ctx.dispatch(signedOut());
          window.location.replace('login.html');
          return;
        }
        window.alert(err?.message ?? 'Could not create post.');
      })
      .finally(() => {
        submitButton.disabled = false;
        void refreshFeed(root, actx);
      });
  });
}

async function populateComposerIdentity(
  composer: HTMLElement,
  actx: ActivityContext,
): Promise<void> {
  try {
    const me = await actx.ctx
      .dispatch(usersApi.endpoints.getMe.initiate())
      .unwrap();
    const displayName = me.profile.displayName || me.username;
    const firstName = displayName.split(/\s+/)[0] ?? displayName;
    const avatar = me.profile.avatarUrl ?? '/assets/images/profile/dp.png';

    const avatarImg = composer.querySelector<HTMLImageElement>(
      '.lab-thumb .thumb-inner .thumb-img img',
    );
    if (avatarImg) {
      avatarImg.src = avatar;
      avatarImg.alt = displayName;
    }

    const nameLink = composer.querySelector<HTMLAnchorElement>(
      '.lab-thumb .thumb-inner .thumb-content h6 a',
    );
    if (nameLink) {
      nameLink.textContent = displayName;
      nameLink.href = `/members/${me.id}`;
    }

    const input = composer.querySelector<HTMLInputElement>(
      'form.post-form input[type="text"]',
    );
    if (input) {
      input.placeholder = `What's on your mind, ${firstName}?`;
    }
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'INVALID_CREDENTIALS') {
      actx.ctx.dispatch(signedOut());
      window.location.replace('login.html');
    }
  }
}

function wirePillSwitches(root: HTMLElement, actx: ActivityContext): void {
  const pills = root.querySelectorAll<HTMLElement>('#pills-tab .nav-link');
  pills.forEach((btn) => {
    btn.addEventListener('shown.bs.tab', () => {
      const lens = lensFromTabId(btn.id);
      if (!lens) return;
      state.lens = lens;
      void refreshFeed(root, actx);
    });
    // Fallback for environments where Bootstrap's JS isn't running: trigger
    // on click as well.
    btn.addEventListener('click', () => {
      const lens = lensFromTabId(btn.id);
      if (!lens || lens === state.lens) return;
      state.lens = lens;
      void refreshFeed(root, actx);
    });
  });
}

function wireSortSelect(root: HTMLElement, actx: ActivityContext): void {
  const select = root.querySelector<HTMLSelectElement>(
    '.activity-tab .custom-select select',
  );
  if (!select) return;
  select.innerHTML = `
    <option value="recent">Recent</option>
    <option value="popular">Popular</option>
    <option value="relevant">Relevant</option>
  `;
  select.addEventListener('change', () => {
    const value = select.value;
    const sort: ActivitySort =
      value === 'popular' || value === 'relevant' ? value : 'recent';
    state.sort = sort;
    void refreshActiveFeed(actx);
  });
  void SORT_LABEL_TO_VALUE;
}

function clearStaticPostMarkup(root: HTMLElement): void {
  // Strip the template's hard-coded sample posts and "Load More" footers.
  (Object.values(LENS_PANEL_IDS) as string[]).forEach((id) => {
    const pane = root.querySelector<HTMLElement>(`#${id}`);
    if (!pane) return;
    pane.querySelectorAll('.post-item, .load-btn').forEach((node) => {
      node.remove();
    });
    if (!pane.querySelector('[data-app-target="activity-feed"]')) {
      const feed = document.createElement('div');
      feed.dataset.appTarget = 'activity-feed';
      pane.appendChild(feed);
    }
  });
}

function lensFromTabId(id: string): ActivityLens | null {
  const match = (Object.entries(LENS_TAB_IDS) as Array<[ActivityLens, string]>)
    .find(([, value]) => value === id);
  return match ? match[0] : null;
}

async function refreshFeed(
  root: HTMLElement,
  actx: ActivityContext,
): Promise<void> {
  const pane = document.querySelector<HTMLElement>(
    `#${LENS_PANEL_IDS[state.lens]}`,
  );
  const feed = pane?.querySelector<HTMLElement>(
    '[data-app-target="activity-feed"]',
  );
  if (!feed) return;
  feed.innerHTML = `
    <div style="padding:24px 0;text-align:center;opacity:0.7;">
      <p>Loading…</p>
    </div>
  `;

  try {
    const data = await actx.ctx
      .dispatch(
        activityApi.endpoints.getActivityFeed.initiate({
          userId: actx.targetUserId,
          lens: state.lens,
          sort: state.sort,
          limit: 20,
        }),
      )
      .unwrap();
    if (data.items.length === 0) {
      feed.innerHTML = `
        <div style="padding:32px;border:1px dashed #3a1f24;border-radius:8px;background:#1f1418;text-align:center;">
          <p style="margin:0;opacity:0.85;">Nothing to show here yet.</p>
        </div>
      `;
      return;
    }
    feed.innerHTML = data.items.map(postCardHtml).join('');
    wirePostActions(feed, actx);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'INVALID_CREDENTIALS') {
      actx.ctx.dispatch(signedOut());
      window.location.replace('login.html');
      return;
    }
    console.error('[activity] feed load failed', err ?? raw);
    feed.innerHTML = `
      <div style="padding:24px 0;text-align:center;">
        <p style="color:#e84a5f;">${escapeHtml(
          err?.message ?? 'Could not load the feed.',
        )}</p>
      </div>
    `;
  }

  // Keep root referenced for parity with the helpers that walk the DOM up.
  void root;
}

function postCardHtml(post: PostDto): string {
  const authorName = escapeHtml(post.author.displayName || post.author.username);
  const audienceMeta = AUDIENCE_LABEL[post.audience];
  const audienceLabel = post.group
    ? `${escapeHtml(post.group.name)} (group)`
    : audienceMeta.label;
  const audienceIcon = audienceMeta.icon;
  const time = formatPostTime(post.createdAt, post.editedAt);
  const avatar = escapeHtml(post.author.avatarUrl ?? '/assets/images/profile/dp.png');
  const body = post.isDeleted
    ? '<em>[deleted]</em>'
    : escapeHtml(post.body ?? '');
  const attachments = post.isDeleted
    ? ''
    : attachmentsHtml(post.attachments);
  const reactionLine = reactionSummaryHtml(post.reactionSummary);
  const favoriteLabel = post.viewerFavorited ? 'Saved' : 'Save';
  const favoriteIcon = post.viewerFavorited
    ? 'icofont-heart'
    : 'icofont-heart-alt';
  const viewerReaction = post.reactionSummary.viewerReaction;
  const likeLabel = viewerReaction ? capitalize(viewerReaction) : 'Like';

  return `
    <div class="post-item mb-20" data-app-post-id="${escapeHtml(post.id)}">
      <div class="post-content">
        <div class="post-author">
          <div class="post-author-inner">
            <div class="author-thumb">
              <img src="${avatar}" alt="${authorName}">
            </div>
            <div class="author-details">
              <h6><a href="members/${escapeHtml(post.author.userId)}">${authorName}</a></h6>
              <ul class="post-status">
                <li class="post-privacy"><i class="${audienceIcon}"></i> ${escapeHtml(audienceLabel)}</li>
                <li class="post-time">${escapeHtml(time)}</li>
              </ul>
            </div>
          </div>
        </div>
        <div class="post-description">
          <p>${body}</p>
          ${attachments}
        </div>
      </div>
      <div class="post-meta">
        <div class="post-meta-top">
          <p><a href="#" data-app-action="post-react-summary">${reactionLine}</a></p>
          <p><a href="#" data-app-action="post-toggle-comments">${post.commentCount} Comment${post.commentCount === 1 ? '' : 's'}</a></p>
        </div>
        <div class="post-meta-bottom">
          <ul class="react-list">
            <li class="react">
              <a href="#" data-app-action="post-like">
                <i class="icofont-like"></i> ${escapeHtml(likeLabel)}
              </a>
            </li>
            <li class="react">
              <a href="#" data-app-action="post-toggle-comments">
                <i class="icofont-speech-comments"></i> Comment
              </a>
            </li>
            <li class="react">
              <a href="#" data-app-action="post-favorite">
                <i class="${favoriteIcon}"></i> ${escapeHtml(favoriteLabel)}
              </a>
            </li>
          </ul>
        </div>
        <div class="post-comments" data-app-target="post-comments" hidden></div>
      </div>
    </div>
  `;
}

function attachmentsHtml(attachments: PostAttachmentDto[]): string {
  if (attachments.length === 0) return '';
  if (attachments.length === 1) {
    const a = attachments[0]!;
    return `
      <div class="post-desc-img">
        <img src="${escapeHtml(a.thumbnailUrl ?? a.url)}" alt="post image">
      </div>
    `;
  }
  const cols = attachments
    .map(
      (a) => `
        <div class="col-md-6">
          <img src="${escapeHtml(a.thumbnailUrl ?? a.url)}" alt="post image">
        </div>
      `,
    )
    .join('');
  return `
    <div class="post-desc-img">
      <div class="row g-3">${cols}</div>
    </div>
  `;
}

function reactionSummaryHtml(summary: ReactionSummaryDto): string {
  if (summary.total === 0) return '<span>Be the first to react</span>';
  const icons = Object.keys(summary.byType)
    .map((type) => `<i class="${reactionIconClass(type)}"></i>`)
    .join(' ');
  const actorNames = summary.topActors
    .map((a) => escapeHtml(a.displayName || a.username))
    .join(', ');
  const remainder = Math.max(0, summary.total - summary.topActors.length);
  const tail =
    summary.topActors.length === 0
      ? `${summary.total} reaction${summary.total === 1 ? '' : 's'}`
      : remainder > 0
        ? `${actorNames} and ${remainder} other${remainder === 1 ? '' : 's'}`
        : actorNames;
  return `${icons} <span>${tail}</span>`;
}

function reactionIconClass(type: string): string {
  switch (type) {
    case 'heart':
      return 'icofont-heart';
    case 'laugh':
      return 'icofont-laughing';
    case 'wow':
      return 'icofont-surprise';
    case 'sad':
      return 'icofont-sad';
    case 'angry':
      return 'icofont-angry';
    case 'like':
    default:
      return 'icofont-like';
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function formatPostTime(createdAt: string, editedAt: string | null): string {
  const target = editedAt ?? createdAt;
  const ts = Date.parse(target);
  if (Number.isNaN(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  let label: string;
  if (minutes < 1) label = 'Just now';
  else if (minutes < 60)
    label = `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  else if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    label = `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else {
    const days = Math.floor(minutes / (60 * 24));
    label = `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return editedAt ? `${label} (edited)` : label;
}

function wirePostActions(feed: HTMLElement, actx: ActivityContext): void {
  feed.querySelectorAll<HTMLElement>('.post-item').forEach((card) => {
    const postId = card.dataset.appPostId;
    if (!postId) return;
    card
      .querySelector<HTMLElement>('[data-app-action="post-like"]')
      ?.addEventListener('click', (event) => {
        event.preventDefault();
        void toggleLike(actx, postId);
      });
    card
      .querySelector<HTMLElement>('[data-app-action="post-favorite"]')
      ?.addEventListener('click', (event) => {
        event.preventDefault();
        void toggleFavorite(actx, postId);
      });
    card
      .querySelectorAll<HTMLElement>('[data-app-action="post-toggle-comments"]')
      .forEach((node) => {
        node.addEventListener('click', (event) => {
          event.preventDefault();
          void toggleComments(card, actx, postId);
        });
      });
  });
}

async function toggleLike(
  actx: ActivityContext,
  postId: string,
): Promise<void> {
  const cached = activityApi.endpoints.getPost.select(postId)(
    actx.ctx.getState(),
  );
  const viewerReaction = cached.data?.reactionSummary.viewerReaction ?? null;
  try {
    if (viewerReaction) {
      await actx.ctx
        .dispatch(activityApi.endpoints.removeReaction.initiate(postId))
        .unwrap();
    } else {
      await actx.ctx
        .dispatch(
          activityApi.endpoints.setReaction.initiate({
            postId,
            body: { type: 'like' },
          }),
        )
        .unwrap();
    }
    await refreshActiveFeed(actx);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    window.alert(err?.message ?? 'Could not update reaction.');
  }
}

async function toggleFavorite(
  actx: ActivityContext,
  postId: string,
): Promise<void> {
  const card = document.querySelector<HTMLElement>(
    `[data-app-post-id="${cssEscape(postId)}"]`,
  );
  const button = card?.querySelector<HTMLElement>(
    '[data-app-action="post-favorite"]',
  );
  const currentlySaved =
    button?.querySelector('i.icofont-heart') !== null &&
    !button?.querySelector('i.icofont-heart-alt');
  try {
    if (currentlySaved) {
      await actx.ctx
        .dispatch(activityApi.endpoints.removeFavorite.initiate(postId))
        .unwrap();
    } else {
      await actx.ctx
        .dispatch(activityApi.endpoints.addFavorite.initiate(postId))
        .unwrap();
    }
    await refreshActiveFeed(actx);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    window.alert(err?.message ?? 'Could not update favorites.');
  }
}

async function toggleComments(
  card: HTMLElement,
  actx: ActivityContext,
  postId: string,
): Promise<void> {
  const region = card.querySelector<HTMLElement>(
    '[data-app-target="post-comments"]',
  );
  if (!region) return;
  if (!region.hasAttribute('hidden')) {
    region.setAttribute('hidden', '');
    return;
  }
  region.removeAttribute('hidden');
  region.innerHTML = `
    <div style="padding:12px 0;opacity:0.7;">Loading comments…</div>
  `;
  try {
    const data = await actx.ctx
      .dispatch(
        activityApi.endpoints.listComments.initiate({ postId, limit: 20 }),
      )
      .unwrap();
    region.innerHTML = `
      <div class="post-comments-list" style="display:flex;flex-direction:column;gap:8px;padding:12px 0;">
        ${data.items.map(commentRowHtml).join('')}
      </div>
      <form data-app-action="add-comment" style="display:flex;gap:8px;margin-top:8px;">
        <input type="text" placeholder="Write a comment…"
          style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid #3a1f24;background:#1f1418;color:inherit;">
        <button type="submit" class="lab-btn">Reply</button>
      </form>
    `;
    region
      .querySelector<HTMLFormElement>('[data-app-action="add-comment"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const input = form.querySelector<HTMLInputElement>('input');
        if (!input) return;
        const text = input.value.trim();
        if (text.length === 0) return;
        input.value = '';
        void postComment(actx, postId, text, card);
      });
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    region.innerHTML = `<p style="color:#e84a5f;">${escapeHtml(
      err?.message ?? 'Could not load comments.',
    )}</p>`;
  }
}

function commentRowHtml(comment: {
  author: { displayName: string; username: string };
  body: string | null;
  isDeleted: boolean;
  createdAt: string;
}): string {
  const name = escapeHtml(comment.author.displayName || comment.author.username);
  const body = comment.isDeleted
    ? '<em>[deleted]</em>'
    : escapeHtml(comment.body ?? '');
  return `
    <div style="padding:8px 12px;border-radius:6px;background:#1f1418;">
      <strong>${name}</strong>
      <div>${body}</div>
    </div>
  `;
}

async function postComment(
  actx: ActivityContext,
  postId: string,
  body: string,
  card: HTMLElement,
): Promise<void> {
  try {
    await actx.ctx
      .dispatch(
        activityApi.endpoints.createComment.initiate({
          postId,
          body: { body },
        }),
      )
      .unwrap();
    // Re-open comments to refresh the list + counter.
    const region = card.querySelector<HTMLElement>(
      '[data-app-target="post-comments"]',
    );
    if (region) region.setAttribute('hidden', '');
    await refreshActiveFeed(actx);
    const refreshed = document.querySelector<HTMLElement>(
      `[data-app-post-id="${cssEscape(postId)}"]`,
    );
    if (refreshed) await toggleComments(refreshed, actx, postId);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    window.alert(err?.message ?? 'Could not post the comment.');
  }
}

async function refreshActiveFeed(actx: ActivityContext): Promise<void> {
  const pane = document.querySelector<HTMLElement>(
    `#${LENS_PANEL_IDS[state.lens]}`,
  );
  if (!pane) return;
  await refreshFeed(pane, actx);
}

function cssEscape(value: string): string {
  const css = (window as unknown as { CSS?: { escape?: (s: string) => string } })
    .CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/(["\\])/g, '\\$1');
}
