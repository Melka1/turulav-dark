import { mediaApi } from '@/api/mediaApi';
import { parseApiError } from '@/api/baseQuery';
import { escapeHtml } from '@/lib/format';
import type { PageContext } from '@/pages';
import { signedOut } from '@/slices/authSlice';
import type {
  MediaKind,
  UserMediaItemDto,
  UserMediaListResponseData,
} from '@/types/api';

type MediaContext = {
  ctx: PageContext;
  targetUserId: string;
  isOwner: boolean;
};

type GridConfig = {
  /** Container that wraps the static template grid (rows of `.col`). */
  gridSelector: string;
  /** Optional "Load More" button wrapper to wire / hide. */
  loadMoreSelector: string;
  /** Optional upload affordance wrapper to hide for non-owners. */
  uploadSelector?: string;
  /** Either 'photo', 'video', or undefined for "all". */
  kind?: MediaKind;
  /** How each item renders ('gallery' vs. 'media-thumb'). */
  variant: 'gallery' | 'media-thumb';
  /** Empty-state copy. */
  emptyText: string;
};

const PAGE_SIZE = 24;

const GRIDS: GridConfig[] = [
  {
    // Top-level "Photos" tab — single grid of photos.
    gridSelector: '#photos > .row',
    loadMoreSelector: '#photos > .load-btn',
    variant: 'gallery',
    kind: 'photo',
    emptyText: 'No photos uploaded yet.',
  },
  {
    // Media tab → "All Media" sub-tab.
    gridSelector: '#all-media .media-content > .row',
    loadMoreSelector: '#all-media .media-content > .load-btn',
    uploadSelector: '#all-media .media-content > .media-upload',
    variant: 'media-thumb',
    emptyText: 'No media uploaded yet.',
  },
  {
    // Media tab → "Photos" sub-tab.
    gridSelector: '#photos-media .media-content > .row',
    loadMoreSelector: '#photos-media .media-content > .load-btn',
    uploadSelector: '#photos-media .media-content > .media-upload',
    variant: 'media-thumb',
    kind: 'photo',
    emptyText: 'No photos uploaded yet.',
  },
  {
    // Media tab → "Videos" sub-tab.
    gridSelector: '#video .media-content > .row',
    loadMoreSelector: '#video .media-content > .load-btn',
    uploadSelector: '#video .media-content > .media-upload',
    variant: 'media-thumb',
    kind: 'video',
    emptyText: 'No videos uploaded yet.',
  },
];

export async function bindProfileMedia(
  ctx: PageContext,
  targetUserId: string,
  viewerUserId: string | null,
): Promise<void> {
  const mctx: MediaContext = {
    ctx,
    targetUserId,
    isOwner: viewerUserId !== null && viewerUserId === targetUserId,
  };

  for (const config of GRIDS) {
    const grid = document.querySelector<HTMLElement>(config.gridSelector);
    if (!grid) continue;
    if (config.uploadSelector && !mctx.isOwner) {
      document
        .querySelector<HTMLElement>(config.uploadSelector)
        ?.style.setProperty('display', 'none');
    }
    void initGrid(grid, config, mctx);
  }
}

type GridState = {
  loadedOnce: boolean;
  loading: boolean;
  items: UserMediaItemDto[];
  nextCursor: string | null;
};

const gridStates = new WeakMap<HTMLElement, GridState>();

async function initGrid(
  grid: HTMLElement,
  config: GridConfig,
  mctx: MediaContext,
): Promise<void> {
  const state: GridState = {
    loadedOnce: false,
    loading: false,
    items: [],
    nextCursor: null,
  };
  gridStates.set(grid, state);

  // Strip the template's hard-coded sample tiles before we show anything.
  grid.innerHTML = '';

  const loadMore = document.querySelector<HTMLElement>(config.loadMoreSelector);
  const loadMoreLink = loadMore?.querySelector<HTMLAnchorElement>('a');
  if (loadMore) loadMore.style.display = 'none';
  if (loadMoreLink) {
    loadMoreLink.addEventListener('click', (event) => {
      event.preventDefault();
      void loadPage(grid, config, mctx);
    });
  }

  // Defer fetch until the tab becomes visible — except for the top-level
  // Photos grid, which lives on its own tab pane that may already be visible.
  const tabPane = grid.closest<HTMLElement>('.tab-pane');
  const shouldLoadNow = !tabPane || tabPane.classList.contains('active');
  if (shouldLoadNow) {
    await loadPage(grid, config, mctx);
  }
  const tabId = tabPane?.id;
  if (tabId) {
    const trigger = document.querySelector<HTMLElement>(
      `[data-bs-target="#${cssEscape(tabId)}"]`,
    );
    const onShow = (): void => {
      const s = gridStates.get(grid);
      if (s && !s.loadedOnce && !s.loading) void loadPage(grid, config, mctx);
    };
    trigger?.addEventListener('shown.bs.tab', onShow);
    trigger?.addEventListener('click', () => {
      // Bootstrap-less fallback.
      setTimeout(onShow, 0);
    });
  }
}

