import { http, HttpResponse, delay } from 'msw';
import { env } from '@/env';
import {
  allComments,
  allGroups,
  allPosts,
  allRecords,
  createUser,
  favoritesForUser,
  findByAccessToken,
  findByEmail,
  findById,
  findByRefreshToken,
  findByUsername,
  findComment,
  findFavorite,
  findFriendship,
  findGroupById,
  findPost,
  friendsOf,
  groupsForUser,
  groupsJoinedByUser,
  insertComment,
  insertFavorite,
  insertPost,
  issueSession,
  makeCommentId,
  makePostId,
  membershipFor,
  reactionsFor,
  removeFavoriteRow,
  removeFriendship,
  removeReactionRow,
  rotateAccessToken,
  upsertFriendship,
  upsertReaction,
  type StoredComment,
  type StoredPost,
} from './fixtures';
import type {
  ActivityFeedResponseData,
  ActivityLens,
  ActivitySort,
  ApiSuccessEnvelope,
  CommentDto,
  CommentsListResponseData,
  CreateCommentRequest,
  FriendItemDto,
  FriendshipStatus,
  FriendshipStatusDto,
  FriendsListResponseData,
  FriendSuggestionItemDto,
  FriendSuggestionsResponseData,
  GroupDto,
  LoginRequest,
  LoginResponseData,
  PostAttachmentDto,
  RefreshRequest,
  RefreshResponseData,
  PostAudience,
  PostAuthorDto,
  PostDto,
  PostMentionDto,
  ProfileWithUserDto,
  PublicProfileDto,
  PublicUserDto,
  ReactionRequest,
  ReactionSummaryDto,
  ReactionType,
  GroupSuggestionItemDto,
  GroupSuggestionsResponseData,
  SearchGroupsResponseData,
  SearchProfilesResponseData,
  SendFriendRequestBody,
  SignupRequest,
  SignupResponseData,
  UpdateCommentRequest,
  UpdatePostRequest,
  UserMediaItemDto,
  UserWithProfileDto,
} from '@/types/api';

const url = (path: string): string => `${env.backendUrl}${path}`;

function meta(path: string) {
  return {
    timestamp: new Date().toISOString(),
    path,
    requestId: crypto.randomUUID(),
  };
}

function ok<T>(path: string, data: T, status = 200) {
  const body: ApiSuccessEnvelope<T> = { success: true, data, meta: meta(path) };
  return HttpResponse.json(body, { status });
}

type NestErrorBody = {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
  requestId: string;
};

