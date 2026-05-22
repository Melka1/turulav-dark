# Group Integration Plan — Frontend

Wires the Community feature (groups) into the static template. The backend lives in the separate NestJS project; this plan covers only the frontend (`turulav-dark/`) work.

> This plan inherits all architectural decisions from [`docs/user/INTEGRATION_PLAN.md`](../user/INTEGRATION_PLAN.md) §1 — static HTML + Redux Toolkit + RTK Query, JWT in localStorage, Vite, MSW for parallel dev, success/error envelopes, camelCase wire fields, base URL `http://localhost:3000/api/v1`. Nothing about the global setup changes.

---

## 1. Scope

| In scope | Out of scope (own slices later) |
|---|---|
| Browse community page (`active-group.html`) — search + paginated list of groups | Group detail page |
| Verification gate UX (same pattern as members.html) | Create / edit / delete group |
| Total-count display | Join / leave / membership state |
| Pagination | Member-list view inside a group |
| MSW mocks mirroring the real wire format | Admin moderation, suspend, member-role changes |

---

## 2. API contract (frontend's understanding)

### 2.1 Endpoints used in this plan

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/groups/search` | Paginated, filtered group list. **Backs the community page.** | ✅ probed |
| GET | `/groups/me` | Groups the authenticated user is an active member of. Used to mark "Joined" state on community cards + power a future "My Groups" view. | ✅ probed |

### 2.2 `/groups/search` request

Confirmed by user (curl + sample): supports at least `q=<text>`. Backend said "same params as /groups (alias)" — likely follows the `/profiles/search` convention. Frontend will plan for, but the wire spec for these is **TBD**:

| Param | Type | Notes |
|---|---|---|
| `q` | string | Free-text search — **confirmed** |
| `country` | string | Filter by country — TBD if supported |
| `city` | string | Filter by city — TBD |
| `interests` | string (comma-separated) | TBD |
| `visibility` | `'public' \| 'unlisted' \| 'private'` | TBD |
| `joinPolicy` | `'open' \| 'invite_only' \| 'request'` | TBD |
| `sort` | `'most_active' \| 'relevance'` | TBD — `members.html` uses `most_active` |
| `page` | integer (default 1) | Confirmed by response shape |
| `limit` | integer (default 20) | Confirmed by response shape |

For Slice G1 the form only fires `q` + `page` (the rest stay parked until either the backend confirms them or the UI adds the controls).

### 2.3 `/groups/search` response — confirmed

```json
{
  "success": true,
  "data": {
    "items": [ GroupDto, … ],
    "total": 2,
    "page": 1,
    "limit": 20
  },
  "meta": { "timestamp": "...", "path": "...", "requestId": "..." }
}
```

### 2.4 `GroupDto`

Fields from the probe (camelCase, nullable where noted):

```ts
type GroupVisibility = 'public' | 'unlisted' | 'private';   // private inferred
type GroupJoinPolicy = 'open' | 'invite_only' | 'request';  // request inferred

