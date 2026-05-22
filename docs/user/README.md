# User + Profile Model

Documented together because they share a lifecycle: created together on signup, updated together during onboarding, cascaded together on delete. Separating them in docs creates duplication and invites drift.

**Scope:** account identity, auth, presence, role/status, deletion lifecycle, dating profile content, onboarding flow, profile search.

---

## Decisions

| # | Decision | Note |
|---|---|---|
| 1 | **Username (account) + display name (profile)** | `username` on `public.users` — login handle, `citext` unique, `^[a-zA-Z0-9_-]{3,24}$`. `display_name` on `public.profiles` — what UI shows on cards, headers, DMs. Defaults to `username` at signup, freely editable. Keeps mentions and URLs stable when users rename visually. |
| 2 | **Email verification required** | Any write beyond account bootstrap requires `auth.users.email_confirmed_at IS NOT NULL`. Enforced by NestJS `EmailVerifiedGuard`. Unverified users may log in and resend verification; they cannot edit profile, message, upload media, join groups, post, or like. |
| 3 | **Hybrid RLS** | User-JWT pass-through (RLS active) for reads and self-scoped writes. Service-role (RLS bypassed, backend enforces) for: admin actions, cross-user mutations, presence heartbeat, audit log, retention cron, signup rate-limiting. |
| 4 | **60-day soft delete, then hard delete** | Flip `account_status = 'deleted'`, `deleted_at = now()`. Login disabled during grace. Restore via signed email link. Daily 03:00 UTC cron hard-deletes `auth.users` rows past 60 days; FK cascades clean everything else. |
| 5 | **Case-insensitive username via `citext`** | *(defaulted)* All equality and unique comparisons just work; no `lower()` index needed. |
| 6 | **18+ enforced at DB + DTO** | Dating site — age check is non-negotiable. DB `check` constraint on `dob`, DTO validator, UX blocks onboarding completion. |
| 7 | **Single trigger creates both rows** | One `handle_new_user` trigger on `auth.users` creates the matching `public.users` **and** an empty `public.profiles` row in the same transaction. Simpler than a trigger chain. |

---

## Responsibility split

| Concern | Owner |
|---|---|
| Email / password / JWT / sessions / email verification | Supabase Auth (`auth.users`) |
| Account data: username, role, status, presence, onboarding, deletion | `public.users` |
| Dating content: display name, attributes, bio, location, avatar, cover, visibility | `public.profiles` |
| Business logic: signup, verify-gate, presence, onboarding completion, profile search, soft-delete, retention, admin, audit | NestJS backend |
| Avatar / cover file storage | Supabase Storage (bucket: `avatars`, `covers`) |

---

## Entity relationships

```
auth.users (Supabase)
    │ 1:1 (FK cascade delete)
    ▼
public.users ───────1:1───────► public.profiles
    │                               │
    │                               ├─ avatar_url → Supabase Storage
    │                               └─ cover_url  → Supabase Storage
    │
    └─ referenced by every app table (posts, messages, friendships, …)
```

---

## Schema

### `auth.users` — Supabase-managed (do not alter)
- `id` uuid (PK) — FK target for every app table
- `email`, `encrypted_password`, `email_confirmed_at`, `last_sign_in_at`
- `raw_user_meta_data` — carries `username` at signup

### `public.users`

```sql
create extension if not exists citext;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique not null,
  role text not null default 'user'
    check (role in ('user','moderator','admin')),
  account_status text not null default 'active'
    check (account_status in ('active','suspended','banned','deleted')),
  is_online boolean not null default false,
  last_active_at timestamptz,
  onboarding_completed boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint users_deleted_at_consistency check (
    (account_status = 'deleted') = (deleted_at is not null)
  )
);

create index users_username_idx       on public.users (username);
create index users_last_active_idx    on public.users (last_active_at desc);
create index users_account_status_idx on public.users (account_status);
create index users_deleted_at_idx     on public.users (deleted_at)
  where account_status = 'deleted';
```

### `public.profiles`

Fields map directly to `profile.html` Profile tab sections and `members.html` filters. Array columns (`text[]`) keep things simple for MVP; split to lookup tables later if needed.

