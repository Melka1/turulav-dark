# User Integration Plan — Frontend

End-to-end plan to wire the User + Profile feature into the static HTML template using Redux. **Backend lives in a separate project** and conforms to the API contract in §3 — this plan covers only the work that happens in `turulav-dark/`.

---

## 1. Architectural decisions (confirmed 2026-05-11)

| # | Decision |
|---|---|
| 1.1 | **Frontend architecture** — Static HTML pages stay. A TypeScript Redux bundle (`assets/js/app.bundle.js`) hydrates pages on `DOMContentLoaded`. jQuery + Bootstrap remain; new code binds DOM via `data-app-*` attributes. **No React/Vue.** |
| 1.2 | **Redux setup** — Redux Toolkit (RTK) + **RTK Query** for all server state. Thin slices for local UI/auth state only. |
| 1.3 | **Bundler** — **Vite** in a new `frontend-app/` workspace, output emitted to `assets/js/app.bundle.js`. |
| 1.4 | **Token storage** — JWT in `localStorage`, sent as `Authorization: Bearer …`. |
| 1.5 | **Backend communication** — Frontend talks only to the backend HTTP API. **Never** to Supabase directly. Exception: avatar/cover upload PUTs the file to a Supabase Storage signed URL the backend issues — no Supabase SDK needed. |
| 1.6 | **Local dev against unfinished backend** — **MSW (Mock Service Worker)** stubs the contract in §3. Same RTK Query code targets mock or real backend via `VITE_USE_MOCKS`. |
| 1.7 | **Error response envelope** — Every non-2xx returns `{ error: { code, message, details? } }`. Frontend selectors key off `code`, not message text. |
| 1.8 | **API contract source of truth** — §3 is canonical. The backend project conforms to it; changes are negotiated by updating §3 first. |

---

## 2. Repo layout after Slice 0

```
turulav-dark/
├── *.html                    # existing static pages (untouched)
├── assets/                   # existing CSS/JS/images (untouched)
│   └── js/
│       └── app.bundle.js     # NEW — Vite output, served alongside legacy JS
├── frontend-app/             # NEW — TypeScript source for the Redux bundle
│   ├── src/
│   │   ├── main.ts
│   │   ├── store/
│   │   ├── api/              # RTK Query
│   │   ├── slices/
│   │   ├── pages/            # one binder per HTML page
│   │   ├── mocks/            # MSW handlers
│   │   └── lib/
│   ├── vite.config.ts
│   └── package.json
├── docs/
└── .env.example              # NEW (frontend env only)
```

No `backend/`, no `supabase/` — both belong to the other project.

---

## 3. API contract (canonical — backend conforms to this)

Every endpoint below is called by the frontend during the User+Profile slices. **This section is the source of truth**; the separate backend project implements to match. Any change is made here first, then mirrored in the backend.

**Conventions**
- **Base URL** carries the version prefix: `http://localhost:3000/api/v1` in dev. Every path below is relative to it. The base lives in `VITE_BACKEND_URL`.
- Auth: `Authorization: Bearer <accessToken>` (omit on auth bootstrap).
- Content-Type: `application/json` (except multipart Storage PUT during upload).
- **Field naming**: `camelCase` on the wire (matches the NestJS backend).
- Timestamps: ISO 8601 UTC.

**Success envelope** — every 2xx response:

```json
{
  "success": true,
  "data": { /* the payload — DTOs in §3.4 describe this */ },
  "meta": {
    "timestamp": "2026-05-12T01:00:00.000Z",
    "path": "/api/v1/...",
    "requestId": "uuid"
  }
}
```

Frontend code calls `unwrap(response)` (defined in `src/api/baseQuery.ts`) on every endpoint's `transformResponse` to peel the envelope and surface `data` directly.

**Error envelope** — every non-2xx response (NestJS default shape):

```json
{
  "statusCode": 409,
  "message": "Username already taken",
  "error": "Conflict",
  "path": "/api/v1/auth/signup",
  "timestamp": "2026-05-12T01:00:00.000Z",
  "requestId": "uuid"
}
```

`message` is either a single string (business errors) or an array of strings (class-validator output). Frontend's `parseApiError` maps this to an internal `ApiError { code, message, details?, requestId? }` using HTTP status + message heuristics. **Recommended (not yet shipped):** backend adds an explicit `code` field per exception so frontend stops pattern-matching on messages.

### 3.1 Auth

All responses use the success envelope (§3 conventions). The `data` payload shapes are listed in the right-most column.

