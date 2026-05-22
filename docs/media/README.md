# Media Model

User-uploaded photos, videos, and music, organized into optional albums. Backs `profile.html` Photos + Media tabs.

**Scope:** gallery content only. Avatar + cover images stay as simple URL columns on `public.profiles` (see [user doc](../user/README.md)) — they're identity, not gallery, and don't need the two-phase upload + album machinery.

---

## Decisions

| # | Decision | Note |
|---|---|---|
| 1 | **Unified `media` table, type discriminator** | Photos, videos, music share the same shape (owner, path, size, visibility, timestamps). One table + `type` enum keeps reads and RLS simple. Type-specific fields (dimensions, duration) are nullable on the shared row. |
| 2 | **Albums optional** | `album_id` nullable on media. "Unfiled" items appear in the All Photos grid. Cover image on album is an FK to a media row. |
| 3 | **Two-phase upload** | `POST /media/upload-url` → client PUTs to Supabase Storage → `POST /media/:id/confirm` finalizes. Avoids "phantom" DB rows from failed uploads. |
| 4 | **Supabase Storage** | Buckets: `media-public` (CDN-cached public read) and `media-private` (signed URLs). Path: `{user_id}/{media_id}.{ext}`. |
| 5 | **Per-item visibility overrides profile visibility, but only more-restrictive** | `visibility` nullable on media = inherit from profile. Explicit value can narrow (public → friends_only) but not widen. Backend enforces. |
| 6 | **Photos ship first; video + music phase 2** | Template shows 0 videos / 0 music. Type enum is ready, but thumbnailing/transcoding pipelines for video are heavier — defer. |
| 7 | **Hard delete, no soft delete** | Users expect media deletion to mean gone. Consider a short "undo" (10 min) via an in-memory trash if requested, but don't add a retention cron. |
| 8 | **Avatar + cover stay on `profiles`** | `avatar_url` / `cover_url` are URL columns, not media rows. Separate `/profiles/me/avatar` endpoint. Rationale: they're singletons, replace-not-append, and don't belong in a gallery listing. |

---

## Entity relationships

```
public.users ────1:N────► public.albums
       │                       │
       │ 1:N                   │ 1:N (album_id nullable)
       ▼                       ▼
public.media ◄─────── public.albums.cover_media_id (1:1)
       │
       └── storage_path ──► Supabase Storage
```

---

## Schema

```sql
create type media_type as enum ('photo','video','music');
create type media_visibility as enum ('public','members_only','friends_only','private');
create type media_status as enum ('pending','ready','failed');

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  cover_media_id uuid,  -- FK added after public.media exists
  visibility media_visibility not null default 'public',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index albums_user_idx     on public.albums (user_id);
create index albums_user_pos_idx on public.albums (user_id, position);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  album_id uuid references public.albums(id) on delete set null,

  type media_type not null,
  status media_status not null default 'pending',
  visibility media_visibility,  -- null = inherit from profile

  storage_path text not null,   -- {user_id}/{uuid}.{ext}
  thumbnail_path text,

  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width int,
  height int,
  duration_seconds int,         -- video/music only

  position int not null default 0,  -- within album, user-controlled order
  caption text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint media_dimensions_photo check (
    type <> 'photo' or (width is not null and height is not null)
  ),
  constraint media_duration_av check (
    type = 'photo' or duration_seconds is not null
  )
);

alter table public.albums
  add constraint albums_cover_fk foreign key (cover_media_id)
    references public.media(id) on delete set null;

create index media_user_idx         on public.media (user_id);
create index media_album_idx        on public.media (album_id);
create index media_user_type_idx    on public.media (user_id, type, created_at desc);
create index media_status_idx       on public.media (status) where status <> 'ready';
```

Triggers: reuse `touch_updated_at` from the user doc on both tables.

---

## RLS policies