```sql
create extension if not exists pg_trgm;  -- for display_name search

create table public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,

  -- Base info
  display_name text not null,
  gender text check (gender in
    ('male','female','non_binary','other','prefer_not_to_say')),
  seeking text[] default '{}',            -- can seek multiple genders
  dob date,
  marital_status text check (marital_status in
    ('single','married','divorced','widowed','separated','other')),
  relationship_type text check (relationship_type in
    ('serious','casual','friendship','affair','marriage','open')),

  -- Location
  country text,
  city text,
  address text,

  -- Narrative
  bio text,
  looking_for text,
  likes text,

  -- Lifestyle
  interests text[] default '{}',
  favorite_places text[] default '{}',
  languages text[] default '{}',
  religion text,
  children text check (children in
    ('none','have','want','dont_want','maybe')),
  smoking text check (smoking in
    ('never','casual','regular','trying_to_quit')),
  drinking text check (drinking in
    ('never','socially','regularly')),

  -- Physical
  height_cm int check (height_cm between 100 and 250),
  weight_kg int check (weight_kg between 30 and 300),
  hair_color text,
  eye_color text,
  body_type text,
  ethnicity text,

  -- Profession (used by index.html sidebar filter)
  profession text,

  -- Media
  avatar_url text,
  cover_url text,

  -- Visibility + meta
  visibility text not null default 'public'
    check (visibility in ('public','members_only','private')),
  completion_score int not null default 0
    check (completion_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_age_18_plus check (
    dob is null or dob <= current_date - interval '18 years'
  )
);

-- Search / filter indexes (back members.html and profile directory)
create index profiles_gender_idx          on public.profiles (gender);
create index profiles_seeking_gin         on public.profiles using gin (seeking);
create index profiles_interests_gin       on public.profiles using gin (interests);
create index profiles_languages_gin       on public.profiles using gin (languages);
create index profiles_country_idx         on public.profiles (country);
create index profiles_profession_idx      on public.profiles (profession);
create index profiles_dob_idx             on public.profiles (dob);
create index profiles_display_name_trgm   on public.profiles using gin (display_name gin_trgm_ops);
create index profiles_completion_idx      on public.profiles (completion_score desc);
```

---

## Triggers

### Single trigger: create `users` + `profiles` on signup

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer as $$
declare
  v_username text;
begin
  v_username := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  );
  insert into public.users (id, username) values (new.id, v_username);
  insert into public.profiles (user_id, display_name) values (new.id, v_username);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### `updated_at` touch — apply to both tables

```sql
create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
```

### Sync `deleted_at` when status changes

```sql
create function public.sync_deleted_at()
returns trigger language plpgsql as $$
begin
  if new.account_status = 'deleted' and old.account_status <> 'deleted' then
    new.deleted_at = now();
  elsif new.account_status <> 'deleted' and old.account_status = 'deleted' then
    new.deleted_at = null;
  end if;
  return new;
end;
$$;

create trigger users_sync_deleted_at
  before update of account_status on public.users
  for each row execute function public.sync_deleted_at();
```

---

## RLS policies