| Method | Path | Request | Success `data` shape | Notable HTTP errors |
|---|---|---|---|---|
| POST | `/auth/signup` | `{ username, email, password }` | 201 `{ userId, emailConfirmationRequired: boolean }` — **no session issued; user must verify email then log in** | 409 username conflict · 409 email conflict · 400 validation · 429 rate limited |
| POST | `/auth/login` | `{ email, password }` | 200 `{ userId, session: { accessToken, refreshToken, expiresIn, tokenType } }` | 401 invalid creds · 403 account deleted · 403 suspended / banned · 403 email unverified |
| POST | `/auth/logout` | — (bearer) | 204 | — |
| POST | `/auth/refresh` | `{ refreshToken }` | 200 `{ session: AuthSession }` | 401 invalid/expired token |
| POST | `/auth/resend-verification` | `{ email }` | 204 | 409 already verified · 429 rate limited |

### 3.2 Users

| Method | Path | Request | Success `data` shape | Notes |
|---|---|---|---|---|
| GET | `/users/me` | — (bearer) | `UserDto & { profile: ProfileDto }` | Bundles the profile to save a round-trip on page load. |
| PATCH | `/users/me` | `Partial<UpdateMeDto>` (currently `username`) | `UserDto` | 409 on username conflict. |
| GET | `/users/:id` | — | `PublicUserDto` | Hides role/status; 404 if blocked. |
| POST | `/users/me/presence` | — | 204 | Throttled to ~1/30s. |
| DELETE | `/users/me` | `{ password }` (confirm) | 204 | Backend revokes sessions + emails restore link. |
| POST | `/users/me/restore` | `{ token }` | `UserDto` | Token from email; 410 if restore expired. |

### 3.3 Profiles

| Method | Path | Request | Success `data` shape | Notes |
|---|---|---|---|---|
| GET | `/profiles/me` | — | `ProfileDto` | All profile fields. |
| PATCH | `/profiles/me` | `Partial<UpdateProfileDto>` | `ProfileDto` | 403 email unverified · 400 if `dob` would make the user < 18. |
| GET | `/profiles/:userId` | — | `PublicProfileDto` | Visibility + block + status enforced. |
| POST | `/profiles/me/avatar` | `{ mime, sizeBytes }` | `{ uploadUrl, expiresAt, publicUrl, assetId }` | Two-phase: client PUTs file to `uploadUrl`. |
| POST | `/profiles/me/avatar/confirm` | `{ assetId }` | `ProfileDto` | Backend verifies upload, sets `avatarUrl`. |
| POST | `/profiles/me/cover` / `…/confirm` | — | same | Mirror of avatar flow. |
| GET | `/profiles/search` | query: `gender`, `seeking[]`, `ageMin`, `ageMax`, `country`, `profession`, `interests[]`, `q`, `sort`, `page`, `perPage` | `{ results: PublicProfileDto[], total, page, perPage }` | Backs `members.html`. |
| POST | `/profiles/me/complete` | — | `{ completionScore, onboardingCompleted, missingFields }` | Recomputes onboarding state. |

### 3.4 DTO shapes (live source: `frontend-app/src/types/api.ts`)

```ts
type UserDto = {
  id: string;
  username: string;
  role: 'user' | 'moderator' | 'admin';
  accountStatus: 'active' | 'suspended' | 'banned' | 'deleted';
  isOnline: boolean;
  lastActiveAt: string | null;
  onboardingCompleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserWithProfileDto = UserDto & { profile: ProfileDto };

type PublicUserDto = Pick<UserDto,
  'id' | 'username' | 'isOnline' | 'lastActiveAt' | 'createdAt'>;

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;       // seconds; frontend computes expiresAt = now + expiresIn
  tokenType: 'bearer';
};

type ProfileDto = {
  userId: string;
  displayName: string;
  gender: 'male' | 'female' | 'non_binary' | 'other' | 'prefer_not_to_say' | null;
  seeking: string[];
  dob: string | null;
  maritalStatus: string | null;
  relationshipType: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  bio: string | null;
  lookingFor: string | null;
  likes: string | null;
  interests: string[];
  favoritePlaces: string[];
  languages: string[];
  religion: string | null;
  children: string | null;
  smoking: string | null;
  drinking: string | null;
  heightCm: number | null;
  weightKg: number | null;
  hairColor: string | null;
  eyeColor: string | null;
  bodyType: string | null;
  ethnicity: string | null;
  profession: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  visibility: 'public' | 'members_only' | 'private';
  completionScore: number;     // 0–100
  createdAt: string;
  updatedAt: string;
};

type PublicProfileDto = Omit<ProfileDto, 'address' | 'visibility'>;
```

Note: `email` and `emailConfirmedAt` are **not** on `UserDto` — they live in the Supabase JWT (`email` claim) and in `auth.users`. Frontend decodes the JWT for `email`; verification state comes from a dedicated endpoint (TBD).

### 3.5 Internal `ApiError` codes (assigned by `parseApiError`)

