# Friends Integration Plan — Frontend

Wires the Friendship feature (friend graph + requests) into the static template. The backend lives in the separate NestJS project; this plan covers only the frontend (`turulav-dark/`) work.

> This plan inherits all architectural decisions from [`docs/user/INTEGRATION_PLAN.md`](../user/INTEGRATION_PLAN.md) §1 — static HTML + Redux Toolkit + RTK Query, JWT in localStorage, Vite, MSW for parallel dev, success/error envelopes, camelCase wire fields, base URL `http://localhost:3000/api/v1`. Nothing about the global setup changes.

---

## 1. Scope

| In scope | Out of scope (own slices later) |
|---|---|
| "Add Friend" CTA on the public profile page (`profile.html`) | Incoming/outgoing requests inbox UI |
| Friend-request lifecycle from the profile button: send, cancel, accept, unfriend | Friend suggestions / mutuals page |
| Live friendship status badge on the public profile (none/pending/accepted) | Block & unblock UI |
| Friends list on the owner's profile (`#friends` tab) | Admin moderation views |
| MSW mocks mirroring the request/status/list endpoints | Notifications on incoming requests |

---

## 2. API contract (frontend's understanding)

Spec lives in `docs/groups/INTEGRATION_PLAN.md`-style summary — see the "Friendship documentation" block delivered by the backend team (curl cookbook + route table).

### 2.1 Endpoints used in this plan

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/friends` | Paginated list of the viewer's accepted friends. **Backs the Friends tab on the owner's profile.** | 🔜 assumed shape (see §2.4) |
| GET | `/friends/:userId` | Friendship status between viewer and `:userId`. **Backs the public-profile CTA state.** | ✅ shape confirmed |
| POST | `/friends/requests` | Send a friend request. | ✅ |
| POST | `/friends/requests/:id/accept` | Accept an incoming request. | ✅ |
| POST | `/friends/requests/:id/decline` | Decline an incoming request. | ✅ |
| DELETE | `/friends/requests/:id` | Cancel an outgoing request. | ✅ |
| DELETE | `/friends/:userId` | Unfriend. | ✅ |

`:id` is `<userLow>:<userHigh>` URL-encoded, but the backend "also accepts the partner's userId and normalises". The frontend always passes the partner userId — simpler and avoids encoding bugs. The MSW mock matches that behavior.

### 2.2 `/friends/:userId` response — confirmed

```json
{
  "success": true,
  "data": { "status": "accepted" | "pending_in" | "pending_out" | "none" | "blocked_by_me" | "blocked_by_them" },
  "meta": { "...": "..." }
}
```

### 2.3 `POST /friends/requests` — confirmed

Body: `{ "targetUserId": "<uuid>", "message"?: "..." }` → 204 (frontend treats any 2xx as success; MSW returns 204).

Verification gate (`@RequireVerified()`) applies. On 403 `"Email verification required"` the frontend surfaces a one-liner under the CTA: *"Verify your email before sending friend requests."*

### 2.4 `/friends` response — assumed shape (TBD in backend docs)

The backend docs only confirm `q`, `country`, `sort`, `page`, `limit` query params and that the response is paginated. The shape is **not** in the cookbook, so the frontend assumes a `ProfileWithUserDto`-style row to reuse the existing member card markup:

```ts
type FriendItemDto = ProfileWithUserDto & {
  becameFriendsAt?: string | null;
};

