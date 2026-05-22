# Home-Page Search Integration Plan — Frontend

Wires the "Find Your Match" form on `index.html` (banner section) into the existing `/profiles/search` flow. Today the form is decorative: `action="/"`, no binder, no validation, no result page. This plan turns it into the entry point for the members directory.

> Inherits all architectural decisions from [`docs/user/INTEGRATION_PLAN.md`](../user/INTEGRATION_PLAN.md) §1 — static HTML + Redux Toolkit + RTK Query, JWT in localStorage, Vite, MSW for parallel dev, success/error envelopes, camelCase wire fields, base URL `http://localhost:3000/api/v1`. Nothing about the global setup changes.

---

## 1. What's on the page today

The "Introducing Matchmakers" banner on [`index.html`](../../index.html) contains a `<form action="/" class="banner-form">` ([index.html:142-244](../../index.html#L142-L244)) with four controls:

| DOM | Label | Type | Values |
|---|---|---|---|
| `select#gender[name="gender"]` | "I am a" | dropdown | 31 professions (Painter, Photographer, … Songwriter) — note: input name says `gender` but the options are professions |
| `select#gender-two[name="gender"]` | "Looking for" | dropdown | same 31 professions |
| `select#age[name="age-start"]` | "When" | dropdown | Today / Within 3 days / Within the next month / Within this next year / Open |
| `input#city[type=text]` | "City" | free text | — |
| `<button>` | "Find Your Match" | submit | — |

Quirks worth fixing during the slice:

- Both selects share `name="gender"`, which makes `FormData` lose one of them. We rename to `name="profession"` / `name="seekingProfession"`.
- `name="age-start"` is misleading; it's an availability window, not an age. We rename to `name="when"`.
- The form has no `data-app-form` attribute, so the new binder needs a hook to attach to.
- `<body data-app-page="home">` already exists ([index.html:20](../../index.html#L20)) — the router will find the binder without an HTML change there.

---

## 2. Where the search should land

Members directory (`members.html` / `pages/members.ts`) is the only existing UI that lists profiles, and it already calls `/profiles/search` ([frontend-app/src/pages/members.ts:53-91](../../frontend-app/src/pages/members.ts#L53-L91)). The home-page form should serialize its inputs into the `members.html` URL query string and navigate there; `members.ts` already reads `URLSearchParams`-shaped state on first render once we wire that up (today it does **not** read `location.search` — see §6.3).

Two reasons not to render results in place on the home page:

1. The banner section is intentionally short — six rows × four columns of cards would dwarf it and break the visual rhythm of the marketing sections below (About / Work / Stories / Top Members / Groups / Reviews).
2. `members.html` already owns pagination, total counters, the verification banner, the empty/loading/error states, and the sort dropdown. Duplicating all of that into the home page is dead weight.

---

## 3. API contract gap analysis

Mapping each home-form field to the existing `SearchProfilesQuery` in [frontend-app/src/types/api.ts:69-83](../../frontend-app/src/types/api.ts#L69-L83):

| Home field | Current API support | Gap |
|---|---|---|
| "I am a" (own profession) | None — `SearchProfilesQuery` doesn't take the *searcher's* profession | **No backend change needed.** This is a self-description used only when the user is unauthenticated, to preserve intent through signup. See §4. |
| "Looking for" (target profession) | `profession?: string` exists on `SearchProfilesQuery` and on `ProfileDto.profession` (free text) | Confirm the 31 labels map to canonical backend values. Today the column is `string \| null` — likely accepts free text. **TBD with backend.** |
| "When" (availability window) | **Not in the model.** No `availability`, `availableFrom`, or similar field on `ProfileDto`. No filter param in `SearchProfilesQuery`. | **Backend change required.** Either (a) add `availability` to the profile, indexed, filterable; or (b) drop this filter from MVP and re-introduce later as a separate "Hire Now" feature. **Recommendation: drop from MVP** — see §5. |
| "City" | `country?: string` is in the query; no `city`. `ProfileDto.city` exists, so the data is there. | **Backend should add `city` to `/profiles/search`.** Frontend adds `city?: string` to `SearchProfilesQuery` and to the form serializer. Tracked in §8. |

Adopting all four cleanly therefore requires backend work on `city` (small) and `availability` (substantive — new column, index, possibly a small enum). The home-search slice can ship with just `profession` and `city`, and progressive-enhance once the rest lands.

---

## 4. Handling the "I am a" field

Two distinct intents:

- **Unauthenticated visitor.** The field is part of the funnel: "tell us who you are so we can pre-fill signup." We persist the value as `signupIntent.profession` in `sessionStorage`, then `pages/signup.ts` reads it after a successful signup to PATCH `/profiles/me`. The "Looking for / When / City" go in the same blob and become the first stored search (we navigate the user to `members.html?…` once email is verified).
- **Authenticated visitor.** The user already has a profession on their profile; their own profession is not a search filter. We pre-fill "I am a" from `getMe().profile.profession` (display-only) and ignore it on submit.

So **"I am a" never becomes a `SearchProfilesQuery` parameter** in either case. It's UX-only.

---

## 5. "When" — drop from MVP

The fastest path to a working slice is to ship without the availability filter. Reasons:

1. There is no `availability` column on `ProfileDto`. Adding it touches the database, backend DTOs, and the profile-edit UI — that's a feature, not a search-wiring slice.
2. The five window options (`Today / Within 3 days / Within month / Within year / Open`) don't map to any concept the current matchmaking domain models. We'd be inventing it.
3. Dropping it lets the slice ship against the existing backend + MSW handlers, with no contract changes other than `city`.

Concretely:

- The "When" `<select>` stays in the HTML but is marked `data-app-decorative` and ignored by the binder.
- A small "Coming soon" hint sits under the field.
- §8 tracks the open question.

If the product owner pushes back, the alternative is the **§9 Alternative A** path (add `availability` to the model up front), which roughly doubles the slice's scope.

---

## 6. Vertical slice (H1) — home-page search wiring

**Done when:** typing in the home banner and clicking "Find Your Match" lands the user on `members.html` with `profession` and `city` filters applied, the grid reflects them, and unauthenticated users hit the same destination after signup + verification.

### 6.1 Frontend work

1. **HTML edits to `index.html`** ([index.html:142-244](../../index.html#L142-L244)):
   - `<form action="members.html" method="get" class="banner-form" data-app-form="home-search">`
   - Rename `#gender[name="gender"]` → `#home-search-profession[name="profession"]` (kept label "I am a").
   - Rename `#gender-two[name="gender"]` → `#home-search-seeking[name="seekingProfession"]` (label "Looking for").
   - Rename `#age[name="age-start"]` → `#home-search-when[name="when"]` (label "When"); add `data-app-decorative` so the binder skips it.
   - Add `name="city"` to `<input id="city">` (it currently has no `name`).
   - Optional: replace the inline "Find Your Match" `<button>` (default type `submit`) with `<button type="submit">` for clarity.

2. **New `frontend-app/src/pages/home.ts`** — registers a binder for `data-app-page="home"`:
   - On mount: if authenticated, pre-fill the "I am a" select from `profilesApi.getMe` (`profile.profession`) — display-only.
   - On submit:
     - `event.preventDefault()`.
     - Read `seekingProfession` and `city` from the form, drop empty/placeholder values (the "Select" first option, value `0`).
     - Persist the full intent (`profession`, `seekingProfession`, `when`, `city`) under `sessionStorage['turulav.searchIntent']` — so signup can replay it.
     - Build a query string `?profession=<seekingProfession>&city=<city>` and `window.location.assign('members.html' + qs)`.
   - If the user is **un**authenticated, redirect instead to `signup.html?next=…` with the intent already in sessionStorage. (Members page is `'authenticated'`-guarded — landing there logged-out would just bounce to login. Funneling through signup is more useful for marketing.)

3. **Register the binder.** Add `import './home';` to [`frontend-app/src/pages/binders.ts`](../../frontend-app/src/pages/binders.ts).

4. **`pages/members.ts` — read filters from the URL on first load.** Currently `bindMembers` starts with `state: SearchProfilesQuery = {}` and only updates state on form `submit` ([frontend-app/src/pages/members.ts:51-91](../../frontend-app/src/pages/members.ts#L51-L91)). Add a `readFiltersFromLocation()` helper that parses `URLSearchParams` into `SearchProfilesQuery`, seeds `state`, and reflects values back into the form controls before `runSearch()`. Whitelist of params honored on entry: `q`, `gender`, `seeking`, `country`, `city`, `profession`, `minAge`, `maxAge`, `sort`, `page`.

5. **Add `city` to `SearchProfilesQuery`** in [`frontend-app/src/types/api.ts`](../../frontend-app/src/types/api.ts) — `city?: string;` — and pass it through the existing `buildQueryString` in [`frontend-app/src/api/profilesApi.ts`](../../frontend-app/src/api/profilesApi.ts) (no code change there; it already iterates all keys).

6. **MSW handler update.** In [`frontend-app/src/mocks/handlers.ts`](../../frontend-app/src/mocks/handlers.ts), filter `/profiles/search` results by `city` (case-insensitive contains) and `profession` (case-insensitive equality) when those query params are present. Update fixture data ([`frontend-app/src/mocks/fixtures.ts`](../../frontend-app/src/mocks/fixtures.ts)) so a few profiles have non-null `city` and `profession` values matching the home-form dropdown labels.

7. **`pages/signup.ts` — replay search intent after signup.** After the verification banner clears and the user completes signup → verify → login, read `sessionStorage['turulav.searchIntent']`. If present and the user has no profession, PATCH `/profiles/me` with `{ profession: <intent.profession> }`, then `window.location.assign('members.html?profession=…&city=…')`, then clear the key. (Touching the signup binder is in-scope; the profile PATCH itself is the existing Slice 4 mutation.)

### 6.2 Files touched

```
frontend-app/src/
├── types/api.ts                 ← add city to SearchProfilesQuery
├── pages/home.ts                ← NEW
├── pages/binders.ts             ← + import './home'
├── pages/members.ts             ← read URL params on first load
├── pages/signup.ts              ← replay searchIntent post-signup
├── mocks/handlers.ts            ← filter by city + profession
└── mocks/fixtures.ts            ← seed city/profession on a few profiles

index.html                       ← rename inputs, add data-app-form, name="city"
```

No backend change strictly required for H1 if backend already accepts `city` (TBD §8.1) — frontend can send it; if backend ignores it, the page still works (just unfiltered by city).

### 6.3 Open contract questions answered before H1 ships

- **Does `/profiles/search` already accept `city`?** §8.1.
- **Are the 31 profession labels canonical?** §8.2.

---

## 7. UI mapping for H1

| Home-form input | Outgoing URL param | `SearchProfilesQuery` key | `members.ts` behavior |
|---|---|---|---|
| `select[name="profession"]` ("I am a") | *(not in URL)* | *(not sent)* | Ignored — UX-only; stored in `sessionStorage.searchIntent` for signup replay |
| `select[name="seekingProfession"]` ("Looking for") | `profession=<label>` | `profession` | Profession filter on the directory grid |
| `select[name="when"]` ("When") | *(not in URL)* | *(not sent)* | Ignored (decorative); stored in `sessionStorage.searchIntent` for the future availability slice |
| `input[name="city"]` ("City") | `city=<text>` | `city` | City filter on the directory grid |

Empty / `Select` / `0` values are dropped before serialization.

---

## 8. Open items (block follow-up)

| # | Item | Owner | Needed before |
|---|---|---|---|
| 8.1 | Confirm `/profiles/search` accepts `city`. If not, backend adds the WHERE clause and the index. | Backend | H1 ships against real backend (MSW is unblocked today) |
| 8.2 | Confirm the 31 profession labels match the backend's accepted values for `profile.profession`. If the backend wants a canonical enum, agree on one and update both `<option>` lists (here + members.html if added there) and the seed fixtures. | Backend + Frontend | H1 against real backend |
| 8.3 | Decide whether `availability` becomes a real profile field (powers the "When" filter) or stays decorative. Drives whether §9 Alternative A is scheduled. | Product | A follow-up "availability" slice — not H1 |
| 8.4 | Members page should pre-fill its own gender / seeking / age / country selects from `location.search` for parity with the home flow — already covered by §6.1 step 4 but verify visually. | Frontend | H1 acceptance test |
| 8.5 | When the home form is submitted unauthenticated, do we route to `signup.html` or `login.html`? Plan currently picks signup (funnel intent) — confirm with product. | Product | H1 ships |

---

## 9. Alternatives considered

**A. Add `availability` to the profile model now.** Backend gains a new column (likely `availability: 'today' \| 'within_3_days' \| 'within_month' \| 'within_year' \| 'open' \| null`), an index, a PATCH path on `/profiles/me`, and `availability` in `SearchProfilesQuery`. Profile-edit UI grows a control. Roughly doubles the H1 surface area but ships the full home form. **Rejected for H1** because every other field works without it; better to ship and add later.

**B. Render results in the banner instead of navigating.** Inject a grid below the form using the same `profilesApi.searchProfiles` query. **Rejected** — duplicates `members.ts` (pagination, verify banner, empty/loading states) and breaks the home page's layout rhythm. The marketing sections below the banner exist for a reason.

**C. Make the home form a static call-to-action that just links to `members.html` with no filters.** Simplest possible. **Rejected** — the home form is the most visible interaction surface in the product; throwing away the user's intent at the door is a wasted opportunity.

---

## 10. Definition of done for H1

- [ ] Submitting the home form with "Looking for" + "City" lands on `members.html?profession=…&city=…`, the form there reflects the values, and the grid is filtered.
- [ ] Submitting with empty fields lands on `members.html` with no filters.
- [ ] Unauthenticated submit lands on `signup.html`; after signup → verify → login the user is bounced to `members.html` with the original filters and their profession is patched onto their profile.
- [ ] Authenticated visitor sees their own profession pre-filled in "I am a" but the value doesn't appear in the URL.
- [ ] MSW round-trip works in `pnpm dev` with `VITE_USE_MOCKS=true`; same flows work against the real backend once §8.1 lands.
- [ ] No regressions on `members.html` direct entry (no query string) — still loads as before.

---

## 11. Change log

| Date | Change |
|---|---|
| 2026-05-15 | Plan created. Home form gap-analyzed against `SearchProfilesQuery`. H1 scoped: profession + city flow through; "I am a" stays UX-only; "When" deferred pending an `availability` model decision (§8.3). |
