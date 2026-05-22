# Activity (Post + Reaction + Comment + Favorite) Model

Social feed that backs `profile.html` → **Activity** tab. Posts are the unit; the five pill sub-tabs (Personal / Mentions / Favorites / Friends / Groups) are five queries over the same `posts` table.

**Scope:** posts, reactions, comments, favorites, mentions, attachments — everything required to render and interact with the Activity tab and the inline composer.

**Out of scope:** notifications fan-out (separate Notification model), DM threads (Conversation model), blog posts, full-text search/relevance ranking ("Relevant" sort stays a placeholder for v1).

**Dependencies:** Friendship model (for the Friends lens and `audience='friends'` visibility) — see [`docs/SUMMARY.md`](../SUMMARY.md) item 3. This spec defines the consumer side; if Friendship isn't shipped yet, the Friends pill is hidden on the frontend and `audience='friends'` falls back to author-only visibility.

---

## Decisions

| # | Decision | Note |
|---|---|---|
| 1 | **One `posts` table, lenses are query filters** | The five sub-tabs aren't separate entities — they're `WHERE` clauses (`author_id =`, mention exists, favorite exists, author IN friends, group_id IN my groups). Avoids per-lens denormalization. |
| 2 | **Four audiences, one column** | `audience` enum: `public` / `friends` / `private` / `group`. `group_id` required iff `audience='group'`, null otherwise (CHECK constraint). Mixing "friends-only within a group" is rejected — group membership already gates visibility. |
| 3 | **Attachments via existing `media` rows** | Composer uploads go through the Media two-phase upload (see [media doc](../media/README.md)) and produce `public.media` rows. `post_attachments` is an M:N join that pins media to a post. Reuses thumbnails, visibility checks, and storage paths. |
| 4 | **Soft-delete posts and comments** | `deleted_at` flag preserves reaction/mention/favorite history and downstream counts. Body is replaced with NULL on delete; cards render as "[deleted]". Hard-purged by a 30-day retention cron. |
| 5 | **Mentions extracted server-side** | Body text is canonical; backend parses `@username` on insert/update, resolves to `user_id`, populates `post_mentions`. Frontend never writes mentions directly — prevents tampering. |
| 6 | **One reaction per user per post** | `reactions` PK = `(post_id, user_id)`. Changing reaction is an UPSERT; type column carries the kind. Matches the UI summary ("Julia, Petrova and 306 like this" — actor-grained, type-mixed). |
| 7 | **Comments nest via `parent_id` (1 level deep visible)** | Schema supports unbounded depth; UI renders only top-level + one nested row to keep cards compact. Deeper replies fetchable but not rendered by default. |
| 8 | **Cursor pagination, opaque to frontend** | `cursor = base64(created_at \| id)` for `sort=recent`; score-based for `popular`. Offset paging is a footgun on feeds (hot inserts shift pages). |
| 9 | **`PUT` for reactions/favorites, not POST** | Idempotent toggles. Replaying the same request is safe, and clients can use the verb to communicate intent. |
| 10 | **`audience='friends'` requires Friendship to be live** | Until Friendship lands, the API accepts the value but treats it as `private` for visibility resolution. Documented contract, not silent fallback. |

---

## Entity relationships

```
public.users ─────1:N────► public.posts ────M:N───► public.media (via post_attachments)
                              │  │  │
                              │  │  └──1:N──► public.post_mentions ─►─ public.users
                              │  │
                              │  └────1:N────► public.reactions ──────► public.users
                              │  │
                              │  └────1:N────► public.comments ──┐
                              │                                  │ self-FK parent_id
                              │                                  └─ public.users (author)
                              │
                              └────M:N──── public.post_favorites ──── public.users
                                              (saves)

public.groups ────1:N────► public.posts (where audience='group')
```

---

## Schema

