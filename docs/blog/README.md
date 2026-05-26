# BlogPost + BlogComment + Tag Model

Editorial blog that backs `blog.html` (listing) and `blog-single.html` (article). Posts are the unit; the four post formats (`standard` / `gallery` / `video` / `code`) are render variants over the same row.

**Scope:** posts, formats, tags, likes, members-only comments — everything required to render the blog index, read an article, like it, and discuss it inline.

**Out of scope:** notifications fan-out (separate Notification model), full-text search/relevance ranking, RSS export, scheduled-publish workflow, the contact form, the sidebar widgets that pull from other slices (`like-member` → Profiles, `active-group` → Groups).

**Dependencies:** User + Profile (authors, commenters). Activity model is a parallel slice — comments here are **not** the same table, but share the wire shape (`CommentDto`) to keep the frontend client uniform. See [`docs/SUMMARY.md`](../SUMMARY.md) item 7.

---

## Decisions

| # | Decision | Note |
|---|---|---|
| 1 | **One `blog_posts` table, `format` is an enum** | The four card variants (`standard`/`gallery`/`video`/`code`) differ only in which media slot is rendered. A single table with a `format` discriminator beats four post tables. CHECK constraint enforces format ↔ payload consistency. |
| 2 | **Slugs are the public URL key, not ids** | `/blog/posts/:slug` is human-readable and SEO-friendly. Slugs are unique, immutable post-publish (would break inbound links). Backend handles collision by appending `-2`, `-3`, … on insert. |
| 3 | **Members-only commenting** | `blog_comments.author_id` is NOT NULL and references `public.users`. No guest fields. The name/email/subject inputs on the current HTML form are a template artifact and will be replaced with a logged-in composer. |
| 4 | **Separate `blog_comments` table, shared `CommentDto` shape** | Activity comments FK to `public.posts`; blog comments FK to `public.blog_posts`. Two tables, identical wire shape (reused on the frontend via `@/types/api`). |
| 5 | **Simple like (toggle), not multi-type reactions** | The blog UI shows a single heart with a count — not the six-emoji activity reaction set. `blog_post_likes` is a thin PK = `(post_id, user_id)` table. Keeps the surface small and the counter cheap. |
| 6 | **Tags M:N via `blog_post_tags` join** | Tag has `slug` (URL key) + `name` (display). Slugs are stable; renaming changes `name` only. Tags are admin-curated, not user-created. |
| 7 | **`status` enum drives visibility** | `draft` / `published` / `archived`. Non-published posts are invisible to non-authors. `published_at` is set on the transition into `published` (and frozen afterward). |
| 8 | **Authorship is role-gated** | Only `role IN ('moderator','admin')` can author posts. Members can like and comment but not write. Enforced in both controller guards and RLS. |
| 9 | **Body is sanitized HTML, stored as-is** | Markdown would mean a renderer round-trip on every read. We sanitize on insert/update with an allowlist (`p`, `blockquote`, `h2`–`h4`, `ul`/`ol`/`li`, `a`, `img`, `strong`/`em`, `code`, `pre`) and store the result. |
| 10 | **Offset pagination on the list** | The design has a numbered pager. Editorial volume is low (tens of posts/month, not feed-velocity), so the hot-insert footgun that bites the activity feed doesn't apply. `?page=N&limit=M`. |
| 11 | **Cursor pagination on comments** | Comment volume per post is unbounded; cursors keep mid-page stability. Mirrors activity. |
| 12 | **Soft-delete posts and comments, 30-day purge** | Same pattern as activity: `deleted_at` preserves like/comment counts; cron hard-deletes after retention. |
| 13 | **Video format = whitelisted providers only** | `video_url` accepted only for YouTube and Vimeo on insert. Storing raw URLs (vs. provider+id) keeps the renderer simple; the whitelist is the guard. |

---

## Entity relationships