```sql
-- ============ public.users ============
alter table public.users enable row level security;

create policy users_select_active on public.users
  for select using (account_status = 'active');

create policy users_select_self on public.users
  for select using (auth.uid() = id);

create policy users_update_self on public.users
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- ============ public.profiles ============
alter table public.profiles enable row level security;

-- Readable if owner is active AND (public OR owner is the viewer)
create policy profiles_select on public.profiles
  for select using (
    user_id = auth.uid()
    or (
      visibility in ('public','members_only')
      and exists (
        select 1 from public.users u
        where u.id = profiles.user_id
          and u.account_status = 'active'
      )
    )
  );

create policy profiles_update_self on public.profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

**Hybrid routing:**

| Endpoint | Client | RLS? |
|---|---|---|
| `GET /users/me`, `GET /users/:id`, `GET /profiles/:id` | user JWT | yes |
| `PATCH /users/me`, `PATCH /profiles/me` | user JWT | yes |
| `GET /profiles/search` | user JWT | yes |
| `POST /users/me/presence` | service role | no |
| `POST /profiles/me/avatar`, `/cover` | service role (signed upload) | no |
| `DELETE /users/me`, `POST /users/me/restore` | service role | no |
| `/admin/*` | service role | no |
| Retention cron | service role | no |

Role, `account_status`, `deleted_at`, and `completion_score` are **backend-only** columns — even though RLS allows self-update, DTO whitelists block them from user writes.

---

## Onboarding lifecycle

```
signup (email + password + username)
   │  trigger: creates public.users + empty public.profiles
   ▼
email verification (click link)
   │  auth.users.email_confirmed_at populated
   ▼
onboarding wizard — fill required profile fields
   │  PATCH /profiles/me (multi-step)
   ▼
onboarding_completed flipped true when required fields satisfied
   │  backend validates, not client
   ▼
full member — can browse, message, post, upload
```

**Required fields for `onboarding_completed = true`:** `display_name`, `gender`, `seeking`, `dob` (18+), `country`, `avatar_url`, `bio` (≥ 20 chars). Tune later.

---

## Backend endpoints

### Auth

| Method | Path | Purpose | Verified? |
|---|---|---|---|
| POST | `/auth/signup` | `supabase.auth.signUp` with validated username. | n/a |
| POST | `/auth/login` | `signInWithPassword`; refuse `deleted` with `ACCOUNT_DELETED`. | n/a |
| POST | `/auth/logout` | Revoke session. | any |
| POST | `/auth/refresh` | Rotate access token. | any |
| POST | `/auth/resend-verification` | Trigger new confirmation email (throttled). | unverified |

### Users

| Method | Path | Purpose | Verified? |
|---|---|---|---|
| GET | `/users/me` | Full own account row. | any |
| PATCH | `/users/me` | `username`, `onboarding_completed` (backend decides the latter). | ✅ |
| GET | `/users/:id` | Public view (hides email, role, status). | ✅ |
| POST | `/users/me/presence` | Heartbeat → `is_online`, `last_active_at`. | ✅ |
| DELETE | `/users/me` | Soft delete + revoke sessions + email restore link. | ✅ |
| POST | `/users/me/restore` | Consume restore token → flip back to `active`. | n/a (token) |

### Profiles

| Method | Path | Purpose | Verified? |
|---|---|---|---|
| GET | `/profiles/me` | Own full profile. | any |
| PATCH | `/profiles/me` | Update any mutable profile field(s). | ✅ |
| GET | `/profiles/:user_id` | View another profile (visibility + block + status). | ✅ |
| POST | `/profiles/me/avatar` | Upload avatar to Supabase Storage; set `avatar_url`. | ✅ |
| POST | `/profiles/me/cover` | Upload cover image. | ✅ |
| GET | `/profiles/search` | Directory for `members.html`. Query: `gender`, `seeking[]`, `country`, `age_min`, `age_max`, `profession`, `interests[]`, `q` (display-name trigram), `sort` (newest/oldest/popular/most_active), `page`, `per_page`. | ✅ |
| POST | `/profiles/me/complete` | Re-evaluate `completion_score` + flip `onboarding_completed` when thresholds met. | ✅ |

### Admin (service role + `@Roles('admin')`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/users/:id/suspend` / `/ban` / `/role` | Status + role mutations. |
| GET | `/admin/users` | Paginated list with filters. |
| GET | `/admin/profiles/flagged` | Moderation queue. |

All admin writes → `audit_log`.

---

## Algorithms / logic owned by backend

- **Email verification gate** — `EmailVerifiedGuard` on every `@RequireVerified()` route; 403 with code `EMAIL_UNVERIFIED` if `email_confirmed_at` is null.
- **Presence** — heartbeat every 30–60s; `@nestjs/schedule` cron runs every minute flipping `is_online = false` after 2 min silence.
- **Username validation** — regex, reserved-word list, profanity filter, citext uniqueness.
- **Display-name validation** — looser than username (allows spaces, unicode, 1–40 chars), profanity filter, no URLs.
- **Age guard** — `dob <= today - 18y` checked in DTO **and** DB constraint; UI shouldn't ever send an under-18 through, but defense-in-depth.
- **Completion score** — weighted sum of filled fields; `POST /profiles/me/complete` recomputes and, if ≥ threshold with required fields set, flips `onboarding_completed = true`.
- **Profile search** — builds parameterised SQL:
  - `gender = :gender`, `country = :country`, `profession = :profession`
  - `seeking && :seeking` and `interests && :interests` (GIN-indexed overlap)
  - `dob between :min_dob and :max_dob` (derive from age range)
  - `display_name ILIKE` or trigram `%` operator for `q`
  - Sort: `newest` → `users.created_at desc`, `most_active` → `users.last_active_at desc`, `popular` → `friend_count desc` (materialized or sub-query)
- **Visibility enforcement** — `GET /profiles/:user_id` respects visibility + block list + `account_status`.
- **Block enforcement** — `GET /users/:id` and `GET /profiles/:id` 404 if viewer is blocked (symmetric; see Block model).
- **Avatar / cover upload** — backend issues a Supabase Storage signed upload URL, client PUTs file, then calls `PATCH /profiles/me` to persist the public URL. Size + mime validated server-side via a pre-signed policy.
- **Soft delete** — `DELETE /users/me` → flip status (trigger stamps `deleted_at`), `supabase.auth.admin.signOut(id)` to kill sessions, email signed restore link (60-day TTL).
- **Login guard** — `deleted` users refused with restore-email hint.
- **Retention cron** — daily at 03:00 UTC: `supabase.auth.admin.deleteUser(id)` for each row with `deleted_at < now() - 60d`. FK cascades handle the rest.
- **Audit log** — every admin action, every soft-delete/restore, every role change.

---

## Implementation plan

### Phase 1 — Supabase foundation
1. Create Supabase project; enable email auth; configure verification + restore email templates; create Storage buckets `avatars` + `covers`.
2. Migration: `citext` + `pg_trgm` extensions, `public.users`, `public.profiles`, all indexes, check constraints.
3. Triggers: `handle_new_user` (creates both rows), `touch_updated_at` (both tables), `sync_deleted_at`.
4. RLS policies on `users` + `profiles`; verify via dashboard (anon reads active, cannot read deleted/private, self-update works, cross-user update blocked).

### Phase 2 — NestJS scaffold
5. `nest new backend`; install `@nestjs/config`, `@nestjs/passport`, `passport-jwt`, `@nestjs/schedule`, `@nestjs/throttler`, `@supabase/supabase-js`, `class-validator`, `class-transformer`.
6. `SupabaseModule` — provides `SupabaseAdminClient` (service role) + request-scoped `SupabaseUserClient` (caller JWT).
7. `AuthModule`: `JwtStrategy` verifies Supabase JWTs against JWKS; attaches `{ id, email, email_confirmed_at, role }` to `request.user`.
8. Guards: `JwtAuthGuard` (global), `RolesGuard` + `@Roles(...)`, **`EmailVerifiedGuard`** + `@RequireVerified()`.
9. Global `ValidationPipe` (whitelist + transform), uniform error filter, request-id + logging interceptor, `ThrottlerModule`.

### Phase 3 — Auth module
10. `POST /auth/signup` → validate username, uniqueness pre-check, `signUp` with `username` in `raw_user_meta_data`.
11. `POST /auth/login` → reject `deleted`, succeed otherwise.
12. `/auth/logout`, `/auth/refresh`, `/auth/resend-verification` (throttled).

### Phase 4 — Users module
13. `UsersController` + `UsersService`: `/users/me` (GET/PATCH), `/users/:id`, `/users/me/presence`.
14. Presence cron (every minute) flipping stale users offline.

### Phase 5 — Profiles module
15. `ProfilesController` + `ProfilesService` + `ProfilesRepository`.
16. `/profiles/me` (GET/PATCH), `/profiles/:user_id` with visibility + block enforcement.
17. `/profiles/me/avatar`, `/cover` — signed Storage upload flow.
18. `/profiles/search` — parameterised query builder; pagination via cursor or `limit/offset`.
19. `/profiles/me/complete` — completion score + onboarding flip.

### Phase 6 — Deletion + restoration
20. `DELETE /users/me`: flip status, revoke sessions, email signed restore token.
21. `POST /users/me/restore`: verify token, flip back to active.
22. Retention cron (`@Cron('0 3 * * *')`): hard-delete past 60-day grace.

### Phase 7 — Admin module
23. `AdminUsersController` with `RolesGuard` + `@Roles('admin')`: suspend, ban, set role, list.
24. Moderation queue for flagged profiles.
25. Every write → `audit_log`.

### Phase 8 — Frontend wiring
26. `signup.html` → `/auth/signup` (fields at `signup.html:155–164`).
27. `login.html` → `/auth/login`; surface `ACCOUNT_DELETED` + verification errors.
28. Verification banner + resend control when `email_confirmed_at` is null.
29. Onboarding wizard (multi-step, hitting `PATCH /profiles/me`, finishing with `/profiles/me/complete`).
30. `profile.html` Profile tab ← `GET /profiles/me` or `/profiles/:id`; edit forms → `PATCH /profiles/me`.
31. `members.html` ← `GET /profiles/search` with all filters + sort.
32. Presence heartbeat; auth guard on authenticated pages.
33. Logout + "Delete account" control.

### Phase 9 — Tests
34. **e2e (Jest + supertest)**: signup → verify → login → onboard → search; verified-only endpoints 403 for unverified; deleted user cannot log in; restore flow round-trip; profile search returns expected slice given fixture data.
35. **DB (pgTAP / Supabase harness)**: RLS on both tables (anon reads active public, cannot read deleted/private, self-update works, cross-user blocked); `handle_new_user` creates both rows; `sync_deleted_at` toggles correctly; age constraint rejects under-18; `users_deleted_at_consistency` rejects inconsistent states.
36. Retention cron: create deleted user with `deleted_at < now() - 61d`, run cron, assert row gone.
37. Presence cron flips `is_online` after threshold.
38. Admin routes: 403 for plain user, 200 + audit row for admin.

---

## Remaining open items

- **Restore-token format** — backend-signed JWT vs. Supabase magic-link with a `restore` claim?
- **Deletion side-effects on content** — when a user is soft-deleted, do their posts/messages stay visible attributed to "deleted user", or hide immediately? Default proposal: hide content from `account_status IN ('deleted','banned')` via join filter; confirm in each downstream model doc.
- **Profile visibility: members_only vs public** — same behavior in MVP; real split only matters if we allow anonymous browsing for SEO.
- **Friends-only visibility** — not included; requires Friendship model first. Add when that model lands.
- **Grace-period reminders** — T-7d / T-1d emails before hard delete. Nice-to-have.
- **Required onboarding fields** — proposed set listed above; confirm or tune.
- **Profession**: free text vs. curated list? Free text is simpler but dirties the filter. Could start free-text, add autocomplete + canonical list later.