```sql
create type post_audience  as enum ('public','friends','private','group');
create type reaction_type  as enum ('like','heart','laugh','wow','sad','angry');

-- =========================================================================
-- posts
-- =========================================================================
create table public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.users(id) on delete cascade,

  audience    post_audience not null default 'public',
  group_id    uuid references public.groups(id) on delete cascade,

  body        text,                                    -- null when deleted
  body_length int generated always as (coalesce(length(body), 0)) stored,

  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint posts_body_required check (deleted_at is not null or body is not null),
  constraint posts_body_length  check (body is null or length(body) between 1 and 5000),
  constraint posts_group_consistency check (
    (audience = 'group') = (group_id is not null)
  )
);

create index posts_author_created_idx   on public.posts (author_id, created_at desc)
  where deleted_at is null;
create index posts_group_created_idx    on public.posts (group_id, created_at desc)
  where audience = 'group' and deleted_at is null;
create index posts_public_created_idx   on public.posts (created_at desc)
  where audience = 'public' and deleted_at is null;

-- =========================================================================
-- post_attachments — M:N to public.media (gallery rows)
-- =========================================================================
create table public.post_attachments (
  post_id       uuid not null references public.posts(id)  on delete cascade,
  media_id      uuid not null references public.media(id)  on delete cascade,
  display_order int  not null default 0,
  primary key (post_id, media_id)
);

create index post_attachments_media_idx on public.post_attachments (media_id);

-- =========================================================================
-- post_mentions — populated by backend from @username extraction
-- =========================================================================
create table public.post_mentions (
  post_id   uuid not null references public.posts(id) on delete cascade,
  user_id   uuid not null references public.users(id) on delete cascade,
  primary key (post_id, user_id)
);

create index post_mentions_user_idx on public.post_mentions (user_id, post_id);

-- =========================================================================
-- reactions — one per (post, user)
-- =========================================================================
create table public.reactions (
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  type        reaction_type not null,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index reactions_post_type_idx on public.reactions (post_id, type);
create index reactions_user_idx      on public.reactions (user_id, created_at desc);

-- =========================================================================
-- comments
-- =========================================================================
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id)    on delete cascade,
  parent_id   uuid references public.comments(id)          on delete cascade,
  author_id   uuid not null references public.users(id)    on delete cascade,

  body        text,
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint comments_body_required check (deleted_at is not null or body is not null),
  constraint comments_body_length   check (body is null or length(body) between 1 and 2000)
);

create index comments_post_created_idx on public.comments (post_id, created_at)
  where deleted_at is null;
create index comments_parent_idx       on public.comments (parent_id)
  where parent_id is not null;

-- =========================================================================
-- post_favorites — bookmarks (powers the Favorites lens)
-- =========================================================================
create table public.post_favorites (
  user_id     uuid not null references public.users(id) on delete cascade,
  post_id     uuid not null references public.posts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index post_favorites_user_idx on public.post_favorites (user_id, created_at desc);
```

Triggers: attach `touch_updated_at` (defined in the user doc) to `public.posts` and `public.comments`.

---

## RLS policies

Reads enforce audience; writes enforce ownership. The Friends-only branch is parked behind a comment until Friendship lands.

