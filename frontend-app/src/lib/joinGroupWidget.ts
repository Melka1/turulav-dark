/**
 * Wires up the static "join the group" sidebar widget (`.widget.active-group`)
 * to `GET /groups/suggestions`. Guest viewers don't see it at all — the whole
 * widget element is removed so neighbouring widgets collapse cleanly into the
 * freed space. Used on the blog list, blog detail, and profile pages, which
 * all carry the same markup block.
 */

import { parseApiError } from '@/api/baseQuery';
import { groupsApi } from '@/api/groupsApi';
import { escapeHtml } from '@/lib/format';
import { renderGroupAvatarStack } from '@/lib/groupAvatarStack';
import type { PageContext } from '@/pages';
import type { GroupSuggestionItemDto } from '@/types/api';

const SUGGEST_LIMIT = 20;

export async function bindJoinGroupWidget(ctx: PageContext): Promise<void> {
  const widgets = Array.from(
    document.querySelectorAll<HTMLElement>('.widget.active-group'),
  );
  if (widgets.length === 0) return;

  if (ctx.getState().auth.status !== 'authenticated') {
    widgets.forEach((w) => w.remove());
    return;
  }

  const run = async (): Promise<void> => {
    widgets.forEach((widget) => {
      const content = widget.querySelector<HTMLElement>('.widget-content');
      if (content) renderLoading(content);
    });

    try {
      const data = await ctx
        .dispatch(
          groupsApi.endpoints.getGroupSuggestions.initiate({
            limit: SUGGEST_LIMIT,
          }),
        )
        .unwrap();
      if (data.items.length === 0) {
        widgets.forEach((w) => w.remove());
        return;
      }
      const markup = renderList(data.items);
      widgets.forEach((widget) => {
        const content = widget.querySelector<HTMLElement>('.widget-content');
        if (content) content.innerHTML = markup;
      });
    } catch (raw) {
      const status = (raw as { status?: unknown }).status;
      if (status === 401) {
        widgets.forEach((w) => w.remove());
        return;
      }
      const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
      const message = err?.message ?? 'Could not load group suggestions.';
      widgets.forEach((widget) => {
        const content = widget.querySelector<HTMLElement>('.widget-content');
        if (content) renderError(content, message, () => void run());
      });
    }
  };

  await run();
}

function renderLoading(content: HTMLElement): void {
  content.innerHTML = `
    <div class="group-item lab-item" style="opacity:0.7;">
      <div class="lab-inner d-flex flex-wrap align-items-center">
        <div class="lab-content w-100">
          <p style="margin:0;">Loading suggestions…</p>
        </div>
      </div>
    </div>
  `;
}

function renderError(
  content: HTMLElement,
  message: string,
  onRetry: () => void,
): void {
  content.innerHTML = `
    <p style="opacity:0.75;font-size:0.9em;margin-bottom:8px;">${escapeHtml(message)}</p>
    <button type="button" data-app-retry
      style="background:none;border:0;padding:0;cursor:pointer;color:inherit;
             font-size:0.9em;display:inline-flex;align-items:center;gap:6px;
             text-decoration:underline;">
      <i class="icofont-refresh"></i> Try again
    </button>
  `;
  const btn = content.querySelector<HTMLButtonElement>('button[data-app-retry]');
  btn?.addEventListener('click', onRetry, { once: true });
}

function renderList(items: GroupSuggestionItemDto[]): string {
  return items.map(cardHtml).join('');
}

function cardHtml(group: GroupSuggestionItemDto): string {
  const name = escapeHtml(group.name);
  const description = group.description
    ? escapeHtml(group.description)
    : 'A community to explore.';
  const slug = escapeHtml(group.slug);
  return `
    <div class="group-item lab-item" data-app-group-slug="${slug}">
      <div class="lab-inner d-flex flex-wrap align-items-center">
        <div class="lab-content w-100">
          <h6>${name}</h6>
          <p>${description}</p>
          <ul class="img-stack d-flex">
            ${renderGroupAvatarStack(group)}
          </ul>
          <div class="test">
            <a href="#" class="lab-btn" data-app-group-slug="${slug}">
              <i class="icofont-users-alt-5"></i> View Group
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}
