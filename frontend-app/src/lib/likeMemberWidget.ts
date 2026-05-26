/**
 * Wires up the static "you may like" sidebar widget (`.widget.like-member`)
 * to `GET /friends/suggestions`. Guest viewers don't see it at all — the
 * whole widget element is removed from the DOM so neighbouring widgets
 * collapse cleanly into the freed space.
 */

import { parseApiError } from '@/api/baseQuery';
import { friendsApi } from '@/api/friendsApi';
import { escapeHtml } from '@/lib/format';
import type { PageContext } from '@/pages';
import type { FriendSuggestionItemDto } from '@/types/api';

const SUGGEST_LIMIT = 9;
const FALLBACK_AVATAR = 'assets/images/widget/01.jpg';

export async function bindLikeMemberWidget(ctx: PageContext): Promise<void> {
  const widget = document.querySelector<HTMLElement>('.widget.like-member');
  if (!widget) return;

  if (ctx.getState().auth.status !== 'authenticated') {
    widget.remove();
    return;
  }

  const content = widget.querySelector<HTMLElement>('.widget-content');
  if (!content) return;

  renderLoading(content);

  try {
    const data = await ctx
      .dispatch(
        friendsApi.endpoints.getFriendSuggestions.initiate({
          limit: SUGGEST_LIMIT,
        }),
      )
      .unwrap();
    if (data.items.length === 0) {
      widget.remove();
      return;
    }
    content.innerHTML = renderGrid(data.items);
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    // 401 generally means the session expired between page load and fetch —
    // the auth guard will resolve it; here just hide the widget quietly.
    const status = (raw as { status?: unknown }).status;
    if (status === 401) {
      widget.remove();
      return;
    }
    renderError(content, err?.message ?? 'Could not load suggestions.');
  }
}

// Drop the template's `row-cols-sm-auto` modifier: that sizes each cell to the
// natural image width, which works for the static ~80px decorative thumbs but
// blows the grid apart once we render full-resolution avatar URLs. Locking to
// `row-cols-3` keeps a tidy 3×3 regardless of avatar dimensions.
const ROW_CLASS = 'row row-cols-3 g-3';
const THUMB_BOX_STYLE =
  'display:block;width:100%;aspect-ratio:1/1;overflow:hidden;';
const THUMB_LINK_STYLE = 'display:block;width:100%;height:100%;';
const THUMB_IMG_STYLE =
  'display:block;width:100%;height:100%;object-fit:cover;';

function renderLoading(content: HTMLElement): void {
  const cells = Array.from({ length: SUGGEST_LIMIT })
    .map(
      () => `
        <div class="col">
          <div class="image-thumb" style="${THUMB_BOX_STYLE}background:rgba(255,255,255,0.06);"></div>
        </div>
      `,
    )
    .join('');
  content.innerHTML = `<div class="${ROW_CLASS}">${cells}</div>`;
}

function renderGrid(items: FriendSuggestionItemDto[]): string {
  const cells = items.map(cellHtml).join('');
  return `<div class="${ROW_CLASS}">${cells}</div>`;
}

function cellHtml(item: FriendSuggestionItemDto): string {
  const name = escapeHtml(item.displayName || item.username);
  const avatar = item.avatarUrl ? escapeHtml(item.avatarUrl) : FALLBACK_AVATAR;
  const href = `/members/${encodeURIComponent(item.id)}`;
  return `
    <div class="col">
      <div class="image-thumb" style="${THUMB_BOX_STYLE}">
        <a href="${href}" title="${name}" style="${THUMB_LINK_STYLE}">
          <img src="${avatar}" alt="${name}" style="${THUMB_IMG_STYLE}">
        </a>
      </div>
    </div>
  `;
}

function renderError(content: HTMLElement, message: string): void {
  content.innerHTML = `
    <p style="opacity:0.7;font-size:0.9em;">${escapeHtml(message)}</p>
  `;
}
