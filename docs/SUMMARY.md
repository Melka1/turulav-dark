# TuruLav — Data Model Summary

Inventory of all models required to make the existing UI functional. Each entry names the model, its purpose, the fields/relations it needs, and which HTML page(s) it backs.

## Stack

- **Supabase** — Postgres database, Auth (email + JWT), Storage (photos/videos).
- **NestJS backend** — owns all business logic, algorithms, and orchestration. Frontend never talks to Supabase directly.

### Request flow

```
Browser (static HTML)
    │
    ▼
NestJS Backend  ──►  Supabase (Postgres / Auth / Storage)
    │
    └──► algorithms: matching, feed ranking, presence,
                     notifications, billing, moderation
```

Backend verifies Supabase JWTs, enforces business rules, then reads/writes via the service role key (or forwards the user JWT when RLS should apply).

---

## Core models

| # | Model | Backs | Doc |
|---|---|---|---|
| 1 | [User + Profile](./user/README.md) | `signup.html`, `login.html`, `profile.html`, `members.html`, presence/online indicators | ✅ drafted |
| 2 | [Media (Photo / Video / Music / Album)](./media/README.md) | `profile.html` Photos + Media tabs | ✅ drafted |
| 3 | Friendship | "Add Friends" button, Friends tab | — |
| 4 | Group + GroupMembership | `active-group.html`, Groups tab | — |
| 5 | [Post + Reaction + Comment + Favorite](./activity/README.md) | `profile.html` Activity tab | ✅ drafted |
| 6 | Conversation + Message | "Public / Private Message" actions | — |
| 7 | [BlogPost + BlogComment + Tag](./blog/README.md) | `blog.html`, `blog-single.html` | ✅ drafted |
| 8 | SubscriptionPlan + UserSubscription | `pricing-plan.html`, feature gating | — |
| 9 | ContactSubmission | `contact.html` | — |

### 1. User + Profile
Tightly coupled 1:1 pair, documented together because they share a lifecycle (created together on signup, cascade together on delete, gated together by onboarding).
- **User** (`auth.users` + `public.users`) — identity, auth, role, status, presence, deletion state.
- **Profile** (`public.profiles`) — dating-facing content: display name, gender, seeking, dob, location, bio, lifestyle (interests, smoking, drinking, languages, religion, children, relationship type, favorite places), physical (height, weight, hair/eye color, body type, ethnicity), profession, avatar + cover, visibility.

### 2. Media
User-uploaded photos, videos, music; optionally grouped into albums. Stored in Supabase Storage, metadata in Postgres.

### 3. Friendship
Directed edges with states: `pending` / `accepted` / `blocked`. Used for friend feeds, "Add Friends" action.

### 4. Group + GroupMembership
Community groups users join. Group has cover, description, member count; membership carries role + joined_at.

### 5. Post + Comment + Like
Activity feed / wall. Posts may attach media, mention users, belong to a group. Comments are recursive (parent_id). Likes are polymorphic (post / comment / blog post).

### 6. Conversation + Message
Direct messaging. Conversation links N participants; messages carry sender, body, read receipts. Public vs private distinction TBD (likely a visibility flag on post vs DM conversation).

### 7. BlogPost + BlogComment + Tag
Editorial blog content. Post `type` ∈ {image, video, carousel, code}. Comments threaded. Tags M:N.

### 8. SubscriptionPlan + UserSubscription
Tiers: Basic ($29), Silver ($290), Gold ($390). Each plan defines feature flags (directory access, messaging, media upload, activity view). Subscription tracks status + expiry per user.

### 9. ContactSubmission
Raw capture of contact form: name, email, subject, phone, message.

---

## Cross-cutting models

- **Notification** — new messages, friend requests, likes, group invites, mentions, blog-comment replies.
- **Report / Block** — safety + moderation. Blocks hide profiles and prevent DMs.
- **Session / AuthToken** — owned by Supabase Auth; backend only verifies JWTs.
- **Match / Like / Pass** — *open question*: current template is social-network style (browse + friend + DM). If a Tinder-style swipe/match flow is wanted, this becomes a first-class model.

---

## Open questions

1. **Matching model** — browse-and-friend (template default) vs. swipe/match? Affects whether Match/Like/Pass exists.
2. **Media storage** — Supabase Storage buckets (default) or external S3?
3. **Realtime** — Supabase Realtime for presence + chat, or NestJS gateway (socket.io) in backend?
4. **Moderation depth** — admin console scope, auto-moderation (profanity, NSFW image detection)?

---

## Next

Each model gets its own `docs/<model>/README.md` with schema, RLS, endpoints, and implementation plan. Start: [docs/user/README.md](./user/README.md).