function nestError(
  status: number,
  errorName: string,
  message: string | string[],
  path: string,
) {
  const body: NestErrorBody = {
    statusCode: status,
    message,
    error: errorName,
    path,
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  };
  return HttpResponse.json(body, { status });
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function numberOrNull(value: string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Avatars of users that joined `groupId`, skipping records without one. */
function membersOfGroupAvatars(groupId: string): string[] {
  return allRecords()
    .filter((r) => groupsJoinedByUser(r.user.id).includes(groupId))
    .map((r) => r.profile.avatarUrl)
    .filter((url): url is string => !!url);
}

/** Coarse band the real backend returns when the exact count is hidden. */
function countBand(count: number): string {
  if (count < 10) return '<10';
  if (count < 50) return '<50';
  if (count < 100) return '<100';
  if (count < 500) return '<500';
  if (count < 1000) return '<1k';
  return '1k+';
}

/**
 * Fills `memberAvatars` / `extraMembersBand` from current memberships so the
 * mock mirrors the real backend's projection. Up to 6 avatars in the stack;
 * anything left over becomes a "+N" band tile.
 */
function decorateGroup(g: GroupDto): GroupDto {
  const avatars = membersOfGroupAvatars(g.id).slice(0, 6);
  const extra = Math.max(0, g.memberCount - avatars.length);
  return {
    ...g,
    memberAvatars: avatars,
    extraMembersBand: extra > 0 ? `${extra}+` : null,
  };
}

function statusBetween(viewerId: string, partnerId: string): FriendshipStatus {
  if (viewerId === partnerId) return 'none';
  const f = findFriendship(viewerId, partnerId);
  if (!f) return 'none';
  if (f.status === 'accepted') return 'accepted';
  return f.initiatedBy === viewerId ? 'pending_out' : 'pending_in';
}

function orderedFriendshipPair(
  a: string,
  b: string,
): { userLow: string; userHigh: string } {
  return a < b
    ? { userLow: a, userHigh: b }
    : { userLow: b, userHigh: a };
}

/**
 * The route param is either a plain userId (the partner) or `"<low>:<high>"`
 * (URL-encoded). Return the partner's userId from the viewer's POV.
 */
function resolvePartnerId(viewerId: string, raw: string): string {
  const decoded = decodeURIComponent(raw);
  if (decoded.includes(':')) {
    const [lo, hi] = decoded.split(':');
    if (lo && hi) return lo === viewerId ? hi : lo;
  }
  return decoded;
}

function yearsSince(dob: string): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return 0;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

// ============ Media helpers ============

const MOCK_PHOTOS = Array.from({ length: 20 }, (_, i) => {
  const idx = String(i + 1).padStart(2, '0');
  return `/assets/images/member/${idx}.jpg`;
});

function mockMediaFor(userId: string): UserMediaItemDto[] {
  // Deterministic per-user slice so reloads stay stable.
  const seed = Array.from(userId).reduce(
    (acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0,
    0,
  );
  const count = 8 + (seed % 8); // 8..15 items
  const items: UserMediaItemDto[] = [];
  for (let i = 0; i < count; i++) {
    const url = MOCK_PHOTOS[(seed + i * 7) % MOCK_PHOTOS.length]!;
    items.push({
      id: `mock-media-${userId}-${i}`,
      kind: 'photo',
      url,
      thumbnailUrl: url,
      width: 800,
      height: 800,
      durationSeconds: null,
      caption: null,
      createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    });
  }
  return items;
}

// ============ Activity helpers ============

const REACTION_TYPES: readonly ReactionType[] = [
  'like',
  'heart',
  'laugh',
  'wow',
  'sad',
  'angry',
];
const POST_AUDIENCES: readonly PostAudience[] = [
  'public',
  'friends',
  'private',
  'group',
];

function requireViewer(
  request: Request,
  path: string,
):
  | { ok: true; viewer: NonNullable<ReturnType<typeof findByAccessToken>> }
  | { ok: false; response: ReturnType<typeof nestError> } {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const viewer = token ? findByAccessToken(token) : undefined;
  if (!viewer) {
    return {
      ok: false,
      response: nestError(401, 'UnauthorizedException', 'Unauthorized', path),
    };
  }
  if (viewer.emailConfirmedAt === null) {
    return {
      ok: false,
      response: nestError(
        403,
        'ForbiddenException',
        'Email verification required',
        path,
      ),
    };
  }
  return { ok: true, viewer };
}

function postAuthorDto(userId: string): PostAuthorDto {
  const record = findById(userId);
  if (!record) {
    return {
      userId,
      username: 'unknown',
      displayName: 'Unknown',
      avatarUrl: null,
    };
  }
  return {
    userId: record.user.id,
    username: record.user.username,
    displayName: record.profile.displayName || record.user.username,
    avatarUrl: record.profile.avatarUrl,
  };
}

function buildReactionSummary(
  postId: string,
  viewerId: string,
): ReactionSummaryDto {
  const rows = reactionsFor(postId);
  const byType: Partial<Record<ReactionType, number>> = {};
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
  }
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const topActors = sorted.slice(0, 2).map((r) => postAuthorDto(r.userId));
  const mine = rows.find((r) => r.userId === viewerId);
  return {
    total: rows.length,
    byType,
    topActors,
    viewerReaction: mine ? mine.type : null,
  };
}

function buildPostDto(post: StoredPost, viewerId: string): PostDto {
  const isDeleted = post.deletedAt !== null;
  const commentCount = allComments().filter(
    (c) => c.postId === post.id && c.deletedAt === null,
  ).length;
  const group = post.groupId ? findGroupById(post.groupId) ?? null : null;
  return {
    id: post.id,
    author: postAuthorDto(post.authorId),
    audience: post.audience,
    group: group
      ? { id: group.id, slug: group.slug, name: group.name }
      : null,
    body: isDeleted ? null : post.body,
    attachments: isDeleted ? [] : post.attachments,
    mentions: isDeleted ? [] : post.mentions,
    reactionSummary: buildReactionSummary(post.id, viewerId),
    commentCount,
    viewerFavorited: Boolean(findFavorite(post.id, viewerId)),
    isDeleted,
    editedAt: post.editedAt,
    createdAt: post.createdAt,
  };
}

function buildCommentDto(c: StoredComment): CommentDto {
  const replyCount = allComments().filter(
    (r) => r.parentId === c.id && r.deletedAt === null,
  ).length;
  return {
    id: c.id,
    postId: c.postId,
    parentId: c.parentId,
    author: postAuthorDto(c.authorId),
    body: c.deletedAt === null ? c.body : null,
    replyCount,
    isDeleted: c.deletedAt !== null,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
  };
}

function canViewerSeePost(post: StoredPost, viewerId: string): boolean {
  if (post.authorId === viewerId) return true;
  if (post.deletedAt !== null) return false;
  if (post.audience === 'public') return true;
  if (post.audience === 'private') return false;
  if (post.audience === 'friends') {
    // Friendship branch is "parked" until Friendship slice is live — but the
    // mock backend includes Friendship, so we honor it.
    const f = findFriendship(post.authorId, viewerId);
    return Boolean(f && f.status === 'accepted');
  }
  if (post.audience === 'group') {
    if (!post.groupId) return false;
    return membershipFor(viewerId, post.groupId);
  }
  return false;
}

function extractMentions(body: string): PostMentionDto[] {
  const out: PostMentionDto[] = [];
  const seen = new Set<string>();
  const re = /@([a-zA-Z0-9_-]{3,24})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const lower = m[1]!.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const record = findByUsername(m[1]!);
    if (record) {
      out.push({
        userId: record.user.id,
        username: record.user.username,
      });
    }
  }
  return out;
}

function decodeCursor(
  cursor: string | null,
): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const json = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as {
      createdAt?: string;
      id?: string;
    };
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function encodeCursor(post: StoredPost): string {
  const json = JSON.stringify({ createdAt: post.createdAt, id: post.id });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function popularityScore(post: StoredPost): number {
  const reactionCount = reactionsFor(post.id).length;
  const commentCount = allComments().filter(
    (c) => c.postId === post.id && c.deletedAt === null,
  ).length;
  const ageMs = Date.now() - Date.parse(post.createdAt);
  const decay = Math.exp(-ageMs / (7 * 24 * 60 * 60 * 1000));
  return (reactionCount + 2 * commentCount) * decay;
}

function lensFilter(
  posts: StoredPost[],
  lens: ActivityLens,
  targetUserId: string,
  viewerId: string,
): StoredPost[] {
  switch (lens) {
    case 'personal':
      return posts.filter((p) => p.authorId === targetUserId);
    case 'mentions':
      return posts.filter((p) =>
        p.mentions.some((m) => m.userId === targetUserId),
      );
    case 'favorites': {
      if (targetUserId !== viewerId) return [];
      const favIds = new Set(
        favoritesForUser(viewerId).map((f) => f.postId),
      );
      return posts.filter((p) => favIds.has(p.id));
    }
    case 'friends': {
      if (targetUserId !== viewerId) return [];
      const friendIds = new Set(
        friendsOf(viewerId).map((r) => r.user.id),
      );
      return posts.filter((p) => friendIds.has(p.authorId));
    }
    case 'groups': {
      if (targetUserId !== viewerId) return [];
      const groupIds = new Set(groupsJoinedByUser(viewerId));
      return posts.filter(
        (p) => p.audience === 'group' && p.groupId && groupIds.has(p.groupId),
      );
    }
    default:
      return [];
  }
}

function paginateFeed(
  filtered: StoredPost[],
  sort: ActivitySort,
  cursor: string | null,
  limit: number,
  viewerId: string,
): ActivityFeedResponseData {
  let ordered: StoredPost[];
  if (sort === 'popular') {
    ordered = [...filtered].sort((a, b) => {
      const diff = popularityScore(b) - popularityScore(a);
      if (diff !== 0) return diff;
      return a.id < b.id ? 1 : -1;
    });
  } else {
    ordered = [...filtered].sort((a, b) => {
      const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (diff !== 0) return diff;
      return a.id < b.id ? 1 : -1;
    });
  }

  const decoded = decodeCursor(cursor);
  if (decoded && (sort === 'recent' || sort === 'relevant')) {
    const cutoff = Date.parse(decoded.createdAt);
    ordered = ordered.filter((p) => {
      const ts = Date.parse(p.createdAt);
      if (ts < cutoff) return true;
      if (ts === cutoff) return p.id < decoded.id;
      return false;
    });
  }

  const page = ordered.slice(0, limit);
  const nextCursor =
    page.length === limit && ordered.length > limit
      ? encodeCursor(page[page.length - 1]!)
      : null;

  const items = page.map((p) => buildPostDto(p, viewerId));
  return { items, nextCursor };
}

export const handlers = [
  http.get(url('/__msw_ping'), () => HttpResponse.json({ ok: true, via: 'msw' })),

  http.post(url('/auth/signup'), async ({ request }) => {
    await delay(200);
    const path = '/api/v1/auth/signup';
    const body = (await request.json().catch(() => null)) as SignupRequest | null;

    if (!body) {
      return nestError(400, 'Bad Request', 'Body must be JSON.', path);
    }

    const messages: string[] = [];
    if (!body.email || !EMAIL_RE.test(body.email)) {
      messages.push('email must be an email');
    }
    if (!body.password || body.password.length < 8) {
      messages.push('password must be longer than or equal to 8 characters');
    }
    if (!body.username || !USERNAME_RE.test(body.username)) {
      messages.push(
        'Username must be 3–24 chars, letters/digits/underscore/hyphen',
      );
    }
    if (messages.length > 0) {
      return nestError(400, 'Bad Request', messages, path);
    }

    if (findByUsername(body.username)) {
      return nestError(409, 'Conflict', 'Username already taken', path);
    }
    if (findByEmail(body.email)) {
      return nestError(409, 'Conflict', 'Email already taken', path);
    }

    const record = createUser(body);
    const data: SignupResponseData = {
      userId: record.user.id,
      emailConfirmationRequired: true,
    };
    return ok(path, data, 201);
  }),

  http.post(url('/auth/login'), async ({ request }) => {
    await delay(200);
    const path = '/api/v1/auth/login';
    const body = (await request.json().catch(() => null)) as LoginRequest | null;
    if (!body || !body.email || !body.password) {
      return nestError(401, 'Unauthorized', 'Invalid credentials', path);
    }
    const record = findByEmail(body.email);
    // Mirror real backend: every failure case returns the same 401 to avoid
    // leaking which factor was wrong (or that the user is unverified).
    if (
      !record ||
      record.password !== body.password ||
      record.emailConfirmedAt === null
    ) {
      return nestError(401, 'Unauthorized', 'Invalid credentials', path);
    }
    if (record.user.accountStatus === 'deleted') {
      return nestError(403, 'Forbidden', 'Account is deleted', path);
    }
    if (record.user.accountStatus === 'suspended') {
      return nestError(403, 'Forbidden', 'Account is suspended', path);
    }
    if (record.user.accountStatus === 'banned') {
      return nestError(403, 'Forbidden', 'Account is banned', path);
    }
    const session = issueSession(record);
    const data: LoginResponseData = { userId: record.user.id, session };
    return ok(path, data, 200);
  }),

  http.get(url('/profiles/search'), ({ request }) => {
    const path = `/api/v1${new URL(request.url).pathname.replace(/^.*\/api\/v1/, '')}`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (viewer.emailConfirmedAt === null) {
      return nestError(403, 'ForbiddenException', 'Email verification required', path);
    }

    const params = new URL(request.url).searchParams;
    const q = params.get('q')?.toLowerCase() ?? '';
    const gender = params.get('gender');
    const seeking = params.get('seeking');
    const interestsParam = params.get('interests');
    const interests = interestsParam ? interestsParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const country = params.get('country')?.toLowerCase() ?? '';
    const city = params.get('city')?.toLowerCase() ?? '';
    const profession = params.get('profession')?.toLowerCase() ?? '';
    const minAge = numberOrNull(params.get('minAge'));
    const maxAge = numberOrNull(params.get('maxAge'));
    const onlineOnly = params.get('online') === 'true';
    const sort = params.get('sort');
    const page = Math.max(1, numberOrNull(params.get('page')) ?? 1);
    const limit = Math.min(100, Math.max(1, numberOrNull(params.get('limit')) ?? 20));

    const all = allRecords()
      .filter((r) => r.user.id !== viewer.user.id) // exclude self
      .filter((r) => r.user.accountStatus === 'active' && r.profile.visibility !== 'private');

    const matches = all.filter((r) => {
      if (q && !`${r.profile.displayName} ${r.user.username} ${r.profile.bio ?? ''}`.toLowerCase().includes(q))
        return false;
      if (gender && r.profile.gender !== gender) return false;
      if (seeking && !r.profile.seeking.includes(seeking)) return false;
      if (country && (r.profile.country ?? '').toLowerCase() !== country) return false;
      if (city && !(r.profile.city ?? '').toLowerCase().includes(city)) return false;
      if (profession && (r.profile.profession ?? '').toLowerCase() !== profession) return false;
      if (interests.length > 0 && !interests.every((i) => r.profile.interests.includes(i)))
        return false;
      if (onlineOnly && !r.user.isOnline) return false;
      if (minAge != null || maxAge != null) {
        if (!r.profile.dob) return false;
        const age = yearsSince(r.profile.dob);
        if (minAge != null && age < minAge) return false;
        if (maxAge != null && age > maxAge) return false;
      }
      return true;
    });

    if (sort === 'most_active') {
      matches.sort((a, b) => {
        const ta = a.user.lastActiveAt ? Date.parse(a.user.lastActiveAt) : 0;
        const tb = b.user.lastActiveAt ? Date.parse(b.user.lastActiveAt) : 0;
        return tb - ta;
      });
    }

    const start = (page - 1) * limit;
    const slice = matches.slice(start, start + limit);
    const items: ProfileWithUserDto[] = slice.map((r) => {
      const { dob: _dob, visibility: _vis, createdAt: _ca, updatedAt: _ua, completionScore, ...rest } = r.profile;
      return {
        ...rest,
        username: r.user.username,
        isOnline: r.user.isOnline,
        lastActiveAt: r.user.lastActiveAt,
        completionScore,
      };
    });
    const data: SearchProfilesResponseData = {
      items,
      total: matches.length,
      page,
      limit,
    };
    return ok(path, data);
  }),

  http.get(url('/users/me'), ({ request }) => {
    const path = '/api/v1/users/me';
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const record = token ? findByAccessToken(token) : undefined;
    if (!record) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    const data: UserWithProfileDto = { ...record.user, profile: record.profile };
    return ok(path, data);
  }),

  http.get(url('/users/:id'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/users/${id}`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (viewer.emailConfirmedAt === null) {
      return nestError(403, 'ForbiddenException', 'Email verification required', path);
    }
    const record = findById(id);
    if (!record || record.user.accountStatus !== 'active') {
      return nestError(404, 'NotFoundException', 'User not found', path);
    }
    const data: PublicUserDto = {
      id: record.user.id,
      username: record.user.username,
      isOnline: record.user.isOnline,
      lastActiveAt: record.user.lastActiveAt,
      createdAt: record.user.createdAt,
    };
    return ok(path, data);
  }),

  http.get(url('/profiles/:userId'), ({ params, request }) => {
    const userId = String(params.userId);
    const path = `/api/v1/profiles/${userId}`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (viewer.emailConfirmedAt === null) {
      return nestError(403, 'ForbiddenException', 'Email verification required', path);
    }
    const record = findById(userId);
    if (
      !record ||
      record.user.accountStatus !== 'active' ||
      record.profile.visibility === 'private'
    ) {
      return nestError(404, 'NotFoundException', 'Profile not found', path);
    }
    const { address: _addr, visibility: _vis, ...rest } = record.profile;
    const data: PublicProfileDto = rest;
    return ok(path, data);
  }),

  http.post(url('/auth/logout'), () => new HttpResponse(null, { status: 204 })),

  http.post(url('/auth/refresh'), async ({ request }) => {
    await delay(100);
    const path = '/api/v1/auth/refresh';
    const body = (await request
      .json()
      .catch(() => null)) as RefreshRequest | null;
    if (!body?.refreshToken) {
      return nestError(401, 'Unauthorized', 'Invalid refresh token', path);
    }
    const record = findByRefreshToken(body.refreshToken);
    if (!record || !record.session) {
      return nestError(401, 'Unauthorized', 'Invalid refresh token', path);
    }
    const session = rotateAccessToken(record);
    const data: RefreshResponseData = { session };
    return ok(path, data, 200);
  }),

  http.get(url('/groups/search'), ({ request }) => {
    const path = '/api/v1/groups/search';
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (viewer.emailConfirmedAt === null) {
      return nestError(403, 'ForbiddenException', 'Email verification required', path);
    }

    const params = new URL(request.url).searchParams;
    const q = params.get('q')?.toLowerCase() ?? '';
    const country = params.get('country')?.toLowerCase() ?? '';
    const city = params.get('city')?.toLowerCase() ?? '';
    const visibility = params.get('visibility');
    const joinPolicy = params.get('joinPolicy');
    const interestsParam = params.get('interests');
    const interests = interestsParam
      ? interestsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const page = Math.max(1, numberOrNull(params.get('page')) ?? 1);
    const limit = Math.min(
      100,
      Math.max(1, numberOrNull(params.get('limit')) ?? 20),
    );

    const matches = allGroups()
      .filter((g) => g.deletedAt === null && g.adminSuspendedAt === null)
      .filter((g) => {
        if (q && !`${g.name} ${g.description ?? ''}`.toLowerCase().includes(q))
          return false;
        if (country && (g.country ?? '').toLowerCase() !== country) return false;
        if (city && (g.city ?? '').toLowerCase() !== city) return false;
        if (visibility && g.visibility !== visibility) return false;
        if (joinPolicy && g.joinPolicy !== joinPolicy) return false;
        if (interests.length > 0 && !interests.every((i) => g.interests.includes(i)))
          return false;
        return true;
      });

    const start = (page - 1) * limit;
    const slice = matches.slice(start, start + limit).map(decorateGroup);
    const data: SearchGroupsResponseData = {
      items: slice,
      total: matches.length,
      page,
      limit,
    };
    return ok(path, data);
  }),

  http.get(url('/groups/me'), ({ request }) => {
    const path = '/api/v1/groups/me';
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    const mine: GroupDto[] = groupsForUser(viewer.user.id).map(decorateGroup);
    return ok(path, mine);
  }),

  http.get(url('/groups/suggestions'), ({ request }) => {
    const path = '/api/v1/groups/suggestions';
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }

    const params = new URL(request.url).searchParams;
    const limit = Math.min(
      50,
      Math.max(1, numberOrNull(params.get('limit')) ?? 20),
    );

    const joined = new Set(groupsJoinedByUser(viewer.user.id));
    const pool = allGroups().filter(
      (g) =>
        g.deletedAt === null &&
        g.adminSuspendedAt === null &&
        g.visibility !== 'private' &&
        !joined.has(g.id),
    );
    const slice = pool.slice(0, limit);
    const items: GroupSuggestionItemDto[] = slice.map((g) => {
      const avatars = membersOfGroupAvatars(g.id).slice(0, 6);
      const extra = Math.max(0, g.memberCount - avatars.length);
      return {
        tier: 'guest',
        id: g.id,
        slug: g.slug,
        name: g.name,
        description: g.description,
        rules: g.rules,
        avatarUrl: g.avatarUrl,
        coverUrl: g.coverUrl,
        visibility: g.visibility,
        joinPolicy: g.joinPolicy,
        interests: g.interests,
        country: g.country,
        city: g.city,
        ownerId: g.ownerId,
        memberCount: g.memberCount,
        memberCountBand: countBand(g.memberCount),
        maxMembers: g.maxMembers,
        memberAvatars: avatars,
        extraMembersBand: extra > 0 ? `${extra}+` : null,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      };
    });
    const data: GroupSuggestionsResponseData = {
      items,
      total: pool.length,
      page: 1,
      limit,
    };
    return ok(path, data);
  }),

  http.get(url('/friends'), ({ request }) => {
    const path = '/api/v1/friends';
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }

    const params = new URL(request.url).searchParams;
    const q = params.get('q')?.toLowerCase() ?? '';
    const country = params.get('country')?.toLowerCase() ?? '';
    const sort = params.get('sort');
    const page = Math.max(1, numberOrNull(params.get('page')) ?? 1);
    const limit = Math.min(
      100,
      Math.max(1, numberOrNull(params.get('limit')) ?? 20),
    );

    const all = friendsOf(viewer.user.id);
    const matches = all.filter((r) => {
      if (
        q &&
        !`${r.profile.displayName} ${r.user.username} ${r.profile.bio ?? ''}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      if (country && (r.profile.country ?? '').toLowerCase() !== country)
        return false;
      return true;
    });

    if (sort === 'recent') {
      matches.sort((a, b) => {
        const ta = a.user.lastActiveAt ? Date.parse(a.user.lastActiveAt) : 0;
        const tb = b.user.lastActiveAt ? Date.parse(b.user.lastActiveAt) : 0;
        return tb - ta;
      });
    } else {
      matches.sort((a, b) =>
        (a.profile.displayName || a.user.username).localeCompare(
          b.profile.displayName || b.user.username,
        ),
      );
    }

    const start = (page - 1) * limit;
    const slice = matches.slice(start, start + limit);
    const items: FriendItemDto[] = slice.map((r) => ({
      id: r.user.id,
      username: r.user.username,
      displayName: r.profile.displayName || r.user.username,
      avatarUrl: r.profile.avatarUrl,
      isOnline: r.user.isOnline,
      lastActiveAt: r.user.lastActiveAt,
      friendCount: friendsOf(r.user.id).length,
      gender: r.profile.gender,
      dob: r.profile.dob,
      country: r.profile.country,
      city: r.profile.city,
      bio: r.profile.bio,
    }));
    const data: FriendsListResponseData = {
      items,
      total: matches.length,
      page,
      limit,
    };
    return ok(path, data);
  }),

  http.get(url('/friends/suggestions'), ({ request }) => {
    const path = '/api/v1/friends/suggestions';
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }

    const params = new URL(request.url).searchParams;
    const limit = Math.min(
      50,
      Math.max(1, numberOrNull(params.get('limit')) ?? 9),
    );

    // Surface anyone other than the viewer and their existing friends —
    // mock-quality ranking, the real backend uses graph + interest signals.
    const friendIds = new Set(friendsOf(viewer.user.id).map((r) => r.user.id));
    const pool = allRecords().filter(
      (r) => r.user.id !== viewer.user.id && !friendIds.has(r.user.id),
    );
    const items: FriendSuggestionItemDto[] = pool.slice(0, limit).map((r) => ({
      id: r.user.id,
      username: r.user.username,
      displayName: r.profile.displayName || r.user.username,
      avatarUrl: r.profile.avatarUrl,
      isOnline: r.user.isOnline,
      lastActiveAt: r.user.lastActiveAt,
      friendCount: friendsOf(r.user.id).length,
      gender: r.profile.gender,
      dob: r.profile.dob,
      country: r.profile.country,
      city: r.profile.city,
      bio: r.profile.bio,
      mutuals: 0,
    }));
    const data: FriendSuggestionsResponseData = { items };
    return ok(path, data);
  }),

  http.get(url('/friends/:userId'), ({ params, request }) => {
    const targetId = String(params.userId);
    const path = `/api/v1/friends/${targetId}`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (!findById(targetId)) {
      return nestError(404, 'NotFoundException', 'User not found', path);
    }
    const status = statusBetween(viewer.user.id, targetId);
    const data: FriendshipStatusDto = { status };
    return ok(path, data);
  }),

  http.post(url('/friends/requests'), async ({ request }) => {
    const path = '/api/v1/friends/requests';
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (viewer.emailConfirmedAt === null) {
      return nestError(
        403,
        'ForbiddenException',
        'Email verification required',
        path,
      );
    }
    const body = (await request.json().catch(() => null)) as
      | SendFriendRequestBody
      | null;
    if (!body || !body.targetUserId) {
      return nestError(400, 'Bad Request', 'targetUserId is required', path);
    }
    if (body.targetUserId === viewer.user.id) {
      return nestError(400, 'Bad Request', 'Cannot friend yourself', path);
    }
    const target = findById(body.targetUserId);
    if (!target) {
      return nestError(404, 'NotFoundException', 'User not found', path);
    }
    const existing = findFriendship(viewer.user.id, body.targetUserId);
    if (existing) {
      return nestError(
        409,
        'Conflict',
        existing.status === 'accepted'
          ? 'Already friends'
          : 'Request already exists',
        path,
      );
    }
    upsertFriendship({
      ...orderedFriendshipPair(viewer.user.id, body.targetUserId),
      status: 'pending',
      initiatedBy: viewer.user.id,
      message: body.message ?? null,
      createdAt: new Date().toISOString(),
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(url('/friends/requests/:id/accept'), ({ params, request }) => {
    const rawId = String(params.id);
    const path = `/api/v1/friends/requests/${rawId}/accept`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (viewer.emailConfirmedAt === null) {
      return nestError(
        403,
        'ForbiddenException',
        'Email verification required',
        path,
      );
    }
    const partnerId = resolvePartnerId(viewer.user.id, rawId);
    const f = findFriendship(viewer.user.id, partnerId);
    if (!f || f.status !== 'pending') {
      return nestError(404, 'NotFoundException', 'Request not found', path);
    }
    if (f.initiatedBy === viewer.user.id) {
      return nestError(
        403,
        'ForbiddenException',
        'Only the recipient can accept',
        path,
      );
    }
    f.status = 'accepted';
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(url('/friends/requests/:id/decline'), ({ params, request }) => {
    const rawId = String(params.id);
    const path = `/api/v1/friends/requests/${rawId}/decline`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    const partnerId = resolvePartnerId(viewer.user.id, rawId);
    const f = findFriendship(viewer.user.id, partnerId);
    if (!f || f.status !== 'pending' || f.initiatedBy === viewer.user.id) {
      return nestError(404, 'NotFoundException', 'Request not found', path);
    }
    removeFriendship(viewer.user.id, partnerId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete(url('/friends/requests/:id'), ({ params, request }) => {
    const rawId = String(params.id);
    const path = `/api/v1/friends/requests/${rawId}`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    const partnerId = resolvePartnerId(viewer.user.id, rawId);
    const f = findFriendship(viewer.user.id, partnerId);
    if (!f || f.status !== 'pending' || f.initiatedBy !== viewer.user.id) {
      return nestError(404, 'NotFoundException', 'Request not found', path);
    }
    removeFriendship(viewer.user.id, partnerId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete(url('/friends/:userId'), ({ params, request }) => {
    const partnerId = String(params.userId);
    const path = `/api/v1/friends/${partnerId}`;
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const viewer = token ? findByAccessToken(token) : undefined;
    if (!viewer) {
      return nestError(401, 'UnauthorizedException', 'Unauthorized', path);
    }
    if (viewer.emailConfirmedAt === null) {
      return nestError(
        403,
        'ForbiddenException',
        'Email verification required',
        path,
      );
    }
    const f = findFriendship(viewer.user.id, partnerId);
    if (!f || f.status !== 'accepted') {
      return nestError(404, 'NotFoundException', 'Friendship not found', path);
    }
    removeFriendship(viewer.user.id, partnerId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(url('/auth/resend-verification'), async ({ request }) => {
    await delay(150);
    const path = '/api/v1/auth/resend-verification';
    const body = (await request.json().catch(() => null)) as {
      email?: string;
    } | null;
    if (!body?.email) {
      return nestError(400, 'Bad Request', 'email is required', path);
    }
    // Always 204 — don't reveal whether the address exists.
    return new HttpResponse(null, { status: 204 });
  }),

  // ============ Activity feed ============
  http.get(url('/users/me/favorites'), ({ request }) => {
    const path = '/api/v1/users/me/favorites';
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const params = new URL(request.url).searchParams;
    const cursor = params.get('cursor');
    const limit = Math.min(
      50,
      Math.max(1, numberOrNull(params.get('limit')) ?? 20),
    );
    const sortRaw = params.get('sort');
    const sort: ActivitySort =
      sortRaw === 'popular' || sortRaw === 'relevant' ? sortRaw : 'recent';

    const favIds = new Set(favoritesForUser(viewer.user.id).map((f) => f.postId));
    const visible = allPosts().filter(
      (p) => favIds.has(p.id) && canViewerSeePost(p, viewer.user.id),
    );
    const data = paginateFeed(visible, sort, cursor, limit, viewer.user.id);
    return ok(path, data);
  }),

  http.get(url('/users/:userId/activity'), ({ params, request }) => {
    const userId = String(params.userId);
    const path = `/api/v1/users/${userId}/activity`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;

    const target =
      userId === 'me' ? viewer : findById(userId);
    if (!target) {
      return nestError(404, 'NotFoundException', 'User not found', path);
    }

    const query = new URL(request.url).searchParams;
    const lensRaw = query.get('lens');
    const lens: ActivityLens =
      lensRaw === 'mentions' ||
      lensRaw === 'favorites' ||
      lensRaw === 'friends' ||
      lensRaw === 'groups'
        ? lensRaw
        : 'personal';
    const sortRaw = query.get('sort');
    const sort: ActivitySort =
      sortRaw === 'popular' || sortRaw === 'relevant' ? sortRaw : 'recent';
    const cursor = query.get('cursor');
    const limit = Math.min(
      50,
      Math.max(1, numberOrNull(query.get('limit')) ?? 20),
    );

    // Favorites/friends/groups lenses are viewer-private — only the user
    // themselves can read them.
    if (
      (lens === 'favorites' || lens === 'friends' || lens === 'groups') &&
      target.user.id !== viewer.user.id
    ) {
      return nestError(403, 'ForbiddenException', 'Forbidden', path);
    }

    const filtered = lensFilter(
      allPosts(),
      lens,
      target.user.id,
      viewer.user.id,
    ).filter((p) => canViewerSeePost(p, viewer.user.id));

    const data = paginateFeed(filtered, sort, cursor, limit, viewer.user.id);
    return ok(path, data);
  }),

  // ============ User media (Photos + Media tabs) ============
  http.get(url('/users/:userId/media'), ({ params, request }) => {
    const userId = String(params.userId);
    const path = `/api/v1/users/${userId}/media`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;

    const target = userId === 'me' ? viewer : findById(userId);
    if (!target) {
      return nestError(404, 'NotFoundException', 'User not found', path);
    }

    const query = new URL(request.url).searchParams;
    const kindRaw = query.get('kind');
    const kind = kindRaw === 'photo' || kindRaw === 'video' ? kindRaw : null;
    const limit = Math.min(
      50,
      Math.max(1, numberOrNull(query.get('limit')) ?? 20),
    );

    const all = mockMediaFor(target.user.id);
    const filtered = kind ? all.filter((m) => m.kind === kind) : all;
    const items = filtered.slice(0, limit);
    return ok(path, { items, nextCursor: null });
  }),

  // ============ Posts CRUD ============
  http.post(url('/posts'), async ({ request }) => {
    const path = '/api/v1/posts';
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;

    const form = await request.formData().catch(() => null);
    if (!form) {
      return nestError(
        400,
        'Bad Request',
        'Body must be multipart/form-data.',
        path,
      );
    }
    const bodyText = String(form.get('body') ?? '');
    const audienceRaw = String(form.get('audience') ?? '');
    const groupIdRaw = form.get('groupId');
    const groupId = typeof groupIdRaw === 'string' && groupIdRaw !== ''
      ? groupIdRaw
      : null;
    const files = form
      .getAll('files')
      .filter((v): v is File => v instanceof File);

    if (bodyText.trim() === '' && files.length === 0) {
      return nestError(
        400,
        'Bad Request',
        'body or files must be provided',
        path,
      );
    }
    if (bodyText.length > 5000) {
      return nestError(
        400,
        'Bad Request',
        'body must be 5000 chars or fewer',
        path,
      );
    }
    if (!POST_AUDIENCES.includes(audienceRaw as PostAudience)) {
      return nestError(400, 'Bad Request', 'invalid audience', path);
    }
    const audience = audienceRaw as PostAudience;
    if (audience === 'group') {
      if (!groupId) {
        return nestError(
          400,
          'Bad Request',
          'groupId is required for group posts',
          path,
        );
      }
      if (!findGroupById(groupId)) {
        return nestError(404, 'NotFoundException', 'Group not found', path);
      }
      if (!membershipFor(viewer.user.id, groupId)) {
        return nestError(
          403,
          'ForbiddenException',
          'Not a member of this group',
          path,
        );
      }
    } else if (groupId) {
      return nestError(
        400,
        'Bad Request',
        'groupId only allowed when audience is "group"',
        path,
      );
    }

    const attachments: PostAttachmentDto[] = files.map((file, index) => ({
      mediaId: `mock-media-${crypto.randomUUID()}`,
      kind: file.type.startsWith('video/') ? 'video' : 'photo',
      url: URL.createObjectURL(file),
      thumbnailUrl: null,
      width: null,
      height: null,
      displayOrder: index,
    }));

    const now = new Date().toISOString();
    const post: StoredPost = {
      id: makePostId(),
      authorId: viewer.user.id,
      audience,
      groupId: audience === 'group' ? groupId : null,
      body: bodyText,
      attachments,
      mentions: extractMentions(bodyText).filter(
        (m) => m.userId !== viewer.user.id,
      ),
      editedAt: null,
      deletedAt: null,
      createdAt: now,
    };
    insertPost(post);
    return ok(path, buildPostDto(post, viewer.user.id), 201);
  }),

  http.get(url('/posts/:id'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(id);
    if (!post || !canViewerSeePost(post, viewer.user.id)) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    return ok(path, buildPostDto(post, viewer.user.id));
  }),

  http.patch(url('/posts/:id'), async ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(id);
    if (!post || post.deletedAt !== null) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    if (post.authorId !== viewer.user.id) {
      return nestError(403, 'ForbiddenException', 'Not the author', path);
    }
    const body = (await request.json().catch(() => null)) as
      | UpdatePostRequest
      | null;
    if (!body) {
      return nestError(400, 'Bad Request', 'Body must be JSON.', path);
    }
    if (body.body !== undefined) {
      if (
        typeof body.body !== 'string' ||
        body.body.trim() === '' ||
        body.body.length > 5000
      ) {
        return nestError(400, 'Bad Request', 'invalid body', path);
      }
      post.body = body.body;
      post.mentions = extractMentions(body.body).filter(
        (m) => m.userId !== viewer.user.id,
      );
    }
    if (body.audience !== undefined) {
      if (post.audience === 'group') {
        return nestError(
          400,
          'Bad Request',
          'Cannot change audience of a group post',
          path,
        );
      }
      if (!POST_AUDIENCES.includes(body.audience)) {
        return nestError(400, 'Bad Request', 'invalid audience', path);
      }
      post.audience = body.audience;
    }
    post.editedAt = new Date().toISOString();
    return ok(path, buildPostDto(post, viewer.user.id));
  }),

  http.delete(url('/posts/:id'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(id);
    if (!post || post.deletedAt !== null) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    let allowed = post.authorId === viewer.user.id;
    if (!allowed && post.audience === 'group' && post.groupId) {
      const group = findGroupById(post.groupId);
      if (group && group.ownerId === viewer.user.id) allowed = true;
    }
    if (!allowed) {
      return nestError(403, 'ForbiddenException', 'Not allowed', path);
    }
    post.deletedAt = new Date().toISOString();
    post.body = null;
    return new HttpResponse(null, { status: 204 });
  }),

  // ============ Reactions ============
  http.put(url('/posts/:id/reactions'), async ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}/reactions`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(id);
    if (!post || !canViewerSeePost(post, viewer.user.id)) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    const body = (await request.json().catch(() => null)) as
      | ReactionRequest
      | null;
    if (!body || !REACTION_TYPES.includes(body.type)) {
      return nestError(400, 'Bad Request', 'invalid reaction type', path);
    }
    upsertReaction({
      postId: id,
      userId: viewer.user.id,
      type: body.type,
      createdAt: new Date().toISOString(),
    });
    return ok(path, buildPostDto(post, viewer.user.id));
  }),

  http.delete(url('/posts/:id/reactions'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}/reactions`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(id);
    if (!post) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    removeReactionRow(id, viewer.user.id);
    return ok(path, buildPostDto(post, viewer.user.id));
  }),

  // ============ Comments ============
  http.get(url('/posts/:id/comments'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}/comments`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(id);
    if (!post || !canViewerSeePost(post, viewer.user.id)) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    const query = new URL(request.url).searchParams;
    const limit = Math.min(
      50,
      Math.max(1, numberOrNull(query.get('limit')) ?? 20),
    );
    const rows = allComments()
      .filter(
        (c) =>
          c.postId === id && c.parentId === null && c.deletedAt === null,
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const items: CommentDto[] = rows.slice(0, limit).map(buildCommentDto);
    const data: CommentsListResponseData = { items, nextCursor: null };
    return ok(path, data);
  }),

  http.get(url('/comments/:id/replies'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/comments/${id}/replies`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const parent = findComment(id);
    if (!parent) {
      return nestError(404, 'NotFoundException', 'Comment not found', path);
    }
    const post = findPost(parent.postId);
    if (!post || !canViewerSeePost(post, viewer.user.id)) {
      return nestError(404, 'NotFoundException', 'Comment not found', path);
    }
    const rows = allComments()
      .filter(
        (c) =>
          c.parentId === id && c.deletedAt === null,
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const items = rows.map(buildCommentDto);
    const data: CommentsListResponseData = { items, nextCursor: null };
    return ok(path, data);
  }),

  http.post(url('/posts/:id/comments'), async ({ params, request }) => {
    const postId = String(params.id);
    const path = `/api/v1/posts/${postId}/comments`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(postId);
    if (!post || !canViewerSeePost(post, viewer.user.id)) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    const body = (await request.json().catch(() => null)) as
      | CreateCommentRequest
      | null;
    if (
      !body ||
      typeof body.body !== 'string' ||
      body.body.trim() === '' ||
      body.body.length > 2000
    ) {
      return nestError(400, 'Bad Request', 'invalid comment body', path);
    }
    if (body.parentId) {
      const parent = findComment(body.parentId);
      if (!parent || parent.postId !== postId) {
        return nestError(
          404,
          'NotFoundException',
          'Parent comment not found',
          path,
        );
      }
    }
    const comment: StoredComment = {
      id: makeCommentId(),
      postId,
      parentId: body.parentId ?? null,
      authorId: viewer.user.id,
      body: body.body,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    };
    insertComment(comment);
    return ok(path, buildCommentDto(comment), 201);
  }),

  http.patch(url('/comments/:id'), async ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/comments/${id}`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const comment = findComment(id);
    if (!comment || comment.deletedAt !== null) {
      return nestError(404, 'NotFoundException', 'Comment not found', path);
    }
    if (comment.authorId !== viewer.user.id) {
      return nestError(403, 'ForbiddenException', 'Not the author', path);
    }
    const body = (await request.json().catch(() => null)) as
      | UpdateCommentRequest
      | null;
    if (
      !body ||
      typeof body.body !== 'string' ||
      body.body.trim() === '' ||
      body.body.length > 2000
    ) {
      return nestError(400, 'Bad Request', 'invalid comment body', path);
    }
    comment.body = body.body;
    comment.editedAt = new Date().toISOString();
    return ok(path, buildCommentDto(comment));
  }),

  http.delete(url('/comments/:id'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/comments/${id}`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const comment = findComment(id);
    if (!comment || comment.deletedAt !== null) {
      return nestError(404, 'NotFoundException', 'Comment not found', path);
    }
    const post = findPost(comment.postId);
    let allowed = comment.authorId === viewer.user.id;
    if (!allowed && post && post.authorId === viewer.user.id) allowed = true;
    if (!allowed && post && post.audience === 'group' && post.groupId) {
      const group = findGroupById(post.groupId);
      if (group && group.ownerId === viewer.user.id) allowed = true;
    }
    if (!allowed) {
      return nestError(403, 'ForbiddenException', 'Not allowed', path);
    }
    comment.deletedAt = new Date().toISOString();
    comment.body = null;
    return new HttpResponse(null, { status: 204 });
  }),

  // ============ Favorites ============
  http.put(url('/posts/:id/favorite'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}/favorite`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    const post = findPost(id);
    if (!post || !canViewerSeePost(post, viewer.user.id)) {
      return nestError(404, 'NotFoundException', 'Post not found', path);
    }
    insertFavorite({
      postId: id,
      userId: viewer.user.id,
      createdAt: new Date().toISOString(),
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete(url('/posts/:id/favorite'), ({ params, request }) => {
    const id = String(params.id);
    const path = `/api/v1/posts/${id}/favorite`;
    const auth = requireViewer(request, path);
    if (!auth.ok) return auth.response;
    const viewer = auth.viewer;
    removeFavoriteRow(id, viewer.user.id);
    return new HttpResponse(null, { status: 204 });
  }),
];
