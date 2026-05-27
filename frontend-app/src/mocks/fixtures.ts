import type {
  AuthSession,
  GroupDto,
  PostAttachmentDto,
  PostAudience,
  PostMentionDto,
  ProfileDto,
  ReactionType,
  UserDto,
} from '@/types/api';

type Stored = {
  user: UserDto;
  email: string;
  profile: ProfileDto;
  password: string;
  emailConfirmedAt: string | null;
  session: AuthSession | null;
};

const records: Stored[] = [];
const groups: GroupDto[] = [];
const memberships: Array<{ userId: string; groupId: string }> = [];

type Friendship = {
  userLow: string;
  userHigh: string;
  status: 'pending' | 'accepted';
  /** The user who sent the original request. */
  initiatedBy: string;
  message: string | null;
  createdAt: string;
};

const friendships: Friendship[] = [];

export type StoredPost = {
  id: string;
  authorId: string;
  audience: PostAudience;
  groupId: string | null;
  body: string | null;
  attachments: PostAttachmentDto[];
  mentions: PostMentionDto[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export type StoredComment = {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string;
  body: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export type StoredReaction = {
  postId: string;
  userId: string;
  type: ReactionType;
  createdAt: string;
};

export type StoredFavorite = {
  postId: string;
  userId: string;
  createdAt: string;
};

const posts: StoredPost[] = [];
const comments: StoredComment[] = [];
const reactions: StoredReaction[] = [];
const favorites: StoredFavorite[] = [];

let postIdCounter = 1;
const nextPostId = (): string =>
  `p0000000-0000-0000-0000-${String(postIdCounter++).padStart(12, '0')}`;
let commentIdCounter = 1;
const nextCommentId = (): string =>
  `c0000000-0000-0000-0000-${String(commentIdCounter++).padStart(12, '0')}`;

export function allPosts(): StoredPost[] {
  return posts;
}
export function findPost(id: string): StoredPost | undefined {
  return posts.find((p) => p.id === id);
}
export function insertPost(p: StoredPost): void {
  posts.push(p);
}
export function makePostId(): string {
  return nextPostId();
}

export function allComments(): StoredComment[] {
  return comments;
}
export function findComment(id: string): StoredComment | undefined {
  return comments.find((c) => c.id === id);
}
export function insertComment(c: StoredComment): void {
  comments.push(c);
}
export function makeCommentId(): string {
  return nextCommentId();
}

export function reactionsFor(postId: string): StoredReaction[] {
  return reactions.filter((r) => r.postId === postId);
}
export function findReaction(
  postId: string,
  userId: string,
): StoredReaction | undefined {
  return reactions.find((r) => r.postId === postId && r.userId === userId);
}
export function upsertReaction(input: StoredReaction): void {
  const existing = findReaction(input.postId, input.userId);
  if (existing) {
    existing.type = input.type;
    existing.createdAt = input.createdAt;
    return;
  }
  reactions.push(input);
}
export function removeReactionRow(postId: string, userId: string): boolean {
  const idx = reactions.findIndex(
    (r) => r.postId === postId && r.userId === userId,
  );
  if (idx === -1) return false;
  reactions.splice(idx, 1);
  return true;
}

export function findFavorite(
  postId: string,
  userId: string,
): StoredFavorite | undefined {
  return favorites.find((f) => f.postId === postId && f.userId === userId);
}
export function insertFavorite(f: StoredFavorite): void {
  if (findFavorite(f.postId, f.userId)) return;
  favorites.push(f);
}
export function removeFavoriteRow(postId: string, userId: string): boolean {
  const idx = favorites.findIndex(
    (f) => f.postId === postId && f.userId === userId,
  );
  if (idx === -1) return false;
  favorites.splice(idx, 1);
  return true;
}
export function favoritesForUser(userId: string): StoredFavorite[] {
  return favorites.filter((f) => f.userId === userId);
}

export function membershipFor(userId: string, groupId: string): boolean {
  return memberships.some(
    (m) => m.userId === userId && m.groupId === groupId,
  );
}
export function groupsJoinedByUser(userId: string): string[] {
  return memberships.filter((m) => m.userId === userId).map((m) => m.groupId);
}
export function findGroupById(groupId: string): GroupDto | undefined {
  return groups.find((g) => g.id === groupId);
}

function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function findFriendship(a: string, b: string): Friendship | undefined {
  const [lo, hi] = orderPair(a, b);
  return friendships.find((f) => f.userLow === lo && f.userHigh === hi);
}

export function removeFriendship(a: string, b: string): boolean {
  const [lo, hi] = orderPair(a, b);
  const idx = friendships.findIndex(
    (f) => f.userLow === lo && f.userHigh === hi,
  );
  if (idx === -1) return false;
  friendships.splice(idx, 1);
  return true;
}

export function upsertFriendship(f: Friendship): void {
  const existing = findFriendship(f.userLow, f.userHigh);
  if (existing) {
    existing.status = f.status;
    existing.initiatedBy = f.initiatedBy;
    existing.message = f.message;
    existing.createdAt = f.createdAt;
    return;
  }
  friendships.push(f);
}

export function friendsOf(userId: string): Stored[] {
  const partnerIds = new Set<string>();
  for (const f of friendships) {
    if (f.status !== 'accepted') continue;
    if (f.userLow === userId) partnerIds.add(f.userHigh);
    else if (f.userHigh === userId) partnerIds.add(f.userLow);
  }
  return records.filter((r) => partnerIds.has(r.user.id));
}

let idCounter = 1;
const nextId = (): string =>
  `00000000-0000-0000-0000-${String(idCounter++).padStart(12, '0')}`;

export function findByUsername(username: string): Stored | undefined {
  const lower = username.toLowerCase();
  return records.find((r) => r.user.username.toLowerCase() === lower);
}

export function findByEmail(email: string): Stored | undefined {
  const lower = email.toLowerCase();
  return records.find((r) => r.email.toLowerCase() === lower);
}

export function findByAccessToken(token: string): Stored | undefined {
  return records.find((r) => r.session?.accessToken === token);
}

export function findByRefreshToken(token: string): Stored | undefined {
  return records.find((r) => r.session?.refreshToken === token);
}

export function rotateAccessToken(record: Stored): AuthSession {
  if (!record.session) return issueSession(record);
  const next: AuthSession = {
    ...record.session,
    accessToken: `mock.${record.user.id}.${Math.random().toString(36).slice(2, 10)}`,
    expiresIn: 3600,
  };
  record.session = next;
  return next;
}

export function findById(userId: string): Stored | undefined {
  return records.find((r) => r.user.id === userId);
}

export function createUser(input: {
  username: string;
  email: string;
  password: string;
}): Stored {
  const now = new Date().toISOString();
  const id = nextId();
  const user: UserDto = {
    id,
    username: input.username,
    role: 'user',
    accountStatus: 'active',
    isOnline: false,
    lastActiveAt: null,
    onboardingCompleted: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const profile: ProfileDto = {
    userId: id,
    displayName: input.username,
    gender: null,
    seeking: [],
    dob: null,
    maritalStatus: null,
    relationshipType: null,
    country: null,
    city: null,
    address: null,
    bio: null,
    lookingFor: null,
    likes: null,
    interests: [],
    favoritePlaces: [],
    languages: [],
    religion: null,
    children: null,
    smoking: null,
    drinking: null,
    heightCm: null,
    weightKg: null,
    hairColor: null,
    eyeColor: null,
    bodyType: null,
    ethnicity: null,
    profession: null,
    avatarUrl: null,
    coverUrl: null,
    visibility: 'public',
    completionScore: 0,
    createdAt: now,
    updatedAt: now,
  };
  const stored: Stored = {
    user,
    email: input.email,
    profile,
    password: input.password,
    emailConfirmedAt: null,
    session: null,
  };
  records.push(stored);
  return stored;
}

export function issueSession(record: Stored): AuthSession {
  const session: AuthSession = {
    accessToken: `mock.${record.user.id}.${Math.random().toString(36).slice(2, 10)}`,
    refreshToken: Math.random().toString(36).slice(2, 14),
    expiresIn: 3600,
    tokenType: 'bearer',
  };
  record.session = session;
  return session;
}

export function allRecords(): readonly Stored[] {
  return records;
}

export function allGroups(): readonly GroupDto[] {
  return groups;
}

export function groupsForUser(userId: string): GroupDto[] {
  const joinedIds = new Set(
    memberships.filter((m) => m.userId === userId).map((m) => m.groupId),
  );
  return groups.filter((g) => joinedIds.has(g.id));
}

type Seed = {
  username: string;
  email: string;
  gender: ProfileDto['gender'];
  country: string;
  city: string | null;
  ageYears: number;
  interests: string[];
  bio: string;
  isOnline: boolean;
  minutesSinceActive: number;
};

export function seedFixtures(): void {
  if (records.length > 0) return;
  const seeds: Seed[] = [
    {
      username: 'tenma_shyna',
      email: 'tenma@example.com',
      gender: 'female',
      country: 'USA',
      city: 'New York',
      ageYears: 27,
      interests: ['hiking', 'jazz'],
      bio: 'Loves the outdoors and late-night gigs.',
      isOnline: true,
      minutesSinceActive: 0,
    },
    {
      username: 'rin_takeda',
      email: 'rin@example.com',
      gender: 'female',
      country: 'Australia',
      city: 'Sydney',
      ageYears: 24,
      interests: ['surfing', 'photography'],
      bio: 'Sunshine chaser, camera always at hand.',
      isOnline: false,
      minutesSinceActive: 45,
    },
    {
      username: 'mateo_silva',
      email: 'mateo@example.com',
      gender: 'male',
      country: 'Brazil',
      city: 'Rio',
      ageYears: 31,
      interests: ['football', 'cooking'],
      bio: 'Cooks better than he plays football, but only just.',
      isOnline: false,
      minutesSinceActive: 4 * 60,
    },
    {
      username: 'kai_ndlovu',
      email: 'kai@example.com',
      gender: 'non_binary',
      country: 'UK',
      city: 'London',
      ageYears: 29,
      interests: ['design', 'jazz'],
      bio: 'Designer by day, cellist by weekend.',
      isOnline: false,
      minutesSinceActive: 60 * 24 + 30,
    },
    {
      username: 'aben_taye',
      email: 'aben@example.com',
      gender: 'male',
      country: 'Ethiopia',
      city: 'Addis Ababa',
      ageYears: 33,
      interests: ['running', 'coffee'],
      bio: 'Marathon runner who fuels on the best coffee in the world.',
      isOnline: true,
      minutesSinceActive: 1,
    },
  ];

  const now = Date.now();
  for (const s of seeds) {
    const rec = createUser({
      username: s.username,
      email: s.email,
      password: 'demo_password_1!',
    });
    rec.emailConfirmedAt = new Date(now - 60_000).toISOString();
    rec.user.isOnline = s.isOnline;
    rec.user.lastActiveAt = new Date(
      now - s.minutesSinceActive * 60_000,
    ).toISOString();
    rec.profile.gender = s.gender;
    rec.profile.country = s.country;
    rec.profile.city = s.city;
    rec.profile.interests = s.interests;
    rec.profile.bio = s.bio;
    rec.profile.dob = new Date(
      now - s.ageYears * 365.25 * 24 * 60 * 60_000,
    )
      .toISOString()
      .slice(0, 10);
  }

  seedGroupFixtures();
  seedFriendshipFixtures();
  seedPostFixtures();
}

function seedPostFixtures(): void {
  if (posts.length > 0 || records.length < 2) return;
  const now = Date.now();
  const a = records[0]!.user.id;
  const b = records[1]!.user.id;
  const c = records[2]?.user.id ?? a;

  const samplePosts: Array<{
    author: string;
    audience: PostAudience;
    groupId: string | null;
    body: string;
    minutesAgo: number;
    attachments?: PostAttachmentDto[];
    mentions?: PostMentionDto[];
  }> = [
    {
      author: a,
      audience: 'public',
      groupId: null,
      body: 'Morning run done — anyone up for coffee at Tomoca?',
      minutesAgo: 60,
    },
    {
      author: a,
      audience: 'public',
      groupId: null,
      body: 'New photos from yesterday\'s walk.',
      minutesAgo: 60 * 6,
      attachments: [
        {
          mediaId: 'media-1',
          kind: 'photo',
          url: '/assets/images/profile/post-image/02.jpg',
          thumbnailUrl: null,
          width: 1200,
          height: 800,
          displayOrder: 0,
        },
        {
          mediaId: 'media-2',
          kind: 'photo',
          url: '/assets/images/profile/post-image/03.jpg',
          thumbnailUrl: null,
          width: 1200,
          height: 800,
          displayOrder: 1,
        },
      ],
    },
    {
      author: b,
      audience: 'public',
      groupId: null,
      body: `Thanks @${records[0]!.user.username} for the recommendations!`,
      minutesAgo: 60 * 24,
      mentions: [
        {
          userId: a,
          username: records[0]!.user.username,
        },
      ],
    },
    {
      author: a,
      audience: 'group',
      groupId: 'g-1',
      body: 'Sunday meetup confirmed for 10am at the usual spot.',
      minutesAgo: 60 * 30,
    },
  ];

  for (const s of samplePosts) {
    posts.push({
      id: nextPostId(),
      authorId: s.author,
      audience: s.audience,
      groupId: s.groupId,
      body: s.body,
      attachments: s.attachments ?? [],
      mentions: s.mentions ?? [],
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(now - s.minutesAgo * 60_000).toISOString(),
    });
  }

  // A couple of reactions + a favorite for the first post so the UI has shape.
  const firstPost = posts[0]!;
  reactions.push({
    postId: firstPost.id,
    userId: b,
    type: 'like',
    createdAt: new Date(now - 30 * 60_000).toISOString(),
  });
  reactions.push({
    postId: firstPost.id,
    userId: c,
    type: 'heart',
    createdAt: new Date(now - 20 * 60_000).toISOString(),
  });
  favorites.push({
    postId: firstPost.id,
    userId: a,
    createdAt: new Date(now - 10 * 60_000).toISOString(),
  });

  // One top-level comment + a reply on the first post.
  const topComment: StoredComment = {
    id: nextCommentId(),
    postId: firstPost.id,
    parentId: null,
    authorId: b,
    body: 'Count me in!',
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(now - 25 * 60_000).toISOString(),
  };
  comments.push(topComment);
  comments.push({
    id: nextCommentId(),
    postId: firstPost.id,
    parentId: topComment.id,
    authorId: a,
    body: 'See you there.',
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(now - 15 * 60_000).toISOString(),
  });
}

function seedFriendshipFixtures(): void {
  if (friendships.length > 0 || records.length < 3) return;
  const nowIso = new Date().toISOString();
  const a = records[0]!.user.id;
  const b = records[1]!.user.id;
  const c = records[2]!.user.id;
  // a ↔ b accepted
  upsertFriendship({
    ...orderedPair(a, b),
    status: 'accepted',
    initiatedBy: a,
    message: null,
    createdAt: nowIso,
  });
  // a ↔ c pending (c initiated → from a's POV this is pending_in)
  upsertFriendship({
    ...orderedPair(a, c),
    status: 'pending',
    initiatedBy: c,
    message: 'Met at the meetup last week.',
    createdAt: nowIso,
  });
}

function orderedPair(
  a: string,
  b: string,
): { userLow: string; userHigh: string } {
  const [lo, hi] = orderPair(a, b);
  return { userLow: lo, userHigh: hi };
}

function seedGroupFixtures(): void {
  if (groups.length > 0) return;
  const owners = records.slice(0, 3);
  if (owners.length === 0) return;

  const nowIso = new Date().toISOString();
  const groupSeeds: Array<Omit<GroupDto, 'createdAt' | 'updatedAt'>> = [
    {
      id: 'g-1',
      slug: 'coffee-conversation',
      name: 'Coffee & Conversation',
      description: 'Slow Sundays, specialty coffee, board games optional.',
      rules: 'Be kind. Show up to the meetups you RSVP to.',
      ownerId: owners[0]!.user.id,
      visibility: 'public',
      joinPolicy: 'open',
      interests: ['coffee', 'board_games', 'hiking'],
      country: 'Ethiopia',
      city: 'Addis Ababa',
      avatarUrl: null,
      coverUrl: null,
      maxMembers: 200,
      memberCount: 2,
      memberAvatars: [],
      extraMembersBand: null,
      adminSuspendedAt: null,
      deletedAt: null,
    },
    {
      id: 'g-2',
      slug: 'addis-hikers',
      name: 'Addis Hikers',
      description: 'Trails outside the city every other Saturday.',
      rules: null,
      ownerId: owners[1]?.user.id ?? owners[0]!.user.id,
      visibility: 'unlisted',
      joinPolicy: 'invite_only',
      interests: ['hiking', 'outdoors', 'fitness'],
      country: 'Ethiopia',
      city: 'Addis Ababa',
      avatarUrl: null,
      coverUrl: null,
      maxMembers: 50,
      memberCount: 1,
      memberAvatars: [],
      extraMembersBand: null,
      adminSuspendedAt: null,
      deletedAt: null,
    },
    {
      id: 'g-3',
      slug: 'sydney-photo-walks',
      name: 'Sydney Photo Walks',
      description: 'Golden-hour shoots around the harbour.',
      rules: null,
      ownerId: owners[2]?.user.id ?? owners[0]!.user.id,
      visibility: 'public',
      joinPolicy: 'request',
      interests: ['photography', 'walking'],
      country: 'Australia',
      city: 'Sydney',
      avatarUrl: null,
      coverUrl: null,
      maxMembers: 100,
      memberCount: 14,
      memberAvatars: [],
      extraMembersBand: null,
      adminSuspendedAt: null,
      deletedAt: null,
    },
  ];

  for (const g of groupSeeds) {
    groups.push({ ...g, createdAt: nowIso, updatedAt: nowIso });
  }

  // Pre-join the first seeded record to two groups so /groups/me has data.
  if (records.length > 0) {
    memberships.push({ userId: records[0]!.user.id, groupId: 'g-1' });
    memberships.push({ userId: records[0]!.user.id, groupId: 'g-3' });
  }
}