Backend ships NestJS-default error shapes; frontend derives an internal `code` from HTTP status + message heuristics. Codes used by UI logic:

| Code | When | Frontend behavior |
|---|---|---|
| `EMAIL_UNVERIFIED` | 403 + message mentions "verified"/"confirm" | "Check inbox" banner + resend button |
| `ACCOUNT_DELETED` | 403 + message mentions "deleted" | "Restore via email" message |
| `ACCOUNT_SUSPENDED` / `ACCOUNT_BANNED` | 403 + message mentions either | Block access page |
| `RESTORE_EXPIRED` | 410 | "Account permanently deleted" |
| `USERNAME_TAKEN` / `EMAIL_TAKEN` | 409 + message mentions field | Inline form error |
| `INVALID_CREDENTIALS` | 401 | Inline form error |
| `RATE_LIMITED` | 429 | Toast + back-off |
| `VALIDATION` | 400 with `message: string[]` from class-validator | Per-field inline errors via `details.field_errors` |
| `CONFLICT` / `FORBIDDEN` / `NOT_FOUND` / `SERVER_ERROR` | Generic catch-alls | Toast |
| `NETWORK` | Fetch failure (no response) | Toast: "Unable to reach the server" |

**Recommended backend improvement (non-blocking):** include an explicit `errorCode` field in error responses. Lets the frontend stop pattern-matching on message text — drop the heuristics in `src/api/baseQuery.ts`.

---

## 4. Vertical slices (order of work)

Each slice ships end-to-end and depends on either a real or mocked backend (§1.6).

### Slice 0 — Foundations
1. Init `frontend-app/` with Vite + TS + `@reduxjs/toolkit` + `msw`.
2. Vite config: build to `../assets/js/app.bundle.js` (single file, hashed only in prod).
3. Set up store, base RTK Query slice with auth-header injector, MSW boot in dev.
4. `pages/index.ts` router: read `<body data-page="…">` and dispatch to a binder.
5. Add `<script src="assets/js/app.bundle.js" defer></script>` + `data-page` attributes to every static HTML page.

**Done when:** `pnpm dev` opens any page and the bundle boots a Redux store visible in Redux DevTools.

### Slice 1 — Signup → "verify your email" view
1. `authApi.signup` mutation; MSW handler returns the contract's 201.
2. `slices/authSlice.ts` — token, user, status.
3. `pages/signup.ts` — bind `signup.html` form to `signup` mutation; on success, swap the panel for a "check your inbox" view + resend button.
4. Handle `USERNAME_TAKEN`, `EMAIL_TAKEN`, `VALIDATION` inline.

### Slice 2 — Login → land on profile (gated by verification)
1. `authApi.login`; persist token to localStorage + Redux on success.
2. `lib/authBoot.ts` — on every page load, hydrate from localStorage; redirect unauthenticated users away from gated pages.
3. `pages/login.ts` — handles `INVALID_CREDENTIALS`, `ACCOUNT_DELETED` (link to restore page), `ACCOUNT_SUSPENDED`/`BANNED`.
4. Verification banner component injected into gated pages when `email_confirmed_at` is null; "Resend" → `authApi.resendVerification`.

### Slice 3 — View own profile
1. `usersApi.getMe`, `profilesApi.getMe` queries.
2. `pages/profile.ts` — bind DOM nodes by `data-bind="profile.bio"` etc.
3. Header shows `display_name`, online dot, relative "last active".

### Slice 4 — Edit profile + onboarding
1. `profilesApi.updateMe` mutation with optimistic update.
2. Inline edit forms per section (Base / Lifestyle / Physical / Looking-for).
3. `profilesApi.complete` after every save; surface `missing_fields` until `onboarding_completed` flips true.
4. Onboarding wizard mode: if `onboarding_completed` false, gated pages redirect to `profile.html?onboarding=1` which renders the wizard sequentially.

### Slice 5 — Avatar + cover upload
1. UI: clickable avatar/cover with file picker.
2. Flow: `POST /profiles/me/avatar` → `PUT` to returned signed URL with progress → `POST /profiles/me/avatar/confirm` → invalidate `getMe`.
3. Mirror for cover.

### Slice 6 — Members directory
1. `profilesApi.searchProfiles` query (cache key = serialized filters).
2. `pages/members.ts` — filter form → URL query string → query → grid render.
3. Sort + pagination wired.
4. Re-use existing isotope JS for layout where possible (data attributes only).

### Slice 7 — Presence heartbeat
1. `lib/presence.ts` — 30s `setInterval` while page is visible; throttle on `visibilitychange`.
2. Online dot in header reflects `getMe` data.

### Slice 8 — Soft delete + restore
1. `pages/profile.ts` — "Delete account" modal asks for password, calls `usersApi.deleteMe`.
2. On 204, clear localStorage and bounce to a confirmation page with restore-email reminder.
3. New `restore.html` page (small) — reads `?token=…`, calls `usersApi.restoreMe`, then routes to login.

