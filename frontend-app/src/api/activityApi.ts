import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ActivityFeedQuery,
  ActivityFeedResponseData,
  ApiSuccessEnvelope,
  CommentDto,
  CommentsListQuery,
  CommentsListResponseData,
  CreateCommentRequest,
  CreatePostRequest,
  PostDto,
  ReactionRequest,
  UpdateCommentRequest,
  UpdatePostRequest,
} from '@/types/api';

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

type FeedArgs = ActivityFeedQuery & { userId: string };

export const activityApi = api.injectEndpoints({
  endpoints: (build) => ({
    // ============ Activity feed ============
    getActivityFeed: build.query<ActivityFeedResponseData, FeedArgs>({
      query: ({ userId, ...params }) => ({
        url: `/users/${encodeURIComponent(userId)}/activity${buildQueryString(params)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<ActivityFeedResponseData>,
      ) => unwrap(response),
      providesTags: (result, _err, arg) =>
        result
          ? [
              { type: 'ActivityFeed', id: `${arg.userId}:${arg.lens ?? 'personal'}` },
              ...result.items.map((p) => ({ type: 'Post' as const, id: p.id })),
            ]
          : [{ type: 'ActivityFeed', id: `${arg.userId}:${arg.lens ?? 'personal'}` }],
    }),

    getMyFavorites: build.query<ActivityFeedResponseData, ActivityFeedQuery | void>({
      query: (params) => ({
        url: `/users/me/favorites${buildQueryString((params ?? {}) as Record<string, unknown>)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<ActivityFeedResponseData>,
      ) => unwrap(response),
      providesTags: ['Favorites'],
    }),

    // ============ Posts ============
    getPost: build.query<PostDto, string>({
      query: (id) => ({ url: `/posts/${encodeURIComponent(id)}` }),
      transformResponse: (response: ApiSuccessEnvelope<PostDto>) =>
        unwrap(response),
      providesTags: (_r, _e, id) => [{ type: 'Post', id }],
    }),

    createPost: build.mutation<PostDto, CreatePostRequest>({
      query: ({ body, audience, groupId, files }) => {
        const fd = new FormData();
        fd.set('body', body);
        fd.set('audience', audience);
        if (groupId) fd.set('groupId', groupId);
        if (files) {
          for (const file of files) fd.append('files', file);
        }
        return { url: '/posts', method: 'POST', body: fd };
      },
      transformResponse: (response: ApiSuccessEnvelope<PostDto>) =>
        unwrap(response),
      invalidatesTags: ['ActivityFeed'],
    }),

    updatePost: build.mutation<
      PostDto,
      { id: string; body: UpdatePostRequest }
    >({
      query: ({ id, body }) => ({
        url: `/posts/${encodeURIComponent(id)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: ApiSuccessEnvelope<PostDto>) =>
        unwrap(response),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'Post', id: arg.id },
        'ActivityFeed',
      ],
    }),

    deletePost: build.mutation<void, string>({
      query: (id) => ({
        url: `/posts/${encodeURIComponent(id)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'Post', id },
        'ActivityFeed',
        'Favorites',
      ],
    }),

    // ============ Reactions ============
    setReaction: build.mutation<
      PostDto,
      { postId: string; body: ReactionRequest }
    >({
      query: ({ postId, body }) => ({
        url: `/posts/${encodeURIComponent(postId)}/reactions`,
        method: 'PUT',
        body,
      }),
      transformResponse: (response: ApiSuccessEnvelope<PostDto>) =>
        unwrap(response),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'Post', id: arg.postId },
        'ActivityFeed',
      ],
    }),

    removeReaction: build.mutation<PostDto, string>({
      query: (postId) => ({
        url: `/posts/${encodeURIComponent(postId)}/reactions`,
        method: 'DELETE',
      }),
      transformResponse: (response: ApiSuccessEnvelope<PostDto>) =>
        unwrap(response),
      invalidatesTags: (_r, _e, postId) => [
        { type: 'Post', id: postId },
        'ActivityFeed',
      ],
    }),

    // ============ Comments ============
    listComments: build.query<
      CommentsListResponseData,
      { postId: string } & CommentsListQuery
    >({
      query: ({ postId, ...params }) => ({
        url: `/posts/${encodeURIComponent(postId)}/comments${buildQueryString(params)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<CommentsListResponseData>,
      ) => unwrap(response),
      providesTags: (_r, _e, arg) => [
        { type: 'Comments', id: arg.postId },
      ],
    }),

    listReplies: build.query<
      CommentsListResponseData,
      { commentId: string } & CommentsListQuery
    >({
      query: ({ commentId, ...params }) => ({
        url: `/comments/${encodeURIComponent(commentId)}/replies${buildQueryString(params)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<CommentsListResponseData>,
      ) => unwrap(response),
      providesTags: (_r, _e, arg) => [
        { type: 'Comments', id: `replies:${arg.commentId}` },
      ],
    }),

    createComment: build.mutation<
      CommentDto,
      { postId: string; body: CreateCommentRequest }
    >({
      query: ({ postId, body }) => ({
        url: `/posts/${encodeURIComponent(postId)}/comments`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: ApiSuccessEnvelope<CommentDto>) =>
        unwrap(response),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'Comments', id: arg.postId },
        ...(arg.body.parentId
          ? [
              {
                type: 'Comments' as const,
                id: `replies:${arg.body.parentId}`,
              },
            ]
          : []),
        { type: 'Post', id: arg.postId },
        'ActivityFeed',
      ],
    }),

    updateComment: build.mutation<
      CommentDto,
      { id: string; postId: string; body: UpdateCommentRequest }
    >({
      query: ({ id, body }) => ({
        url: `/comments/${encodeURIComponent(id)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: ApiSuccessEnvelope<CommentDto>) =>
        unwrap(response),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'Comments', id: arg.postId },
      ],
    }),

    deleteComment: build.mutation<void, { id: string; postId: string }>({
      query: ({ id }) => ({
        url: `/comments/${encodeURIComponent(id)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'Comments', id: arg.postId },
        { type: 'Post', id: arg.postId },
        'ActivityFeed',
      ],
    }),

    // ============ Favorites ============
    addFavorite: build.mutation<void, string>({
      query: (postId) => ({
        url: `/posts/${encodeURIComponent(postId)}/favorite`,
        method: 'PUT',
      }),
      invalidatesTags: (_r, _e, postId) => [
        { type: 'Post', id: postId },
        'Favorites',
        'ActivityFeed',
      ],
    }),

    removeFavorite: build.mutation<void, string>({
      query: (postId) => ({
        url: `/posts/${encodeURIComponent(postId)}/favorite`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, postId) => [
        { type: 'Post', id: postId },
        'Favorites',
        'ActivityFeed',
      ],
    }),
  }),
  overrideExisting: false,
});