```
public.users ──1:N──► public.blog_posts ──M:N──► public.media     (via blog_post_media, format='gallery')
                          │   │   │
                          │   │   └──M:N──► public.blog_tags      (via blog_post_tags)
                          │   │
                          │   └────1:N────► public.blog_post_likes ─► public.users
                          │
                          └────1:N────► public.blog_comments ──┐
                                              │                │ self-FK parent_id
                                              │                └─ public.users (author)
```

---

## Schema

```sql
create type blog_post_status as enum ('draft','published','archived');
create type blog_post_format as enum ('standard','gallery','video','code');

-- =========================================================================
-- blog_tags — admin-curated taxonomy
-- =========================================================================
create table public.blog_tags (
  slug        text primary key,                       -- url-safe, e.g. 'health-care'
  name        text not null,                          -- display, e.g. 'Health Care'
  created_at  timestamptz not null default now(),
  constraint blog_tags_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint blog_tags_name_length check (length(name) between 1 and 60)
);

-- =========================================================================
-- blog_posts
-- =========================================================================
create table public.blog_posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  author_id       uuid not null references public.users(id) on delete restrict,

  title           text not null,
  excerpt         text not null,                      -- plain text, for cards
  body            text,                               -- sanitized HTML; null when deleted

  format          blog_post_format not null default 'standard',
  cover_image_url text,                               -- always present once published
  video_url       text,                               -- required iff format='video'
  code_snippet    text,                               -- required iff format='code'

  status          blog_post_status not null default 'draft',
  published_at    timestamptz,                        -- set on first publish, frozen after

  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint blog_posts_slug_format    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint blog_posts_title_length   check (length(title) between 1 and 200),
  constraint blog_posts_excerpt_length check (length(excerpt) between 1 and 500),
  constraint blog_posts_body_required  check (deleted_at is not null or body is not null),
  constraint blog_posts_body_length    check (body is null or length(body) between 1 and 200000),

  constraint blog_posts_published_has_date check (
    (status = 'published') = (published_at is not null)
  ),
  constraint blog_posts_published_has_cover check (
    status <> 'published' or cover_image_url is not null
  ),
  constraint blog_posts_video_consistency check (
    (format = 'video') = (video_url is not null)
  ),
  constraint blog_posts_code_consistency check (
    (format = 'code') = (code_snippet is not null)
  )
);

create index blog_posts_published_idx on public.blog_posts (published_at desc)
  where status = 'published' and deleted_at is null;
create index blog_posts_author_idx    on public.blog_posts (author_id, created_at desc)
  where deleted_at is null;
create index blog_posts_format_idx    on public.blog_posts (format, published_at desc)
  where status = 'published' and deleted_at is null;

-- =========================================================================
-- blog_post_media — M:N to public.media (used by format='gallery')
-- =========================================================================
create table public.blog_post_media (
  post_id       uuid not null references public.blog_posts(id) on delete cascade,
  media_id      uuid not null references public.media(id)      on delete cascade,
  display_order int  not null default 0,
  primary key (post_id, media_id)
);

create index blog_post_media_media_idx on public.blog_post_media (media_id);

-- =========================================================================
-- blog_post_tags — M:N to public.blog_tags
-- =========================================================================
create table public.blog_post_tags (
  post_id  uuid not null references public.blog_posts(id) on delete cascade,
  tag_slug text not null references public.blog_tags(slug) on delete cascade,
  primary key (post_id, tag_slug)
);

create index blog_post_tags_tag_idx on public.blog_post_tags (tag_slug);

-- =========================================================================
-- blog_post_likes — one toggle per (post, user)
-- =========================================================================
create table public.blog_post_likes (
  post_id     uuid not null references public.blog_posts(id) on delete cascade,
  user_id     uuid not null references public.users(id)      on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index blog_post_likes_user_idx on public.blog_post_likes (user_id, created_at desc);

-- =========================================================================
-- blog_comments — members-only, mirrors activity.comments shape
-- =========================================================================
create table public.blog_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.blog_posts(id) on delete cascade,
  parent_id   uuid references public.blog_comments(id)        on delete cascade,
  author_id   uuid not null references public.users(id)       on delete cascade,

  body        text,
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint blog_comments_body_required check (deleted_at is not null or body is not null),
  constraint blog_comments_body_length   check (body is null or length(body) between 1 and 2000)
);

create index blog_comments_post_created_idx on public.blog_comments (post_id, created_at)
  where deleted_at is null;
create index blog_comments_parent_idx       on public.blog_comments (parent_id)
  where parent_id is not null;
```