---

## 5. Frontend skeleton (target after Slice 4)

```
frontend-app/src/
├── main.ts                     # bundle entry — boots store + page router
├── store/
│   ├── store.ts                # configureStore
│   └── selectors.ts            # cross-slice selectors
├── api/
│   ├── baseQuery.ts            # fetchBaseQuery + auth-header injector + error normalizer
│   ├── authApi.ts              # signup/login/logout/refresh/resend
│   ├── usersApi.ts             # me, presence, delete, restore
│   └── profilesApi.ts          # me, byId, update, avatar, cover, search, complete
├── slices/
│   ├── authSlice.ts            # token + user + email_confirmed_at + status
│   └── uiSlice.ts              # toasts, modals, verification banner
├── pages/
│   ├── index.ts                # router by <body data-page>
│   ├── signup.ts
│   ├── login.ts
│   ├── profile.ts
│   ├── members.ts
│   └── restore.ts
├── mocks/
│   ├── browser.ts              # MSW worker
│   ├── handlers.ts             # one handler per API contract endpoint
│   └── fixtures.ts             # canned UserDto / ProfileDto
└── lib/
    ├── authBoot.ts             # hydrate from localStorage on every page
    ├── domBind.ts              # data-bind reader/writer helpers
    ├── form.ts                 # serialize + show inline errors keyed by field
    └── presence.ts             # 30s heartbeat with visibility throttle
```

---

## 6. Environment variables

`.env.example` (commit) → `.env.local` (gitignore):

```
VITE_BACKEND_URL=http://localhost:3000   # the separate backend project
VITE_USE_MOCKS=true                       # set false when wiring real backend
```

No Supabase keys live in this repo.

---

## 7. Mock backend with MSW

Why: backend is built in another project on its own timeline. MSW lets the frontend ship in parallel and makes the contract executable.

- `mocks/handlers.ts` implements every endpoint in §3 with realistic delays and the standard error envelope.
- `mocks/fixtures.ts` keeps a small set of canned users + profiles so members search returns something believable.
- Boot only when `import.meta.env.VITE_USE_MOCKS === 'true'`.
- When the real backend lands, flip the env flag; no other code change.

---

## 8. Definition of done for User Integration (frontend side)

- [ ] Slices 0–8 green in manual e2e against MSW mocks.
- [ ] Same flows green against the real backend once it's deployed (one full pass, recorded checklist).
- [ ] Unit tests for slices/selectors and the error normalizer.
- [ ] All four pages functional on `pnpm dev`: `signup.html`, `login.html`, `profile.html`, `members.html`.
- [ ] Onboarding gate redirects unfinished users back into the wizard.
- [ ] Verification banner appears for unverified users and disappears after verifying.
- [ ] Soft-delete flow round-trips with restore page.

---

## 9. Out of scope (intentional)

- Backend implementation (separate project).
- Database migrations, RLS, Supabase setup (backend project).
- Friend graph, messaging, posts, groups, blog, subscriptions, full media gallery.
- Admin console.

---

## 10. Risks / things that will probably surprise us

- **jQuery vs. Redux interop** — legacy `functions.js` may bind events on the same DOM nodes our binders touch. Mitigation: namespace new bindings on `data-app-*`, never `class` or `id`, and leave legacy JS untouched.
- **Full page reloads kill the store** — every static-HTML link triggers a fresh boot. `localStorage` rehydrate is the safety net; expect a flash of unauthenticated state on the first paint, which we'll mask by hiding gated content via CSS until auth resolves.
- **Mock drift** — MSW handlers diverge from the real backend over time. Mitigation: lock the contract in §3 with TS types, regenerate fixtures whenever §3 changes, run one round of testing against the real backend at the end of every slice.
- **Avatar upload progress** — `PUT` to Supabase Storage signed URL won't run through RTK Query, so progress + cancellation need a hand-rolled `XMLHttpRequest` wrapper.
- **CORS on the real backend** — must allow the frontend origin and the `Authorization` header. Confirm on first integration call.

---

## 11. Change log

| Date | Change |
|---|---|
| 2026-05-11 | §1 decisions 1.1–1.8 confirmed. Plan unblocked for Slice 0. §3 declared canonical; backend project to conform. |
| 2026-05-12 | §3 base URL set to `http://localhost:3000/api/v1`. All endpoint paths are relative to it. |
| 2026-05-12 | §3 rewritten to match real backend wire format: success envelope `{ success, data, meta }`, NestJS-default error envelope, camelCase field naming, signup returns `{ userId, emailConfirmationRequired }` (no session), login returns `{ userId, session }`. Frontend types and MSW handlers updated. |
