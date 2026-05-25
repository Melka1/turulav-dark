import { parseApiError } from '@/api/baseQuery';
import { blogApi } from '@/api/blogApi';
import { registerPage, type PageBinder } from '@/pages';
import { cachePost, getCachedPost } from '@/lib/blogCache';
import { escapeHtml } from '@/lib/format';
import type { BlogBodyBlock, BlogPostDto } from '@/types/api';

const FALLBACK_THUMB = 'assets/images/blog/03.jpg';

const bindBlogSingle: PageBinder = async (ctx) => {
  const article = document.querySelector<HTMLElement>(
    'section.blog-section .blog-wrapper .post-item',
  );
  const breadcrumb = document.querySelector<HTMLOListElement>(
    'section.page-header-section ol.breadcrumb',
  );

  if (!article) {
    console.warn('[blog-single] expected .post-item missing on this page');
    return;
  }

  const slug = readSlug();
  if (!slug) {
    renderError(article, 'No post specified.');
    return;
  }

  const cached = getCachedPost(slug);
  let lastSerialized: string | null = null;
  if (cached) {
    renderArticle(article, cached);
    if (breadcrumb) updateBreadcrumb(breadcrumb, cached.title);
    document.title = `${cached.title} — TuruLav`;
    lastSerialized = JSON.stringify(cached);
  } else {
    renderLoading(article);
  }

  try {
    const post = await ctx
      .dispatch(blogApi.endpoints.getBlogPost.initiate(slug))
      .unwrap();
    cachePost(post);
    const fresh = JSON.stringify(post);
    if (fresh !== lastSerialized) {
      renderArticle(article, post);
      if (breadcrumb) updateBreadcrumb(breadcrumb, post.title);
      document.title = `${post.title} — TuruLav`;
    }
  } catch (raw) {
    // Revalidation failure with a cached render on screen is non-fatal —
    // leave the cached view in place. Only surface the error when there's
    // nothing else to show.
    if (cached) return;
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    const status = (raw as { status?: unknown }).status;
    const message =
      status === 404
        ? 'This post could not be found.'
        : (err?.message ?? 'Could not load the post.');
    renderError(article, message);
  }
};

function readSlug(): string | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('slug');
  return raw ? raw.trim() : null;
}

function renderLoading(article: HTMLElement): void {
  article.innerHTML = `
    <div class="post-item-inner">
      <div class="post-content" style="text-align:center;padding:48px 0;opacity:0.7;">
        <p>Loading post…</p>
      </div>
    </div>
  `;
}

function renderError(article: HTMLElement, message: string): void {
  article.innerHTML = `
    <div class="post-item-inner">
      <div class="post-content" style="text-align:center;padding:48px 0;">
        <p style="color:#e84a5f;">${escapeHtml(message)}</p>
        <p style="margin-top:16px;"><a href="blog" class="lab-btn"><span>Back to Blog</span></a></p>
      </div>
    </div>
  `;
}

function renderArticle(article: HTMLElement, post: BlogPostDto): void {
  const authorName = escapeHtml(
    post.author.displayName || post.author.username || 'Admin',
  );
  const date = formatPostDate(post.publishedAt ?? post.createdAt);
  const title = escapeHtml(post.title);

  article.innerHTML = `
    <div class="post-item-inner">
      ${heroHtml(post)}
      <div class="post-content">
        <span class="meta">By <a href="#">${authorName}</a> ${date}</span>
        <h3>${title}</h3>
        <div class="post-body">${renderBody(post.body)}</div>
      </div>
      ${tagsHtml(post)}
    </div>
  `;
}

// Same fill-the-box treatment as the list cards, slightly wider hero ratio.
const HERO_BOX_STYLE =
  'aspect-ratio:16/9;width:100%;overflow:hidden;display:block;';
const HERO_MEDIA_STYLE =
  'width:100%;height:100%;object-fit:cover;display:block;';

function heroHtml(post: BlogPostDto): string {
  if (post.cover.videoUrl) {
    return `
      <div class="post-thumb" style="${HERO_BOX_STYLE}">
        <div class="embed-responsive" style="${HERO_BOX_STYLE}position:relative;">
          <iframe src="${escapeHtml(post.cover.videoUrl)}" allowfullscreen loading="lazy"
            style="${HERO_MEDIA_STYLE}border:0;position:absolute;inset:0;"></iframe>
        </div>
      </div>
    `;
  }
  const cover = post.cover.imageUrl
    ? escapeHtml(post.cover.imageUrl)
    : FALLBACK_THUMB;
  return `
    <div class="post-thumb" style="${HERO_BOX_STYLE}">
      <img src="${cover}" alt="${escapeHtml(post.title)}" style="${HERO_MEDIA_STYLE}">
    </div>
  `;
}

function renderBody(blocks: BlogBodyBlock[] | null | undefined): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  return blocks.map(renderBlock).filter(Boolean).join('');
}

function renderBlock(block: BlogBodyBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'quote': {
      const attribution = block.attribution
        ? `<cite style="display:block;margin-top:8px;opacity:0.75;">— ${escapeHtml(block.attribution)}</cite>`
        : '';
      return `<blockquote><p>${escapeHtml(block.text)}</p>${attribution}</blockquote>`;
    }
    case 'list': {
      const tag = block.style === 'numbered' ? 'ol' : 'ul';
      const items = block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'image': {
      const figures = block.images
        .map((img) => {
          const alt = escapeHtml(img.alt ?? '');
          const caption = img.caption
            ? `<figcaption style="margin-top:8px;opacity:0.75;font-size:0.9em;">${escapeHtml(img.caption)}</figcaption>`
            : '';
          return `<figure style="margin:24px 0;"><img src="${escapeHtml(img.url)}" alt="${alt}" style="width:100%;height:auto;">${caption}</figure>`;
        })
        .join('');
      return figures;
    }
    case 'heading': {
      const level = Math.min(Math.max(block.level ?? 2, 2), 5);
      return `<h${level}>${escapeHtml(block.text)}</h${level}>`;
    }
    default:
      return '';
  }
}

function tagsHtml(post: BlogPostDto): string {
  if (post.tags.length === 0) return '';
  const tagItems = post.tags
    .map(
      (t) =>
        `<li><a href="blog?tag=${encodeURIComponent(t.slug)}">${escapeHtml(t.name)}</a></li>`,
    )
    .join('');
  return `
    <div class="tags-section">
      <ul class="tags">
        <li><span><i class="icofont-tags"></i></span></li>
        ${tagItems}
      </ul>
    </div>
  `;
}

function updateBreadcrumb(breadcrumb: HTMLOListElement, title: string): void {
  const active = breadcrumb.querySelector<HTMLElement>('li.active');
  if (active) active.textContent = title;
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

registerPage('blog-single', bindBlogSingle);
