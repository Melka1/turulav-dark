/**
 * DTO shapes shared with the backend project.
 * Wire format mirrors what the NestJS backend actually returns.
 * Source of truth: docs/user/INTEGRATION_PLAN.md §3.
 *
 * - camelCase field names
 * - Success responses are wrapped: { success, data, meta }; the types below
 *   describe the `data` payload only. Use `unwrap()` (api helpers) at the
 *   transport boundary to peel the wrapper.
 * - Error responses follow the NestJS default shape; mapped to ApiError by
 *   parseApiError() in src/api/baseQuery.ts.
 */

export type Gender =
  | 'male'
  | 'female'
  | 'non_binary'
  | 'other'
  | 'prefer_not_to_say';

export type AccountStatus = 'active' | 'suspended' | 'banned' | 'deleted';
export type Role = 'user' | 'moderator' | 'admin';
export type ProfileVisibility = 'public' | 'members_only' | 'private';

export type ProfileDto = {
  userId: string;
  displayName: string;
  gender: Gender | null;
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
  visibility: ProfileVisibility;
  completionScore: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicProfileDto = Omit<ProfileDto, 'address' | 'visibility'>;

/**
 * Body for `PATCH /profiles/me`. Section-by-section edits send only the
 * fields they touch; server-controlled fields (`userId`, timestamps,
 * `completionScore`) are excluded.
 */
export type UpdateMyProfileBody = Partial<
  Omit<ProfileDto, 'userId' | 'completionScore' | 'createdAt' | 'updatedAt'>
>;

/**
 * Shape of each item in `GET /profiles/search`. The backend flattens profile
 * fields together with a handful of user/derived fields (`username`,
 * `isOnline`, `lastActiveAt`, `tier`, `age`, `ageBand`) at the top level —
 * there is no nested `user` object on the wire.
 */
export type ProfileWithUserDto = Omit<
  PublicProfileDto,
  'dob' | 'completionScore' | 'createdAt' | 'updatedAt'
> & {
  username: string;
  isOnline: boolean | null;
  lastActiveAt: string | null;
  tier?: 'self' | 'friend' | 'member';
  age?: number | null;
  ageBand?: string | null;
  activityBucket?: string | null;
  email?: string | null;
  completionScore?: number | null;
};

export type SearchProfilesQuery = {
  q?: string;
  gender?: Gender;
  /** Comma-separated list. */
  seeking?: string;
  /** Comma-separated list. */
  interests?: string;
  country?: string;
  profession?: string;
  minAge?: number;
  maxAge?: number;
  sort?: 'most_active' | 'relevance';
  page?: number;
  limit?: number;
};

export type SearchProfilesResponseData = {
  items: ProfileWithUserDto[];
  total: number;
  page: number;
  limit: number;
};

export type UserDto = {
  id: string;
  username: string;
  role: Role;
  accountStatus: AccountStatus;
  isOnline: boolean;
  lastActiveAt: string | null;
  onboardingCompleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** /users/me returns the user with the profile nested. */
export type UserWithProfileDto = UserDto & { profile: ProfileDto };

export type PublicUserDto = Pick<
  UserDto,
  'id' | 'username' | 'isOnline' | 'lastActiveAt' | 'createdAt'
>;

/** Issued only on login, after email verification. */
export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  tokenType: 'bearer';
};

export type SignupRequest = {
  username: string;
  email: string;
  password: string;
};

export type SignupResponseData = {
  userId: string;
  emailConfirmationRequired: boolean;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponseData = {
  userId: string;
  session: AuthSession;
};

export type RefreshRequest = {
  refreshToken: string;
};

export type RefreshResponseData = {
  session: AuthSession;
};

/** Wire shape of every 2xx response from the backend. */
export type ApiSuccessEnvelope<T> = {
  success: true;
  data: T;
  meta: {
    timestamp: string;
    path: string;
    requestId: string;
  };
};

// ============ Groups ============

export type GroupVisibility = 'public' | 'unlisted' | 'private';
export type GroupJoinPolicy = 'open' | 'invite_only' | 'request';

export type GroupDto = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: string | null;
  ownerId: string;
  visibility: GroupVisibility;
  joinPolicy: GroupJoinPolicy;
  interests: string[];
  country: string | null;
  city: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  maxMembers: number;
  memberCount: number;
  adminSuspendedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SearchGroupsQuery = {
  q?: string;
  country?: string;
  city?: string;
  /** Comma-separated list. */
  interests?: string;
  visibility?: GroupVisibility;
  joinPolicy?: GroupJoinPolicy;
  sort?: 'most_active' | 'relevance';
  page?: number;
  limit?: number;
};

export type SearchGroupsResponseData = {
  items: GroupDto[];
  total: number;
  page: number;
  limit: number;
};

// ============ Friends ============

export type FriendshipStatus =
  | 'accepted'
  | 'pending_in'
  | 'pending_out'
  | 'none'
  | 'blocked_by_me'
  | 'blocked_by_them';

export type FriendshipStatusDto = {
  status: FriendshipStatus;
};

/** Shape of each row from `GET /friends`. Flat denormalized shape confirmed by real backend. */
export type FriendItemDto = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastActiveAt: string | null;
  friendCount: number;
  gender: Gender | null;
  dob: string | null;
  country: string | null;
  city: string | null;
  bio: string | null;
};

export type FriendsListQuery = {
  q?: string;
  country?: string;
  sort?: 'name' | 'recent';
  page?: number;
  limit?: number;
};

export type FriendsListResponseData = {
  items: FriendItemDto[];
  total: number;
  page: number;
  limit: number;
};

export type SendFriendRequestBody = {
  targetUserId: string;
  message?: string;
};

/**
 * Shape of `GET /friends/requests/{incoming,outgoing}` rows. The backend doc
 * (§friend requests) only sketches the wire — frontend assumes each row
 * carries the partner user/profile and the request metadata. Adjust here if
 * the real backend response differs.
 */
export type FriendRequestDto = {
  id: string; // "<userLow>:<userHigh>"
  fromUser: PublicUserDto;
  fromProfile: PublicProfileDto;
  toUser: PublicUserDto;
  toProfile: PublicProfileDto;
  message: string | null;
  createdAt: string;
};

// ============ Activity (posts, reactions, comments, favorites) ============
// See docs/activity/README.md for the spec.

export type PostAudience = 'public' | 'friends' | 'private' | 'group';
export type ReactionType =
  | 'like'
  | 'heart'
  | 'laugh'
  | 'wow'
  | 'sad'
  | 'angry';
export type ActivityLens =
  | 'personal'
  | 'mentions'
  | 'favorites'
  | 'friends'
  | 'groups';
export type ActivitySort = 'recent' | 'popular' | 'relevant';

export type PostAuthorDto = {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export type PostAttachmentDto = {
  mediaId: string;
  kind: 'photo' | 'video';
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  displayOrder: number;
};

export type ReactionSummaryDto = {
  total: number;
  byType: Partial<Record<ReactionType, number>>;
  topActors: PostAuthorDto[];
  viewerReaction: ReactionType | null;
};

export type PostMentionDto = {
  userId: string;
  username: string;
};

export type PostGroupRefDto = {
  id: string;
  slug: string;
  name: string;
};

export type PostDto = {
  id: string;
  author: PostAuthorDto;
  audience: PostAudience;
  group: PostGroupRefDto | null;
  body: string | null;
  attachments: PostAttachmentDto[];
  mentions: PostMentionDto[];
  reactionSummary: ReactionSummaryDto;
  commentCount: number;
  viewerFavorited: boolean;
  isDeleted: boolean;
  editedAt: string | null;
  createdAt: string;
};

export type ActivityFeedQuery = {
  lens?: ActivityLens;
  sort?: ActivitySort;
  cursor?: string;
  limit?: number;
};

export type ActivityFeedResponseData = {
  items: PostDto[];
  nextCursor: string | null;
};

export type CreatePostRequest = {
  body: string;
  audience: PostAudience;
  groupId?: string;
  attachmentMediaIds?: string[];
};

export type UpdatePostRequest = {
  body?: string;
  audience?: Exclude<PostAudience, 'group'>;
};

export type CommentDto = {
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

export type CommentsListQuery = {
  cursor?: string;
  limit?: number;
};

export type CommentsListResponseData = {
  items: CommentDto[];
  nextCursor: string | null;
};

export type CreateCommentRequest = {
  body: string;
  parentId?: string;
};

export type UpdateCommentRequest = {
  body: string;
};

export type ReactionRequest = {
  type: ReactionType;
};
