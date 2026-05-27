import { parseApiError } from '@/api/baseQuery';
import { blogApi } from '@/api/blogApi';
import { registerPage, type PageBinder, type PageContext } from '@/pages';
import { cachePost, getCachedPost } from '@/lib/blogCache';
import { escapeHtml } from '@/lib/format';
import { bindJoinGroupWidget } from '@/lib/joinGroupWidget';
import { bindLikeMemberWidget } from '@/lib/likeMemberWidget';
import { bindSidebarMemberFilters } from '@/lib/memberFilter';
import { showToast } from '@/lib/toast';
import type {
  BlogBodyBlock,
  BlogPostDto,
  CommentDto,
  CommentsListResponseData,
} from '@/types/api';

const FALLBACK_THUMB = 'assets/images/blog/03.jpg';
const FALLBACK_COMMENT_AVATAR = 'assets/images/member/01.jpg';
const COMMENTS_PAGE_SIZE = 20;

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

  void bindSidebarMemberFilters(ctx);
  void bindLikeMemberWidget(ctx);
  void bindJoinGroupWidget(ctx);

  const slug = readSlug();
  if (!slug) {
    renderError(article, 'No post specified.');
    return;
  }

  const cached = getCachedPost(slug);
  let lastSerialized: string | null = null;
  if (cached) {
    renderArticle(article, cached, ctx);
    if (breadcrumb) updateBreadcrumb(breadcrumb, cached.title);
    document.title = `${cached.title} — TuruLav`;
    lastSerialized = JSON.stringify(cached);
    void bindComments(ctx, cached);
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
      renderArticle(article, post, ctx);
      if (breadcrumb) updateBreadcrumb(breadcrumb, post.title);
      document.title = `${post.title} — TuruLav`;
    }
    void bindComments(ctx, post);
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
  // Canonical form: `/blog/<slug>` via serve/Vercel rewrite to blog-single.html.
  // Legacy `?slug=…` is still accepted so old links keep working.
  const pathMatch = window.location.pathname.match(/^\/blog\/([^/?#]+)\/?$/);
  if (pathMatch) {
    const fromPath = decodeURIComponent(pathMatch[1]!).trim();
    if (fromPath) return fromPath;
  }
  const raw = new URLSearchParams(window.location.search).get('slug');
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
        <p style="margin-top:16px;"><a href="/blog" class="lab-btn"><span>Back to Blog</span></a></p>
      </div>
    </div>
  `;
}

function renderArticle(
  article: HTMLElement,
  post: BlogPostDto,
  ctx?: PageContext,
): void {
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
      ${reactionsHtml(post)}
      ${tagsHtml(post)}
    </div>
  `;

  if (ctx) bindReactions(ctx, article, post);
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

function reactionsHtml(post: BlogPostDto): string {
  const liked = post.viewerLiked ? ' is-liked' : '';
  const ariaPressed = post.viewerLiked ? 'true' : 'false';
  const likeWord = post.likeCount === 1 ? 'Like' : 'Likes';
  const commentWord = post.commentCount === 1 ? 'Comment' : 'Comments';
  return `
    <div class="blog-footer" data-app-reactions>
      <div class="right" style="margin-left:auto;">
        <button type="button"
          class="blog-heart app-blog-like-btn${liked}"
          aria-pressed="${ariaPressed}"
          data-post-id="${escapeHtml(post.id)}"
          style="background:none;border:0;padding:0;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
          <i class="icofont-heart-alt"></i>
          <span class="app-like-count">${post.likeCount}</span>
          <span class="d-none d-sm-inline-block app-like-word">${likeWord}</span>
        </button>
        <a href="#comments" class="blog-comment" style="margin-left:16px;">
          <i class="icofont-comment"></i>
          <span class="app-comment-count">${post.commentCount}</span>
          <span class="d-none d-sm-inline-block">${commentWord}</span>
        </a>
      </div>
    </div>
  `;
}

function bindReactions(
  ctx: PageContext,
  article: HTMLElement,
  post: BlogPostDto,
): void {
  const btn = article.querySelector<HTMLButtonElement>('button.app-blog-like-btn');
  if (!btn) return;

  let liked = post.viewerLiked;
  let count = post.likeCount;

  btn.addEventListener('click', () => {
    if (ctx.getState().auth.status !== 'authenticated') {
      showToast({ level: 'info', message: 'Sign in to like this post.' });
      return;
    }
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';

    const optimisticLiked = !liked;
    const optimisticCount = Math.max(0, count + (optimisticLiked ? 1 : -1));
    applyReactionState(btn, optimisticLiked, optimisticCount);

    const endpoint = optimisticLiked
      ? blogApi.endpoints.likeBlogPost
      : blogApi.endpoints.unlikeBlogPost;

    void ctx
      .dispatch(endpoint.initiate(post.id))
      .unwrap()
      .then((res) => {
        liked = res.viewerLiked;
        count = res.likeCount;
        applyReactionState(btn, liked, count);
      })
      .catch((raw: unknown) => {
        applyReactionState(btn, liked, count);
        const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
        showToast({
          level: 'error',
          message: err?.message ?? 'Could not update your reaction.',
        });
      })
      .finally(() => {
        delete btn.dataset.busy;
      });
  });
}

function applyReactionState(
  btn: HTMLButtonElement,
  liked: boolean,
  count: number,
): void {
  btn.classList.toggle('is-liked', liked);
  btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
  const countEl = btn.querySelector<HTMLElement>('.app-like-count');
  const wordEl = btn.querySelector<HTMLElement>('.app-like-word');
  if (countEl) countEl.textContent = String(count);
  if (wordEl) wordEl.textContent = count === 1 ? 'Like' : 'Likes';
}

function tagsHtml(post: BlogPostDto): string {
  if (post.tags.length === 0) return '';
  const tagItems = post.tags
    .map(
      (t) =>
        `<li><a href="/blog?tag=${encodeURIComponent(t.slug)}">${escapeHtml(t.name)}</a></li>`,
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

async function bindComments(ctx: PageContext, post: BlogPostDto): Promise<void> {
  const container = document.getElementById('comments');
  if (container && !container.dataset.appBound) {
    container.dataset.appBound = post.id;
    renderCommentsLoading(container, post.commentCount);
    void loadAndRenderComments(ctx, container, post.id);
  } else if (container && container.dataset.appBound !== post.id) {
    container.dataset.appBound = post.id;
    renderCommentsLoading(container, post.commentCount);
    void loadAndRenderComments(ctx, container, post.id);
  }

  const respond = document.getElementById('respond');
  if (respond && !respond.dataset.appBound) {
    respond.dataset.appBound = post.id;
    bindRespondForm(ctx, respond, post.id);
  }
}

function renderCommentsLoading(container: HTMLElement, count: number): void {
  container.innerHTML = `
    <div class="widget-title">
      <h3>${formatCommentsHeading(count)}</h3>
    </div>
    <ul class="comment-list">
      <li class="comment" style="opacity:0.7;">
        <div class="com-content"><p>Loading comments…</p></div>
      </li>
    </ul>
  `;
}

async function loadAndRenderComments(
  ctx: PageContext,
  container: HTMLElement,
  postId: string,
): Promise<void> {
  try {
    const data = await ctx
      .dispatch(
        blogApi.endpoints.listBlogComments.initiate({
          postId,
          limit: COMMENTS_PAGE_SIZE,
        }),
      )
      .unwrap();
    renderCommentsList(ctx, container, postId, data);
  } catch (raw) {
    const status = (raw as { status?: unknown }).status;
    if (status === 401 || status === 403) {
      renderCommentsRestricted(container);
      return;
    }
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    container.innerHTML = `
      <div class="widget-title">
        <h3>Comments</h3>
      </div>
      <p style="opacity:0.75;">${escapeHtml(err?.message ?? 'Could not load comments.')}</p>
    `;
  }
}

function renderCommentsRestricted(container: HTMLElement): void {
  container.innerHTML = `
    <div class="widget-title">
      <h3>Comments</h3>
    </div>
    <p style="opacity:0.85;">
      <a href="/login.html">Sign in</a> to view and join the discussion.
    </p>
  `;
}

function renderCommentsList(
  ctx: PageContext,
  container: HTMLElement,
  postId: string,
  data: CommentsListResponseData,
): void {
  const items = data.items;
  if (items.length === 0) {
    container.innerHTML = `
      <div class="widget-title">
        <h3>0 Comments</h3>
      </div>
      <p style="opacity:0.75;">Be the first to comment.</p>
    `;
    return;
  }

  const list = items.map((c) => commentItemHtml(c)).join('');
  container.innerHTML = `
    <div class="widget-title">
      <h3>${formatCommentsHeading(items.length)}</h3>
    </div>
    <ul class="comment-list">${list}</ul>
  `;

  container.querySelectorAll<HTMLButtonElement>('button.comment-show-replies').forEach((btn) => {
    btn.addEventListener('click', () => {
      const commentId = btn.dataset.commentId;
      if (!commentId) return;
      void loadAndRenderReplies(ctx, container, postId, commentId, btn);
    });
  });
}

async function loadAndRenderReplies(
  ctx: PageContext,
  container: HTMLElement,
  _postId: string,
  commentId: string,
  trigger: HTMLButtonElement,
): Promise<void> {
  const target = container.querySelector<HTMLUListElement>(
    `ul.comment-replies[data-replies-for="${cssEscape(commentId)}"]`,
  );
  if (!target) return;
  trigger.disabled = true;
  trigger.textContent = 'Loading replies…';
  try {
    const data = await ctx
      .dispatch(
        blogApi.endpoints.listBlogCommentReplies.initiate({
          commentId,
          limit: COMMENTS_PAGE_SIZE,
        }),
      )
      .unwrap();
    target.innerHTML = data.items.map((c) => commentItemHtml(c)).join('');
    target.hidden = false;
    trigger.remove();
  } catch (raw) {
    const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
    showToast({
      level: 'error',
      message: err?.message ?? 'Could not load replies.',
    });
    trigger.disabled = false;
    trigger.textContent = `View ${trigger.dataset.replyCount ?? ''} replies`;
  }
}

function commentItemHtml(c: CommentDto): string {
  const avatar = c.author.avatarUrl
    ? escapeHtml(c.author.avatarUrl)
    : FALLBACK_COMMENT_AVATAR;
  const name = escapeHtml(
    c.author.displayName || c.author.username || 'Member',
  );
  const date = formatCommentDate(c.createdAt);
  const body =
    c.isDeleted || !c.body
      ? '<em style="opacity:0.7;">[deleted]</em>'
      : escapeHtml(c.body);
  const repliesAffordance =
    c.replyCount > 0
      ? `<div class="reply-btn">
          <button type="button" class="comment-show-replies"
            data-comment-id="${escapeHtml(c.id)}"
            data-reply-count="${c.replyCount}"
            style="background:none;border:0;padding:0;color:inherit;cursor:pointer;opacity:0.85;text-decoration:underline;">
            View ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        </div>`
      : '';
  return `
    <li class="comment" data-comment-id="${escapeHtml(c.id)}">
      <div class="com-image">
        <img alt="" src="${avatar}" class="avatar avatar-90 photo" height="90" width="90">
      </div>
      <div class="com-content">
        <div class="com-title">
          <div class="com-title-meta">
            <h4><span class="url">${name}</span></h4>
            <span>${date}</span>
          </div>
        </div>
        <p>${body}</p>
        ${repliesAffordance}
        <ul class="comment-list comment-replies" data-replies-for="${escapeHtml(c.id)}" hidden></ul>
      </div>
    </li>
  `;
}

function bindRespondForm(
  ctx: PageContext,
  respond: HTMLElement,
  postId: string,
): void {
  const authed = ctx.getState().auth.status === 'authenticated';
  if (!authed) {
    respond.innerHTML = `
      <div class="add-comment">
        <div class="widget-title">
          <h3>Leave a Comment</h3>
        </div>
        <p style="opacity:0.85;">
          <a href="/login.html">Sign in</a> to comment on this post.
        </p>
      </div>
    `;
    return;
  }

  const form = respond.querySelector<HTMLFormElement>('form#commentform');
  if (!form) return;

  // The static template carries name/email/url inputs; for authenticated
  // members the backend pulls identity from the session and only needs the
  // body. Drop the extras so the form aligns with CreateCommentRequest.
  form
    .querySelectorAll<HTMLInputElement>(
      'input[name="author"], input[name="email"], input[name="url"]',
    )
    .forEach((el) => el.remove());

  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="comment"]');
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!textarea || !submitBtn) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const body = textarea.value.trim();
    if (!body) {
      showToast({ level: 'warning', message: 'Write something first.' });
      textarea.focus();
      return;
    }
    submitBtn.disabled = true;
    submitBtn.dataset.busy = '1';
    void ctx
      .dispatch(
        blogApi.endpoints.createBlogComment.initiate({
          postId,
          body: { body },
        }),
      )
      .unwrap()
      .then(() => {
        textarea.value = '';
        showToast({ level: 'success', message: 'Comment posted.' });
        const container = document.getElementById('comments');
        if (container) void loadAndRenderComments(ctx, container, postId);
      })
      .catch((raw: unknown) => {
        const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
        showToast({
          level: 'error',
          message: err?.message ?? 'Could not post the comment.',
        });
      })
      .finally(() => {
        submitBtn.disabled = false;
        delete submitBtn.dataset.busy;
      });
  });
}

function formatCommentsHeading(count: number): string {
  const padded = count < 10 ? `0${count}` : `${count}`;
  return `${padded} ${count === 1 ? 'Comment' : 'Comments'}`;
}

function formatCommentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function cssEscape(value: string): string {
  // CSS.escape is widely supported; fall back to a conservative replace.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

registerPage('blog-single', bindBlogSingle);