Triggers: attach `touch_updated_at` (defined in the user doc) to `public.blog_posts` and `public.blog_comments`.

---

## RLS policies

Reads are open for published posts; writes require role + ownership. Drafts/archived are author-only.

```sql
alter table public.blog_posts       enable row level security;
alter table public.blog_post_media  enable row level security;
alter table public.blog_post_tags   enable row level security;
alter table public.blog_tags        enable row level security;
alter table public.blog_post_likes  enable row level security;
alter table public.blog_comments    enable row level security;

-- Helper assumed from user model: public.is_editor() returns true iff
-- auth.uid()'s users.role IN ('moderator','admin').

-- ============ blog_posts ============

-- Published posts are world-readable.
create policy blog_posts_select_published on public.blog_posts
  for select using (status = 'published' and deleted_at is null);

-- Authors and editors see their own/all drafts + deleted (for restore).
create policy blog_posts_select_author on public.blog_posts
  for select using (author_id = auth.uid() or public.is_editor());

-- Only editors can write. RLS check belt-and-braces with the controller guard.
create policy blog_posts_write_editor on public.blog_posts
  for all using (public.is_editor()) with check (public.is_editor() and author_id = auth.uid());

-- ============ blog_post_media / blog_post_tags ============
-- Visible iff parent post is visible (rely on EXISTS, not duplicate policy).

create policy blog_post_media_select on public.blog_post_media
  for select using (exists (select 1 from public.blog_posts p where p.id = post_id));
create policy blog_post_media_write_editor on public.blog_post_media
  for all using (public.is_editor()) with check (public.is_editor());

create policy blog_post_tags_select on public.blog_post_tags
  for select using (exists (select 1 from public.blog_posts p where p.id = post_id));
create policy blog_post_tags_write_editor on public.blog_post_tags
  for all using (public.is_editor()) with check (public.is_editor());

-- ============ blog_tags ============

create policy blog_tags_select_all on public.blog_tags for select using (true);
create policy blog_tags_write_editor on public.blog_tags
  for all using (public.is_editor()) with check (public.is_editor());

-- ============ blog_post_likes ============

create policy blog_post_likes_select on public.blog_post_likes
  for select using (exists (select 1 from public.blog_posts p where p.id = post_id));
create policy blog_post_likes_write_self on public.blog_post_likes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ blog_comments ============

create policy blog_comments_select on public.blog_comments
  for select using (
    deleted_at is null
    and exists (
      select 1 from public.blog_posts p
      where p.id = post_id and p.status = 'published' and p.deleted_at is null
    )
  );
create policy blog_comments_select_author on public.blog_comments
  for select using (author_id = auth.uid());  -- author sees own deleted

create policy blog_comments_write_self on public.blog_comments
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Editors can soft-delete any comment for moderation.
create policy blog_comments_moderate on public.blog_comments
  for update using (public.is_editor()) with check (public.is_editor());
```

---

## Backend endpoints

All require `@RequireVerified()`. Mutations on posts/tags require `@RequireRole('moderator','admin')`. Base URL inherits from the user doc (`/api/v1`).

### Posts