async function loadPage(
  grid: HTMLElement,
  config: GridConfig,
  mctx: MediaContext,
): Promise<void> {
  const state = gridStates.get(grid);
  if (!state || state.loading) return;
  state.loading = true;

  if (state.items.length === 0) {
    renderSkeleton(grid, config);
  }

  try {
    const data = await mctx.ctx
      .dispatch(
        mediaApi.endpoints.listUserMedia.initiate({
          userId: mctx.targetUserId,
          ...(config.kind ? { kind: config.kind } : {}),
          ...(state.nextCursor ? { cursor: state.nextCursor } : {}),
          limit: PAGE_SIZE,
        }),
      )
      .unwrap();
    appendItems(grid, config, state, data);
    state.loadedOnce = true;
  } catch (raw) {
    console.error('[profileMedia] load failed', { config, raw });
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    if (err?.code === 'INVALID_CREDENTIALS') {
      mctx.ctx.dispatch(signedOut());
      window.location.replace('/login.html');
      return;
    }
    const message =
      err?.message ??
      (raw instanceof Error ? raw.message : 'Could not load media.');
    renderError(grid, message);
  } finally {
    state.loading = false;
  }
}

function appendItems(
  grid: HTMLElement,
  config: GridConfig,
  state: GridState,
  data: UserMediaListResponseData,
): void {
  const isFirstPage = state.items.length === 0;
  state.items.push(...data.items);
  state.nextCursor = data.nextCursor;

  if (isFirstPage && state.items.length === 0) {
    renderEmpty(grid, config);
  } else {
    if (isFirstPage) grid.innerHTML = '';
    const html = data.items
      .map((item) => itemHtml(item, config.variant))
      .join('');
    grid.insertAdjacentHTML('beforeend', html);
  }

  const loadMore = document.querySelector<HTMLElement>(config.loadMoreSelector);
  if (loadMore) {
    loadMore.style.display = state.nextCursor ? '' : 'none';
  }
}

function itemHtml(item: UserMediaItemDto, variant: GridConfig['variant']): string {
  const thumb = item.thumbnailUrl ?? item.url;
  const alt = escapeHtml(item.caption ?? (item.kind === 'video' ? 'video' : 'photo'));
  const inner =
    item.kind === 'video'
      ? `
          <video src="${escapeHtml(item.url)}"
            ${item.thumbnailUrl ? `poster="${escapeHtml(item.thumbnailUrl)}"` : ''}
            controls preload="metadata"
            style="width:100%;height:100%;object-fit:cover;background:#000;border-radius:inherit;">
          </video>
        `
      : `<img src="${escapeHtml(thumb)}" alt="${alt}" class="rounded" loading="lazy">`;
  const wrapperClass = variant === 'gallery' ? 'gallery-img' : 'media-thumb';
  return `
    <div class="col">
      <div class="${wrapperClass}" data-app-media-id="${escapeHtml(item.id)}">
        ${inner}
      </div>
    </div>
  `;
}

function renderSkeleton(grid: HTMLElement, config: GridConfig): void {
  const wrapperClass = config.variant === 'gallery' ? 'gallery-img' : 'media-thumb';
  const cells = Array.from({ length: 6 })
    .map(
      () => `
        <div class="col">
          <div class="${wrapperClass}"
            style="aspect-ratio:1/1;background:linear-gradient(90deg,#1f1418 0%,#2a191e 50%,#1f1418 100%);background-size:200% 100%;animation:app-shimmer-slide 1.4s ease-in-out infinite;border-radius:8px;">
          </div>
        </div>
      `,
    )
    .join('');
  grid.innerHTML = cells;
}

function renderEmpty(grid: HTMLElement, config: GridConfig): void {
  grid.innerHTML = `
    <div class="col-12" style="padding:24px 0;text-align:center;opacity:0.75;">
      <p style="margin:0;"><i class="icofont-worried"></i> ${escapeHtml(config.emptyText)}</p>
    </div>
  `;
}

function renderError(grid: HTMLElement, message: string): void {
  grid.innerHTML = `
    <div class="col-12" style="padding:24px 0;text-align:center;">
      <p style="color:#e84a5f;margin:0;">${escapeHtml(message)}</p>
    </div>
  `;
}

function cssEscape(value: string): string {
  const css = (window as unknown as { CSS?: { escape?: (s: string) => string } })
    .CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/(["\\])/g, '\\$1');
}