type GroupDto = {
  id: string;                   // uuid
  slug: string;                 // URL-friendly identifier
  name: string;
  description: string | null;
  rules: string | null;
  ownerId: string;              // uuid → public.users.id
  visibility: GroupVisibility;
  joinPolicy: GroupJoinPolicy;
  interests: string[];          // e.g. ["coffee","board_games","hiking"]
  country: string | null;
  city: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  maxMembers: number;
  memberCount: number;          // current member count (we don't get the avatars themselves)
  adminSuspendedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Note the response does **not** include the member list or member avatars — just `memberCount`. The template's static avatar stack is dropped on the frontend (no fake data) and replaced with a "N members" pill.

### 2.5 `/groups/me` — confirmed

```json
{
  "success": true,
  "data": [ GroupDto, GroupDto, … ],
  "meta": { "timestamp": "...", "path": "...", "requestId": "..." }
}
```

`data` is a **flat array of `GroupDto`** — same item shape as `/groups/search.items[]`. No envelope (no `total`/`page`/`limit`), no per-membership metadata (`role`, `joinedAt`). Implications:

- Slice G1 uses it only to mark "Joined" on community-search cards (computed via `Set<groupId>`).
- Role badges and "member since" labels are deferred until the backend extends the shape (tracked as a non-blocking enhancement, not in §7).

### 2.6 Verification gate

`/groups/search` is expected to be `@RequireVerified()` like `/profiles/search`. On 403 `"Email verification required"` the frontend reuses the same banner pattern from `members.html` (verify-email panel with resend button) rendered inside the grid area.

### 2.7 Endpoints planned but **not** in this plan

| Method | Path | Slice |
|---|---|---|
| GET | `/groups/:slug` (or `/:id`) | G2 — Group detail page |
| POST | `/groups` | G3 — Create |
| PATCH | `/groups/:id` | G3 — Edit |
| DELETE | `/groups/:id` | G3 — Delete |
| POST | `/groups/:id/join` | G4 — Join (handle `open` vs `request` vs `invite_only` outcomes) |
| POST | `/groups/:id/leave` | G4 |
| GET | `/groups/:id/members` | G5 — Members + roles |
| POST | `/groups/:id/members/:userId/role` | G5 — Admin role change |
| POST | `/admin/groups/:id/suspend` | G5 — Admin moderation |

Backend should provide shapes for each before its corresponding slice starts.

---

## 3. Vertical slices

### Slice G1 — Browse community page (this plan)

**Done when:** `active-group.html` shows real groups from the backend, search-by-text works, count + pagination reflect server data, verification gate surfaces inline.

Frontend work:
1. Add `GroupDto`, `GroupVisibility`, `GroupJoinPolicy`, `SearchGroupsQuery`, `SearchGroupsResponseData` to `frontend-app/src/types/api.ts`.
2. New `frontend-app/src/api/groupsApi.ts` — `searchGroups` query (mirrors `profilesApi.searchProfiles` exactly).
3. Refactor shared bits out of `pages/members.ts`:
   - `frontend-app/src/lib/pagination.ts` — `renderPagination(list, data, onJump)` + `paginationWindow(current, total)`.
   - `frontend-app/src/lib/format.ts` — add `escapeHtml(s)`.
4. New `frontend-app/src/pages/groups.ts` binder — search form, grid, pagination, count, empty/loading/verify states.
5. Add to `pages/binders.ts` and to `lib/authGuard.ts` (`'groups': 'authenticated'`).
6. MSW: `GET /groups/search` handler + a small `seedGroupFixtures()` for mock-mode dev.
7. Minor `active-group.html` edits: add `name="q"` to the search input and `data-app-form="groups-search"` to the form.

### Slice G2 — Group detail page (future)

Stub a new `group.html` (or reuse `profile.html`'s shape) showing one group's full info, member preview, and join CTA. Requires `GET /groups/:slug` from the backend.

### Slice G3 — Create / edit group (future)

Form for creating a group (subset of `GroupDto` editable fields). Edit gated to `ownerId === me`. Requires backend `POST /groups`, `PATCH /groups/:id`.

### Slice G4 — Join / leave (future)

Join CTA on group cards and detail page; handle the three `joinPolicy` outcomes (instant for `open`, "request sent" for `request`, "invite-only" disabled state). Requires `POST /groups/:id/join`, `POST /groups/:id/leave`.

### Slice G5 — Membership + admin (future)

Member list, role changes, suspension. Requires the role/admin endpoints listed in §2.6.

---

## 4. Files touched in Slice G1

```
frontend-app/src/
├── types/api.ts                 ← add Group types
├── api/groupsApi.ts             ← NEW
├── lib/pagination.ts            ← NEW (extracted from pages/members.ts)
├── lib/format.ts                ← + escapeHtml
├── pages/groups.ts              ← NEW
├── pages/members.ts             ← refactor to use shared helpers
├── pages/binders.ts             ← + import './groups'
├── lib/authGuard.ts             ← + 'groups': 'authenticated'
├── mocks/handlers.ts            ← + GET /groups/search handler
└── mocks/fixtures.ts            ← + seedGroupFixtures()

active-group.html                ← name="q", data-app-form="groups-search"
```

---

## 5. UI mapping for Slice G1

| Backend field | Card location (template selector) | Rendered as |
|---|---|---|
| `name` | `.group-item .lab-content h4` | text |
| `description` | `.group-item .lab-content p` | text (or "—" when null) |
| `avatarUrl` | `.group-item .lab-thumb img` | `src=` (fallback to `assets/images/group/01.jpg`) |
| `memberCount` | `.group-item .img-stack` | replaces the static avatar list with a single `<li class="bg-theme">N members</li>` |
| `slug` | `.group-item .lab-btn` | `href="#"` + `data-app-group-slug="…"` until Slice G2 wires the detail page |
| `total` | `.group-search .group-count p:nth-child(2)` | localized number |
| `page` / `limit` | `.paginations ul` | windowed page list (reuses members' helper) |

---

## 6. Verification-gate UX (Slice G1)

Same policy as `members.html` — option (b) from the members slice:

- Header, search input, and chrome stay visible.
- Grid area is replaced with a panel: "Verify your email to browse community" + Resend button.
- Resend extracts the email from the JWT (because `/users/me` doesn't include it) and POSTs `/auth/resend-verification`.

---

## 7. Open items (block follow-up slices)

| # | Item | Needed before |
|---|---|---|
| 7.1 | Full `/groups/search` query-param spec (does it accept `country`, `interests`, `visibility`, `joinPolicy`, `sort`?) | Adding any extra filter UI |
| 7.2 | `GET /groups/:slug` (or `:id`) shape | Slice G2 |
| 7.3 | `POST /groups` body/response shape | Slice G3 |
| 7.4 | `POST /groups/:id/join` outcomes (immediate, pending, blocked) | Slice G4 |
| 7.5 | Member list endpoint shape + role enum | Slice G5 |
| 7.6 | Verify the `visibility` and `joinPolicy` enums end-to-end (probe only confirmed `unlisted` + `public` and `invite_only` + `open`) | Hardening the types |

---

## 8. Change log

| Date | Change |
|---|---|
| 2026-05-15 | Plan created. `/groups/search` shape probed and documented in §2. Slice G1 scoped; G2–G5 deferred. |
| 2026-05-15 | Added `GET /groups/me` to §2 with response shape marked **TBD**; tracked in §7.7. |
| 2026-05-15 | `/groups/me` shape confirmed — flat `GroupDto[]`. §2.5 rewritten, §7.7 dropped. |