| Method | Path | Purpose |
|---|---|---|
| GET | `/blog/posts` | Listing. Query: `q?`, `tag?` (slug), `authorId?`, `format?`, `status?` (default `published` for non-editors; editors may pass `draft`/`archived`), `sort` ∈ {`recent`,`popular`} (default `recent`), `page` (default 1), `limit` (default 12, max 50). Offset pagination. |
| GET | `/blog/posts/:slug` | Single post by slug. Returns 404 for non-published unless viewer is the author or an editor. |
| POST | `/blog/posts` | Editor only. Body: `CreateBlogPostRequest`. Slug derived from `title` if absent. Sanitizes `body`. Inserts `blog_post_tags` rows from `tagSlugs`. For `format='gallery'`, inserts `blog_post_media` from `mediaIds` (validated as editor-owned + `status='ready'`). |
| PATCH | `/blog/posts/:id` | Editor only. Body: `UpdateBlogPostRequest`. Re-sanitizes `body`, syncs tags/media, sets `edited_at`. Slug change rejected once `published_at` is set. Transition to `status='published'` sets `published_at = now()` and requires `cover_image_url`. |
| DELETE | `/blog/posts/:id` | Editor only. Soft delete: body → null, `deleted_at = now()`. |

### Likes

| Method | Path | Purpose |
|---|---|---|
| PUT | `/blog/posts/:id/like` | Inserts viewer's like (idempotent). Returns `{ likeCount, viewerLiked: true }`. |
| DELETE | `/blog/posts/:id/like` | Removes viewer's like (idempotent). Returns `{ likeCount, viewerLiked: false }`. |

### Comments

| Method | Path | Purpose |
|---|---|---|
| GET | `/blog/posts/:id/comments` | Top-level comments with `replyCount` per row and first 3 replies inlined. Query: `cursor`, `limit` (default 20, max 50). |
| GET | `/blog/comments/:id/replies` | Lazy-load replies under a top-level comment. |
| POST | `/blog/posts/:id/comments` | Members-only. Body: `{ body, parentId? }`. Returns `CommentDto`. |
| PATCH | `/blog/comments/:id` | Author only. Body: `{ body }`. |
| DELETE | `/blog/comments/:id` | Soft delete. Author or editor. |

### Tags

| Method | Path | Purpose |
|---|---|---|
| GET | `/blog/tags` | Returns full taxonomy. Open. |
| POST | `/blog/tags` | Editor only. Body: `{ slug, name }`. |
| PATCH | `/blog/tags/:slug` | Editor only. Body: `{ name }`. Slug is immutable. |
| DELETE | `/blog/tags/:slug` | Editor only. Cascades to `blog_post_tags`. |

### Media

No dedicated endpoints — reuse Media:
1. Editor calls `POST /media/upload-url` (type `photo`).
2. Editor `PUT`s file to Storage signed URL.
3. Editor calls `POST /media/:id/confirm`.
4. Editor includes the resulting `mediaId` in `POST /blog/posts { mediaIds: [...] }` (for gallery) or as `coverImageUrl` (for any format).

---

## DTO shapes

Wire format mirrors what the frontend already consumes; see [`frontend-app/src/types/api.ts`](../../frontend-app/src/types/api.ts) → "Blog" section.

```ts
type BlogPostStatus = 'draft' | 'published' | 'archived';
type BlogPostFormat = 'standard' | 'gallery' | 'video' | 'code';

type BlogTagDto = {
  slug: string;
  name: string;
};

type BlogMediaDto = {
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  displayOrder: number;
};

type BlogPostMediaDto = {
  format: BlogPostFormat;
  coverImageUrl: string | null;     // always present once published
  media: BlogMediaDto[];            // [] unless format === 'gallery'
  videoUrl: string | null;          // null unless format === 'video'
  codeSnippet: string | null;       // null unless format === 'code'
};

type PostAuthorDto = {              // shared with activity
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

type BlogPostDto = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;                     // sanitized HTML
  author: PostAuthorDto;
  format: BlogPostFormat;
  cover: BlogPostMediaDto;
  tags: BlogTagDto[];
  status: BlogPostStatus;
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
  publishedAt: string | null;       // null while draft
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type BlogListResponseData = {
  items: BlogPostDto[];
  total: number;
  page: number;
  limit: number;
};

type CreateBlogPostRequest = {
  title: string;
  excerpt?: string;                 // derived from body if omitted
  body: string;
  format: BlogPostFormat;
  coverImageUrl?: string;
  mediaIds?: string[];              // for gallery
  videoUrl?: string;                // for video
  codeSnippet?: string;             // for code
  tagSlugs?: string[];
  status?: BlogPostStatus;          // default 'draft'
};

type UpdateBlogPostRequest = Partial<CreateBlogPostRequest>;

type BlogLikeResponseData = {
  likeCount: number;
  viewerLiked: boolean;
};

// Comments reuse the activity shapes verbatim:
//   CommentDto, CommentsListResponseData, CreateCommentRequest, UpdateCommentRequest
// CommentDto.postId carries the blog post id when scoped to /blog endpoints.
```