type FriendsListResponseData = {
  items: FriendItemDto[];
  total: number;
  page: number;
  limit: number;
};
```

If the real backend returns a different shape, the only code path that needs adjusting is `friendCardHtml` in [`pages/profile.ts`](../../frontend-app/src/pages/profile.ts) plus the type alias in [`types/api.ts`](../../frontend-app/src/types/api.ts).

### 2.5 `FriendshipStatus` mapping → CTA label

| Status | Button label | On click |
|---|---|---|
| `none` | `Add Friend` | `POST /friends/requests` |
| `pending_out` | `Cancel request` | `DELETE /friends/requests/:id` (partner userId) |
| `pending_in` | `Accept request` | `POST /friends/requests/:id/accept` (partner userId) |
| `accepted` | `Friends ✓` (with confirm) | `DELETE /friends/:userId` |
| `blocked_by_me` | `Blocked` (disabled) | — |
| `blocked_by_them` | `Unavailable` (disabled) | — |

### 2.6 Endpoints planned but **not** in this plan

| Method | Path | Slice |
|---|---|---|
| GET | `/friends/requests/incoming` | F2 — Requests inbox |
| GET | `/friends/requests/outgoing` | F2 — Requests inbox |
| GET | `/friends/mutual/:userId` | F3 — Mutuals UI on public profile |
| GET | `/friends/suggestions` | F3 — "People you may know" |
| POST/DELETE | `/blocks/...` | F4 — Block flow |
| GET | `/admin/friendships` | F5 — Admin moderation |

The endpoints are already wired into `friendsApi.ts` (`listIncomingFriendRequests`, `listOutgoingFriendRequests`) so the slice F2 page only needs to bind them; no API code work.

---

## 3. Vertical slices

### Slice F1 — Friend CTA on public profile + Friends tab on own profile (this plan)

**Done when:** opening `profile.html?u=<uuid>` shows a CTA whose label reflects real friendship state, clicking it walks through send/cancel/accept/unfriend successfully, and the Friends tab on the owner's profile shows the real `/friends` list with count.

Frontend work (all shipped):
1. Types added to `frontend-app/src/types/api.ts`: `FriendshipStatus`, `FriendshipStatusDto`, `FriendItemDto`, `FriendsListQuery`, `FriendsListResponseData`, `SendFriendRequestBody`, `FriendRequestDto`.
2. New `frontend-app/src/api/friendsApi.ts` — `listFriends`, `getFriendshipStatus`, `sendFriendRequest`, `acceptFriendRequest`, `declineFriendRequest`, `cancelFriendRequest`, `unfriend`, plus the incoming/outgoing list queries for F2.
3. `api/api.ts` gains tags `Friends`, `FriendStatus`, `FriendRequests` so the mutations can invalidate precisely.
4. `pages/profile.ts`:
   - On public profile: `bindFriendAction(ctx, userId)` reads the status, paints the button label, and dispatches the right mutation per click. Errors (`EMAIL_UNVERIFIED`, `INVALID_CREDENTIALS`) surface inline.
   - On own profile: `renderFriendsTab(ctx)` calls `listFriends()`, paints the `.row` grid, and updates the `Friends <span class="item-number">` badge.
   - The Friends tab is **hidden** for public-profile views (no `GET /users/:id/friends` endpoint exists yet).
5. Minor `profile.html` edits:
   - `data-app-action="friend-action"` + `data-app-target="friend-action-label"` on the "Add Friends" anchor.
   - `data-app-target="friend-action-li"` on its wrapping `<li>` so own-profile view can hide the whole row.
   - `data-app-target="friend-action-status"` paragraph under the contact list for inline messages.
   - `data-app-target="profile-friends"` on the friends-tab `.row`.
6. MSW: handlers for every endpoint in §2.1, an in-memory `friendships` array in `fixtures.ts`, and a `seedFriendshipFixtures()` that pre-seeds one accepted pair + one pending-in request so the demo isn't empty.

### Slice F2 — Friend requests inbox (future)

A new section (or page) listing incoming and outgoing requests with accept/decline/cancel buttons. The `friendsApi` already exposes `listIncomingFriendRequests` / `listOutgoingFriendRequests` and their mutations — the slice is purely binding work.

### Slice F3 — Mutuals & suggestions on profile (future)

Wire `GET /friends/mutual/:userId` (on public profile) and `GET /friends/suggestions` (on `members.html` or a new "People you may know" rail).

### Slice F4 — Blocks (future)

CTA on the profile dropdown (currently a static "Block user" item), plus a "Blocked users" admin row on the settings page. Needs `POST/DELETE /blocks/:userId` and `GET /blocks`.

### Slice F5 — Admin friendship moderation (future)

Powered by `/admin/friendships*`. Out of scope for the user-facing app; lives in the admin console.

---

## 4. Files touched in Slice F1

```
frontend-app/src/
├── types/api.ts                 ← + Friendship types
├── api/api.ts                   ← + tag types Friends / FriendStatus / FriendRequests
├── api/friendsApi.ts            ← NEW
├── pages/profile.ts             ← bindFriendAction + renderFriendsTab + hide helpers
├── mocks/handlers.ts            ← + /friends* handlers
└── mocks/fixtures.ts            ← + friendships store + seed

profile.html                     ← data-app-* hooks on the existing markup
```

---

## 5. UI mapping for Slice F1

| Backend signal | DOM hook | Rendered as |
|---|---|---|
| `status` from `/friends/:userId` | `[data-app-action="friend-action"]` + `[data-app-target="friend-action-label"]` | Label per §2.5; disabled when `blocked_*` |
| Mutation success/failure | `[data-app-target="friend-action-status"]` | One-line confirmation or error text |
| `/friends` `items[]` | `[data-app-target="profile-friends"]` | Member-card grid (same markup as `members.html` cards) |
| `/friends` `total` | `#nav-friends-tab .item-number` | Number |

---

## 6. Verification-gate UX

Sending a friend request requires the viewer's email to be verified. The CTA itself stays enabled in all `pending_*` / `accepted` states (those don't need verification for cancel/decline/unfriend), but on the initial `POST /friends/requests` a 403 surfaces inline as *"Verify your email before sending friend requests."* — the user can re-trigger after verifying.

No banner takeover — the rest of the profile renders normally because reading status/list endpoints does not require verification.

---

## 7. Open items (block follow-up slices)

| # | Item | Needed before |
|---|---|---|
| 7.1 | Confirm `/friends` list-response shape (currently assumed in §2.4). | Hardening Slice F1 against the real backend |
| 7.2 | `GET /friends/requests/{incoming,outgoing}` row shape — `FriendRequestDto` is assumed. | Slice F2 |
| 7.3 | `GET /friends/mutual/:userId` response shape | Slice F3 |
| 7.4 | `GET /friends/suggestions` response shape | Slice F3 |
| 7.5 | Notifications (push or polled badge) when an incoming request arrives | Slice F2 polish |

---

## 8. Change log

| Date | Change |
|---|---|
| 2026-05-18 | Plan created. Slice F1 shipped end-to-end against MSW mocks. `/friends` list-response shape (§2.4) and `FriendRequestDto` (§7.2) marked as assumed pending backend confirmation. |