```sql
alter table public.media  enable row level security;
alter table public.albums enable row level security;

-- ============ public.media ============

-- Owner always reads own media (even pending/failed).
create policy media_select_owner on public.media
  for select using (user_id = auth.uid());

-- Others read only ready + public/members_only media owned by active users.
-- friends_only stays blocked here; Friendship-aware policy added when that
-- model lands.
create policy media_select_visible on public.media
  for select using (
    status = 'ready'
    and coalesce(visibility, 'public') in ('public','members_only')
    and exists (
      select 1 from public.users u
      where u.id = media.user_id and u.account_status = 'active'
    )
  );

-- Owner has full write on own media.
create policy media_write_self on public.media
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ public.albums ============

create policy albums_select on public.albums
  for select using (
    user_id = auth.uid()
    or (
      visibility in ('public','members_only')
      and exists (
        select 1 from public.users u
        where u.id = albums.user_id and u.account_status = 'active'
      )
    )
  );

create policy albums_write_self on public.albums
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

`status`, `storage_path`, `thumbnail_path`, `width`, `height`, `duration_seconds`, `mime_type`, `size_bytes` are **backend-written only** — even though RLS allows self-write, DTO whitelists block user edits of these fields. Only the backend (service role after Storage callback) fills them in.

---

## Backend endpoints

All require `@RequireVerified()` unless noted.

### Media

| Method | Path | Purpose |
|---|---|---|
| POST | `/media/upload-url` | Body: `{ type, mime, size, album_id? }`. Creates `pending` media row, returns `{ media_id, upload_url, storage_path, expires_at }`. Plan limits enforced here. |
| POST | `/media/:id/confirm` | Called after client PUTs file. Backend verifies object exists + matches size/mime, probes dimensions/duration, kicks off thumbnail job, flips `status = 'ready'`. |
| GET | `/media/me` | Own media. Query: `type`, `album_id`, `cursor`, `limit`. |
| GET | `/media/user/:user_id` | Another user's media — visibility + block + `account_status` enforced. |
| PATCH | `/media/:id` | Caption, visibility, album assignment. |
| POST | `/media/:id/reorder` | `{ position }` within album. |
| DELETE | `/media/:id` | Delete Storage object + row. |

### Albums

| Method | Path | Purpose |
|---|---|---|
| GET | `/albums/me`, `/albums/user/:user_id` | List (with first-N media preview + total count). |
| POST | `/albums` | `{ name, description?, visibility? }`. |
| PATCH | `/albums/:id` | Rename, visibility, cover (cover_media_id must belong to same user), position. |
| DELETE | `/albums/:id` | Query `?cascade=true` removes media too; default leaves them unfiled (`album_id = null`). |

---

## Algorithms / logic owned by backend

- **Two-phase upload.** `/upload-url` creates `status='pending'` row and a Supabase Storage signed upload URL (short TTL, size-capped pre-signed policy). Client PUTs. `/confirm` validates the object, probes it, generates thumbnails, flips `ready`. Unconfirmed rows are swept by an orphan cron.
- **Mime / size validation.** DTO plus Storage pre-signed policy. Allowed: `image/jpeg|png|webp|gif`, `video/mp4|webm`, `audio/mpeg|mp4|ogg`. Caps per type: photo ≤ 10 MB, video ≤ 200 MB, audio ≤ 50 MB (tune).
- **Thumbnail generation.**
  - Photos: Supabase Edge Function with `sharp` → 256/512/1024 webp.
  - Videos (phase 2): ffmpeg cover frame at 1s + poster image.
  - Store under `{user_id}/{media_id}-thumb-{size}.webp`; populate `thumbnail_path`.
- **Plan-based upload limits.** At `/upload-url`: count current `type='photo'` rows for user, reject if over plan cap. Pulled from active `UserSubscription` (Basic 10, Silver 100, Gold ∞ — tune in SubscriptionPlan doc).
- **Visibility resolution.** When serving `/media/user/:id`, resolve effective visibility = `coalesce(media.visibility, profile.visibility, 'public')`. RLS enforces the broad case; backend enforces narrower `friends_only` once Friendship lands.
- **Cascade cleanup.** Postgres FK cascades drop media rows when a user is hard-deleted, but **Storage objects are not touched by FK**. A daily reconciliation cron lists Storage `media-*/{user_id}/*` and removes objects with no matching row.
- **Orphan sweep.** Hourly cron: media rows with `status='pending'` older than the upload-URL TTL (e.g. 1h) → delete row and any uploaded object.
- **Album cover integrity.** If a cover media is deleted, `cover_media_id` sets to null via FK. Backend picks a new cover lazily on next read (first media by position).
- **NSFW moderation** (optional, later) — async worker flags ready media; backend hides and queues for moderator review.

---

## Implementation plan

### Phase 1 — Supabase foundation
1. Create `media-public` + `media-private` Storage buckets; set CORS + pre-signed upload policies.
2. Migration: enum types, `albums`, `media`, FKs, indexes, check constraints.
3. Attach `touch_updated_at` triggers.
4. RLS policies; verify (owner reads pending, others don't; visibility enforced; cross-user writes rejected).

### Phase 2 — NestJS MediaModule (photos only)
5. `MediaController` + `MediaService` + `MediaRepository` + `StorageService` (wraps Supabase Storage admin).
6. `POST /media/upload-url` — plan-limit check + pre-signed URL issuance.
7. `POST /media/:id/confirm` — probe object (mime, size, dimensions via `sharp`), flip status, enqueue thumbnail job.
8. Thumbnail worker (Supabase Edge Function or internal queue consumer).
9. `GET /media/me`, `/media/user/:id` with visibility/block enforcement.
10. `PATCH`, `DELETE`, `POST /reorder`.

### Phase 3 — AlbumsModule
11. CRUD endpoints.
12. Cascade behavior on delete (flag-driven).
13. Cover integrity.

### Phase 4 — Frontend wiring
14. `profile.html` Photos tab → `GET /media/user/:id?type=photo` grid + "load more".
15. `profile.html` Media tab → Albums sub-tab (`/albums/user/:id`), Photos (same as tab above), Videos/Music placeholders.
16. Upload UX: drag-drop → `POST /upload-url` → `PUT` to Storage with progress → `POST /confirm` → refresh grid.
17. Album CRUD modals.
18. Delete confirmation + reorder (drag).

### Phase 5 — Tests
19. **e2e**: upload round-trip (request URL → PUT → confirm → GET), quota enforcement, visibility rules, cross-user delete rejected.
20. **DB**: RLS (owner sees pending, others only ready+visible, deleted user's media invisible), FK cascade on user delete.
21. Orphan sweep: create pending row older than TTL, run cron, row gone.
22. Thumbnail worker: photo produces three sizes.
23. Plan limit: exceed cap → 403.

### Phase 6 — Video + music (deferred)
24. Add ffmpeg thumbnail pipeline.
25. Adjust upload caps + validators.
26. UI for video/music tabs.

---

## Open items

- **Undo-delete window?** 10-minute in-memory trash before permanent delete?
- **NSFW moderation provider** — CloudFlare Images, AWS Rekognition, Sightengine, or defer?
- **`friends_only` visibility** — parked until Friendship model lands.
- **Thumbnail infra** — Supabase Edge Function (simpler) vs. dedicated worker (more control)?
- **Video hosting** — Supabase Storage is fine for small files, but streaming at scale wants Mux / Cloudflare Stream. Decide before turning on video.
- **Public-bucket caching** — set long `cache-control` with content-hash URLs, or short TTL + backend-rewritten URLs?