```sql
alter table public.posts             enable row level security;
alter table public.post_attachments  enable row level security;
alter table public.post_mentions     enable row level security;
alter table public.reactions         enable row level security;
alter table public.comments          enable row level security;
alter table public.post_favorites    enable row level security;

-- ============ posts ============

-- Author always reads own posts, including private and deleted.
create policy posts_select_author on public.posts
  for select using (author_id = auth.uid());

-- Visible to others by audience.
create policy posts_select_visible on public.posts
  for select using (
    deleted_at is null
    and (
      audience = 'public'
      or (audience = 'group'
          and exists (
            select 1 from public.group_members gm
            where gm.group_id = posts.group_id and gm.user_id = auth.uid()
          ))
      -- audience = 'friends' branch: enable once Friendship model lands.
      -- or (audience = 'friends'
      --     and exists (
      --       select 1 from public.friendships f
      --       where f.status = 'accepted'
      --         and ((f.user_a = posts.author_id and f.user_b = auth.uid())
      --           or (f.user_b = posts.author_id and f.user_a = auth.uid()))
      --     ))
    )
  );

create policy posts_write_self on public.posts
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());

-- ============ post_attachments / post_mentions ============
-- Visible iff the parent post is visible (rely on EXISTS, not duplicate policy).

create policy post_attachments_select on public.post_attachments
  for select using (
    exists (select 1 from public.posts p where p.id = post_id)  -- RLS on posts gates this
  );
create policy post_attachments_write_self on public.post_attachments
  for all using (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  ) with check (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

create policy post_mentions_select on public.post_mentions
  for select using (
    exists (select 1 from public.posts p where p.id = post_id)
  );
-- mentions are backend-written only; no client write policy.

-- ============ reactions ============

create policy reactions_select on public.reactions
  for select using (
    exists (select 1 from public.posts p where p.id = post_id)
  );

create policy reactions_write_self on public.reactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ comments ============

create policy comments_select on public.comments
  for select using (
    exists (select 1 from public.posts p where p.id = post_id)
    and deleted_at is null
  );
create policy comments_select_author on public.comments
  for select using (author_id = auth.uid());  -- author sees own deleted

create policy comments_write_self on public.comments
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());

-- ============ post_favorites ============

create policy post_favorites_select_self on public.post_favorites
  for select using (user_id = auth.uid());
create policy post_favorites_write_self on public.post_favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

`post_mentions` is backend-written only — even though no INSERT policy exists for clients, the backend uses the service role to populate it from extracted `@username` tokens.

---

## Backend endpoints

All require `@RequireVerified()`. Base URL inherits from the user doc (`/api/v1`).

### Activity feed

| Method | Path | Purpose |
|---|---|---|
| GET | `/users/:userId/activity` | The five-lens feed. Query: `lens` ∈ {`personal`,`mentions`,`favorites`,`friends`,`groups`} (default `personal`), `sort` ∈ {`recent`,`popular`,`relevant`} (default `recent`), `cursor` (opaque), `limit` (default 20, max 50). Visibility filtering applied per-post against the viewer. |

### Posts

| Method | Path | Purpose |
|---|---|---|
| POST | `/posts` | Body: `{ body, audience, groupId?, attachmentMediaIds[]? }`. Backend extracts mentions, validates audience↔group consistency, verifies each `attachmentMediaIds` is owned by the viewer and `status='ready'`. |
| GET | `/posts/:id` | Single post. Returns full `PostDto` including viewer-relative flags. |
| PATCH | `/posts/:id` | Body: `{ body?, audience? }`. Author only. Editing re-extracts mentions and sets `edited_at`. Group/attachments not editable post-creation in v1. |
| DELETE | `/posts/:id` | Soft delete. Author or (for group posts) group admin. Body → null, `deleted_at = now()`. |

### Reactions

| Method | Path | Purpose |
|---|---|---|
| PUT | `/posts/:id/reactions` | Body: `{ type }`. Upserts the viewer's reaction. Idempotent. |
| DELETE | `/posts/:id/reactions` | Removes the viewer's reaction. |

### Comments

| Method | Path | Purpose |
|---|---|---|
| GET | `/posts/:id/comments` | Top-level comments, with `replyCount` per row and first 3 replies inlined. Query: `cursor`, `limit`. |
| GET | `/comments/:id/replies` | Lazy-load replies under a top-level comment. |
| POST | `/posts/:id/comments` | Body: `{ body, parentId? }`. |
| PATCH | `/comments/:id` | Body: `{ body }`. Author only. |
| DELETE | `/comments/:id` | Soft delete. Author or post author or (for group posts) group admin. |

### Favorites

| Method | Path | Purpose |
|---|---|---|
| GET | `/users/me/favorites` | Same as `/users/:userId/activity?lens=favorites` for the viewer; convenience alias. |
| PUT | `/posts/:id/favorite` | Adds. Idempotent. |
| DELETE | `/posts/:id/favorite` | Removes. |

### Attachments

No dedicated endpoints — reuse Media:
1. Client calls `POST /media/upload-url` (type `photo` or `video`).
2. Client `PUT`s file to Storage signed URL.
3. Client calls `POST /media/:id/confirm`.
4. Client includes the resulting `mediaId` in `POST /posts { attachmentMediaIds: [...] }`.

Backend rejects post creation if any `attachmentMediaIds` aren't owned by the viewer or aren't `status='ready'`.

---

## DTO shapes

```ts
type PostAudience = 'public' | 'friends' | 'private' | 'group';
type ReactionType = 'like' | 'heart' | 'laugh' | 'wow' | 'sad' | 'angry';
type ActivityLens = 'personal' | 'mentions' | 'favorites' | 'friends' | 'groups';
type ActivitySort = 'recent' | 'popular' | 'relevant';