All responses are wrapped in the standard `ApiSuccessEnvelope<T>` (`{ success, data, meta }`).

---

## Visibility resolution

Per post, the viewer's effective access:

1. Viewer is the author OR is an editor → visible (incl. drafts, archived, and own deleted).
2. Post is soft-deleted → hidden (404).
3. `status = 'published'` → visible.
4. Otherwise → hidden.

Comments are visible iff (a) their parent post is visible to the viewer and (b) the comment isn't soft-deleted. The author always sees their own deleted comments for restore.

---

## Algorithms / logic owned by backend

- **Slug derivation.** From `title`: lowercase, replace non-alphanumeric with `-`, collapse repeats, trim. On insert, if collision, suffix `-2`, `-3`, … until unique. Slug is frozen once `published_at` is set; PATCH attempts to change it are rejected.
- **Body sanitization.** Use a HTML sanitizer with an allowlist (`p`, `blockquote`, `h2`–`h4`, `ul`/`ol`/`li`, `a[href,title,rel]`, `img[src,alt,title,width,height]`, `strong`/`em`/`u`, `code`, `pre`, `br`). Force `rel="nofollow noopener"` on outbound links. Strip all event handlers and `<script>`/`<style>`. Run on insert AND on edit.
- **Excerpt derivation.** If `excerpt` is absent on insert, strip tags from `body`, collapse whitespace, take first 280 chars + ellipsis.
- **Video URL whitelist.** For `format='video'`, accept only:
  - `https://www.youtube.com/embed/{id}` or `https://www.youtube.com/watch?v={id}` (normalize to embed form)
  - `https://player.vimeo.com/video/{id}` or `https://vimeo.com/{id}` (normalize to embed form)
- **Gallery ordering.** `display_order` set from the order of `mediaIds` in the request. PATCH replaces the full set (no partial diff).
- **Tag sync.** PATCH with `tagSlugs` is an authoritative replace: delete rows not in the new set, insert rows not in the old set. Atomic in one txn.
- **Like count.** `select count(*) from blog_post_likes where post_id = ?`. Inline in `BlogPostDto`; cache in Redis with short TTL if read p95 demands.
- **Comment count.** `select count(*) from blog_comments where post_id = ? and deleted_at is null`. Same caching note.
- **Popular sort.** `score = (likes_total + 2*comments_total) * recency_decay(published_at)` over a 30-day window. Deterministic so offset paging stays stable across reads (no cursor wobble like the activity feed has).
- **Soft-delete projection.** When a post is soft-deleted, the row stays so likes/comments/tags FKs remain valid. `body` is set to NULL; DTO returns `body: '', status: 'archived'`-style render is *not* used — instead the post is omitted from non-editor reads entirely (the activity model's "[deleted]" placeholder doesn't fit editorial content). The 30-day retention cron hard-deletes rows whose `deleted_at < now() - 30 days`; FK cascades clean up.
- **Authorship transfer.** `ON DELETE RESTRICT` on `blog_posts.author_id` prevents accidental author wipeout. To delete an editor with posts, run a backend migration to reassign posts to another editor first (admin tool, not exposed on the API).

