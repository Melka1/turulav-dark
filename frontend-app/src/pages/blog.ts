import { parseApiError } from '@/api/baseQuery';
import { blogApi } from '@/api/blogApi';
import { registerPage, type PageBinder } from '@/pages';
import { cachePosts } from '@/lib/blogCache';
import { escapeHtml } from '@/lib/format';
import { bindLikeMemberWidget } from '@/lib/likeMemberWidget';
import { bindSidebarMemberFilters } from '@/lib/memberFilter';
import { renderPagination } from '@/lib/pagination';
import type { BlogListQuery, BlogPostDto } from '@/types/api';

const DEFAULT_LIMIT = 12;
const FALLBACK_THUMB = 'assets/images/blog/01.jpg';

const bindBlog: PageBinder = async (ctx) => {
  const wrapper = document.querySelector<HTMLElement>(
    'section.blog-section .blog-wrapper',
  );
  const paginationList = document.querySelector<HTMLUListElement>(
    'section.blog-section .paginations ul',
  );

  if (!wrapper) {
    console.warn('[blog] expected .blog-wrapper missing on this page');
    return;
  }

  let state: BlogListQuery = {
    ...readInitialQuery(),
    limit: DEFAULT_LIMIT,
  };

  const runFetch = async (): Promise<void> => {
    renderLoading(wrapper);
    try {
      const data = await ctx
        .dispatch(blogApi.endpoints.listBlogPosts.initiate(state))
        .unwrap();
      cachePosts(data.items);
      renderList(wrapper, data.items);
      renderPagination(paginationList, data, (page) => {
        state = { ...state, page };
        void runFetch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    } catch (raw) {
      const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
      renderError(wrapper, err?.message ?? 'Could not load blog posts.');
      if (paginationList) paginationList.innerHTML = '';
    }
  };

  void runFetch();
  void bindSidebarMemberFilters(ctx);
  void bindLikeMemberWidget(ctx);
};

function readInitialQuery(): BlogListQuery {
  const params = new URLSearchParams(window.location.search);
  const out: BlogListQuery = {};
  const tag = params.get('tag');
  if (tag) out.tag = tag;
  const q = params.get('q');
  if (q) out.q = q;
  const authorId = params.get('authorId');
  if (authorId) out.authorId = authorId;
  const sort = params.get('sort');
  if (sort === 'recent' || sort === 'popular') out.sort = sort;
  const page = Number(params.get('page'));
  if (Number.isFinite(page) && page >= 1) out.page = page;
  return out;
}

function renderLoading(wrapper: HTMLElement): void {
  wrapper.innerHTML = `
    <div style="text-align:center;padding:48px 0;opacity:0.7;">
      <p>Loading blog posts…</p>
    </div>
  `;
}

function renderError(wrapper: HTMLElement, message: string): void {
  wrapper.innerHTML = `
    <div style="text-align:center;padding:48px 0;">
      <p style="color:#e84a5f;">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderList(wrapper: HTMLElement, items: BlogPostDto[]): void {
  if (items.length === 0) {
    wrapper.innerHTML = `
      <div style="text-align:center;padding:48px 0;opacity:0.8;">
        <p>No blog posts yet.</p>
      </div>
    `;
    return;
  }
  wrapper.innerHTML = items.map(cardHtml).join('');
}

function cardHtml(post: BlogPostDto): string {
  // Path-style URL — serve/Vercel rewrites `/blog/:slug` to `blog-single.html`
  // (see serve.json + vercel.json), so the slug rides in the URL itself and
  // there's no `?slug=` query string to lose to cleanUrls' 301.
  const href = `/blog/${encodeURIComponent(post.slug)}`;
  const title = escapeHtml(post.title);
  const excerpt = escapeHtml(post.excerpt);
  const authorName = escapeHtml(
    post.author.displayName || post.author.username || 'Admin',
  );
  const date = formatPostDate(post.publishedAt ?? post.createdAt);
  const isVideo = !!post.cover.videoUrl;
  const variantClass = isVideo ? ' video-post' : '';

  return `
    <div class="post-item${variantClass}" data-app-blog-slug="${escapeHtml(post.slug)}">
      <div class="post-item-inner">
        ${thumbHtml(post, href)}
        <div class="post-content">
          <span class="meta">By <a href="#">${authorName}</a> ${date}</span>
          <h3><a href="${href}">${title}</a></h3>
          <p>${excerpt}</p>
        </div>
        <div class="blog-footer">
          <a href="${href}" class="viewall">Read More <i class="icofont-double-right"></i></a>
          <div class="right">
            <a href="#" class="blog-heart"><i class="icofont-heart-alt"></i> ${post.likeCount}
              <span class="d-none d-sm-inline-block">Like${post.likeCount === 1 ? '' : 's'}</span>
            </a>
            <a href="${href}#comments" class="blog-comment"><i class="icofont-comment"></i> ${post.commentCount}
              <span class="d-none d-sm-inline-block">Comment${post.commentCount === 1 ? '' : 's'}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Inline styles enforce a uniform 16:9 thumbnail across cards so real-world
// covers of varying dimensions fill the box without letterboxing or
// distortion. The template CSS only sets width:100% on .post-thumb img.
const THUMB_BOX_STYLE =
  'aspect-ratio:16/9;width:100%;overflow:hidden;display:block;';
const THUMB_MEDIA_STYLE =
  'width:100%;height:100%;object-fit:cover;display:block;';

function thumbHtml(post: BlogPostDto, href: string): string {
  if (post.cover.videoUrl) {
    return `
      <div class="post-thumb">
        <div class="embed-responsive" style="${THUMB_BOX_STYLE}position:relative;">
          <iframe src="${escapeHtml(post.cover.videoUrl)}" allowfullscreen loading="lazy"
            style="${THUMB_MEDIA_STYLE}border:0;position:absolute;inset:0;"></iframe>
        </div>
      </div>
    `;
  }
  const cover = post.cover.imageUrl
    ? escapeHtml(post.cover.imageUrl)
    : FALLBACK_THUMB;
  return `
    <div class="post-thumb" style="${THUMB_BOX_STYLE}">
      <a href="${href}" style="display:block;width:100%;height:100%;">
        <img src="${cover}" alt="${escapeHtml(post.title)}" loading="lazy"
          style="${THUMB_MEDIA_STYLE}">
      </a>
    </div>
  `;
}

function formatPostDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

registerPage('blog', bindBlog);