type PostAuthorDto = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

type PostAttachmentDto = {
  mediaId: string;
  kind: 'photo' | 'video';
  url: string;             // public/signed depending on visibility
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  displayOrder: number;
};

type ReactionSummaryDto = {
  total: number;
  byType: Partial<Record<ReactionType, number>>;
  topActors: PostAuthorDto[];   // up to 2, for "Julia, Petrova and N like this"
  viewerReaction: ReactionType | null;
};

type PostDto = {
  id: string;
  author: PostAuthorDto;
  audience: PostAudience;
  group: { id: string; slug: string; name: string } | null;
  body: string | null;                       // null when deleted
  attachments: PostAttachmentDto[];
  mentions: { userId: string; username: string }[];
  reactionSummary: ReactionSummaryDto;
  commentCount: number;
  viewerFavorited: boolean;
  isDeleted: boolean;
  editedAt: string | null;
  createdAt: string;
};

type ActivityFeedResponse = {
  items: PostDto[];
  nextCursor: string | null;
};

type CreatePostRequest = {
  body: string;
  audience: PostAudience;
  groupId?: string;                  // required iff audience='group'
  attachmentMediaIds?: string[];     // viewer-owned, status='ready' media rows
};

type CommentDto = {
  id: string;
  postId: string;
  parentId: string | null;
  author: PostAuthorDto;
  body: string | null;
  replyCount: number;
  isDeleted: boolean;
  editedAt: string | null;
  createdAt: string;
};
```

---

## Visibility resolution

Per post, the viewer's effective access is computed in this order. First match wins; otherwise the post is hidden (404 on direct fetch, omitted from feed results).

1. Viewer is the author → visible (incl. deleted, for `/users/me/activity`).
2. Post is soft-deleted → hidden (404).
3. `audience='public'` → visible.
4. `audience='group'` → visible iff viewer ∈ `group_members(group_id)`.
5. `audience='friends'` → visible iff `friendships(author_id, viewer_id, 'accepted')`. Until Friendship is live, this branch returns hidden for everyone except the author.
6. `audience='private'` → hidden.

A blocked viewer (per the Block model, when added) never sees the author's posts regardless of audience. Suspended/banned/deleted authors' posts are hidden from non-owners; the owner still sees them (for restore-on-reactivation).

---

## Algorithms / logic owned by backend

- **Mention extraction.** Tokenize `body` with `/@([a-zA-Z0-9_-]{3,24})/g`. Lookup against `public.users.username` (case-insensitive via `citext`). Insert resolved rows into `post_mentions` (skip self-mentions). Run on create AND on edit (diff: delete removed, insert added).
- **Audience validation.** Reject `POST /posts` with `audience='group'` if `groupId` is missing or viewer isn't a member; reject non-group audiences if `groupId` is present.
- **Reaction summary.** Compute per-read from `reactions` grouped by `type`. For `topActors` pick the two most recent unique reactors (cheap index). Materialize as a counter table only if reads dominate and rollup queries hit p95 ceilings.
- **Comment count.** `select count(*) from comments where post_id = ? and deleted_at is null`. Cache in Redis with short TTL if necessary; otherwise compute per page.
- **Popular sort.** `score = (reactions_total + 2*comments_total) * recency_decay(created_at)` over a 7-day window. Tune coefficients after launch; keep it deterministic so cursors remain stable mid-page.
- **Cursor format.**
  - `recent` / `mentions` / `favorites` / `groups`: `base64(created_at|id)`, decode for `WHERE (created_at, id) < (cursor)`.
  - `popular`: `base64(score|id)` plus a tie-breaker on `id` desc.
- **Soft-delete projection.** When a post is soft-deleted, the row stays so reactions/comments/favorites/mentions keep their FKs valid. `body` is set to NULL; DTO returns `body: null, isDeleted: true`. The 30-day retention cron hard-deletes rows whose `deleted_at < now() - 30 days`; FK cascades clean up.
- **Group-post cascade.** Group hard-delete cascades to posts; group soft-delete (suspended/deleted) hides posts via the visibility chain — no schema change needed.
- **Friends lens query.** When Friendship is live: `author_id IN (SELECT counterpart FROM friendships WHERE viewer_id IN (user_a,user_b) AND status='accepted')` + visibility filter.
- **Mentions notifications.** When `post_mentions` inserts a row, enqueue a Notification (separate model). Out of scope here but the trigger point lives in this slice.

---

## Implementation plan

### Phase 1 — Database
1. Migration: enums, tables, FKs, indexes, check constraints.
2. Attach `touch_updated_at` triggers to `posts` and `comments`.
3. RLS policies (with the `audience='friends'` branch commented and TODO'd).
4. Verify: RLS lets author read own private posts, hides them from others; group post visible only to members; soft-deleted posts hidden from non-author reads.

### Phase 2 — Posts CRUD (Personal lens only)
5. `PostsController` + `PostsService` + `PostsRepository`.
6. `POST /posts` (no attachments yet) — mention extraction, audience validation.
7. `GET /posts/:id`, `PATCH /posts/:id`, `DELETE /posts/:id`.
8. `GET /users/:userId/activity?lens=personal` — cursor pagination.

### Phase 3 — Reactions, comments, favorites
9. `reactions` upsert + delete endpoints; `reactionSummary` computed in `PostDto`.
10. Comments CRUD; nested reads via `replyCount` and `/comments/:id/replies`.
11. Favorites endpoints + `/users/me/favorites`.
12. Wire `commentCount`, `viewerReaction`, `viewerFavorited` into `PostDto`.

### Phase 4 — Mention, Groups, Friends lenses
13. `lens=mentions` query.
14. `lens=groups` query (join through `group_members`).
15. `lens=friends` query — gated on Friendship slice; emits empty list until live.

### Phase 5 — Composer wiring
16. Frontend Media upload flow → returned `mediaId` passed to `POST /posts`.
17. Backend validates ownership + `status='ready'` on each attachment.
18. `post_attachments` rows inserted in the same transaction as the post.

### Phase 6 — Popular sort + retention
19. `sort=popular` scoring + cursor variant.
20. Retention cron: hard-delete posts/comments with `deleted_at < now() - 30 days`.

### Phase 7 — Tests
21. **e2e**: create post → react → comment → favorite → feed lens round-trip per pill.
22. **Visibility**: audience matrix (author/friend/stranger/group-member × public/friends/private/group).
23. **Mentions**: insert, edit (add/remove), self-mention skip, unknown username skip.
24. **Reactions**: change type idempotent, count rollup accurate, top-actors correct.
25. **Comments**: nested fetch, soft-delete preserves count, author-edit OK / stranger-edit rejected.
26. **Soft-delete + retention**: deleted post returns 404 to non-author, retained for 30 days, then purged.
27. **Cursor stability**: page through 100 posts, no duplicates, no skips, hot insert mid-page handled.

---

## Open items

- **"Relevant" sort.** Currently a placeholder in the UI. Define before exposing: viewer-affinity, engagement velocity, or hide the option entirely?
- **Composer location.** The template renders the composer inside the *Mentions* sub-tab — almost certainly a template artifact. Frontend should move it to *Personal* (and only on `members/me`).
- **Edit window.** Allow indefinite edits, or freeze edits after N hours / once the post has reactions/comments? Affects user-trust and history-of-record.
- **Edit history.** Currently we only store the current body + `edited_at`. If history matters (moderation, transparency), add a `post_revisions` table.
- **Rate-limiting.** Posts/comments per hour by free tier? Plan-based caps live in the Subscription doc; surface here once defined.
- **Reaction custom types.** Six fixed types match the UI icons. If we add custom emoji reactions later, switch `type` to text + whitelist server-side.
- **Block model integration.** Listed as a cross-cutting model. Add a `posts_select_blocked` policy clause when it lands.
- **Notification fan-out.** Mention → notify; reaction → notify; comment → notify post author and parent-comment author. Spec lives with the Notification model.
- **Realtime updates.** Live reaction counts and new-comment toasts — Supabase Realtime on `reactions`/`comments` tables, or polling? Defer until v1 is shipped.