---

## Implementation plan

### Phase 1 — Database
1. Migration: enums, tables, FKs, indexes, check constraints.
2. Attach `touch_updated_at` triggers to `blog_posts` and `blog_comments`.
3. Add `public.is_editor()` helper if not already present (returns `auth.uid()`'s role in (`moderator`,`admin`)).
4. RLS policies.
5. Verify: anonymous sees only published; editor sees drafts; member can like + comment; non-editor write to `blog_posts` is rejected.

### Phase 2 — Tags + Posts CRUD
6. `BlogTagsController` + service + repo.
7. `BlogPostsController` + service + repo.
8. `POST /blog/posts` — slug derivation, body sanitization, tag sync, gallery media ingestion.
9. `GET /blog/posts/:slug`, `PATCH /blog/posts/:id`, `DELETE /blog/posts/:id`.
10. `GET /blog/posts` with filters + offset pagination.

### Phase 3 — Likes + Comments
11. Likes endpoints (PUT/DELETE) + `likeCount` / `viewerLiked` in `BlogPostDto`.
12. Comments CRUD; nested reads via `replyCount` and `/blog/comments/:id/replies`.
13. Wire `commentCount` into `BlogPostDto`.

### Phase 4 — Sort + retention
14. `sort=popular` scoring.
15. Retention cron: hard-delete posts/comments with `deleted_at < now() - 30 days`.

### Phase 5 — Tests
16. **e2e**: editor creates draft → publishes → member likes + comments → list/detail round-trip.
17. **Visibility**: anonymous/member/editor × draft/published/archived/deleted matrix.
18. **Authorship**: member POST `/blog/posts` rejected (403); editor accepted.
19. **Sanitization**: `<script>` stripped, `onerror=` removed, allowed tags preserved.
20. **Slug**: collisions suffix correctly; published slug edit rejected.
21. **Format constraints**: `video` requires `videoUrl`; `code` requires `codeSnippet`; gallery `mediaIds` validated for ownership + ready status.
22. **Likes**: PUT idempotent, DELETE idempotent, count rollup accurate.
23. **Comments**: nested fetch, soft-delete preserves count, author-edit OK / stranger-edit rejected, editor-moderate OK.
24. **Retention**: deleted post returns 404, retained 30 days, then purged with cascades.

---

## Open items

- **Authorship model.** Restricted to `moderator`/`admin` here. If you want a separate `blog_author` role (members who can post but not moderate), add it to the user role enum and to `is_editor()` semantics.
- **Scheduled publishing.** No `scheduled_at` field — publish is immediate. If marketing wants future-dated posts, add `scheduled_at` + a cron that flips `status` to `published` and sets `published_at`.
- **Categories vs tags.** Tags are flat. The HTML doesn't show categories; if editorial wants a hierarchy, add `blog_categories` with a 1:N FK on `blog_posts`.
- **SEO metadata.** Title + excerpt cover OG basics. If we want explicit `meta_description`, `og_image`, canonical URL overrides, add columns to `blog_posts`.
- **Related-posts widget.** The single page has a "you may like" sidebar. Currently rendered from Profiles. If editorial wants related *posts* there instead, define the relation (shared tags, same author, hand-curated `related_post_ids`).
- **Anonymous likes / view counts.** Not tracked. If we want a view counter, add an idempotent `POST /blog/posts/:id/view` with a fingerprint + rate-limit, and a counter column.
- **Reading time.** Not stored. Compute on read from `body` length if the UI ever wants it; cheap, no schema change.
- **Comment threading depth.** Schema supports unbounded; the design shows one nested level. Decide whether to cap at the API or just let the renderer flatten deeper replies into a single level.
- **Notification fan-out.** New comment → notify post author + parent-comment author. Mention support in blog comments — out of scope for v1.
- **Cross-posting from activity.** Some platforms let editorial posts also land in the activity feed. Out of scope; would be a `blog_post_id` FK on `posts`.
