import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  BlogLikeResponseData,
  BlogListQuery,
  BlogListResponseData,
  BlogPostDto,
  BlogTagDto,
  CommentDto,
  CommentsListQuery,
  CommentsListResponseData,
  CreateCommentRequest,
  UpdateCommentRequest,
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

export const blogApi = api.injectEndpoints({
  endpoints: (build) => ({
    // ============ Blog posts ============
    listBlogPosts: build.query<BlogListResponseData, BlogListQuery | void>({
      query: (params) => ({
        url: `/blog/posts${buildQueryString((params ?? {}) as Record<string, unknown>)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<BlogListResponseData>,
      ) => unwrap(response),
      providesTags: (result) =>
        result
          ? [
              { type: 'BlogPosts', id: 'LIST' },
              ...result.items.map((p) => ({
                type: 'BlogPost' as const,
                id: p.id,
              })),
            ]
          : [{ type: 'BlogPosts', id: 'LIST' }],
    }),

    getBlogPost: build.query<BlogPostDto, string>({
      query: (slug) => ({ url: `/blog/posts/${encodeURIComponent(slug)}` }),
      transformResponse: (response: ApiSuccessEnvelope<BlogPostDto>) =>
        unwrap(response),
      providesTags: (result) =>
        result ? [{ type: 'BlogPost', id: result.id }] : [],
    }),

    // Editor write endpoints (POST/PATCH/DELETE /blog/posts) are not wired
    // yet — backend request shape is TBD. Add them when editorial flow lands.

    // ============ Likes ============
    likeBlogPost: build.mutation<BlogLikeResponseData, string>({
      query: (id) => ({
        url: `/blog/posts/${encodeURIComponent(id)}/like`,
        method: 'PUT',
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<BlogLikeResponseData>,
      ) => unwrap(response),
      invalidatesTags: (_r, _e, id) => [
        { type: 'BlogPost', id },
        { type: 'BlogPosts', id: 'LIST' },
      ],
    }),

    unlikeBlogPost: build.mutation<BlogLikeResponseData, string>({
      query: (id) => ({
        url: `/blog/posts/${encodeURIComponent(id)}/like`,
        method: 'DELETE',
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<BlogLikeResponseData>,
      ) => unwrap(response),
      invalidatesTags: (_r, _e, id) => [
        { type: 'BlogPost', id },
        { type: 'BlogPosts', id: 'LIST' },
      ],
    }),

    // ============ Comments (members-only, reuses CommentDto) ============
    listBlogComments: build.query<
      CommentsListResponseData,
      { postId: string } & CommentsListQuery
    >({
      query: ({ postId, ...params }) => ({
        url: `/blog/posts/${encodeURIComponent(postId)}/comments${buildQueryString(params)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<CommentsListResponseData>,
      ) => unwrap(response),
      providesTags: (_r, _e, arg) => [
        { type: 'BlogComments', id: arg.postId },
      ],
    }),

    listBlogCommentReplies: build.query<
      CommentsListResponseData,
      { commentId: string } & CommentsListQuery
    >({
      query: ({ commentId, ...params }) => ({
        url: `/blog/comments/${encodeURIComponent(commentId)}/replies${buildQueryString(params)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<CommentsListResponseData>,
      ) => unwrap(response),
      providesTags: (_r, _e, arg) => [
        { type: 'BlogComments', id: `replies:${arg.commentId}` },
      ],
    }),

    createBlogComment: build.mutation<
      CommentDto,
      { postId: string; body: CreateCommentRequest }
    >({
      query: ({ postId, body }) => ({
        url: `/blog/posts/${encodeURIComponent(postId)}/comments`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: ApiSuccessEnvelope<CommentDto>) =>
        unwrap(response),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'BlogComments', id: arg.postId },
        ...(arg.body.parentId
          ? [
              {
                type: 'BlogComments' as const,
                id: `replies:${arg.body.parentId}`,
              },
            ]
          : []),
        { type: 'BlogPost', id: arg.postId },
      ],
    }),

    updateBlogComment: build.mutation<
      CommentDto,
      { id: string; postId: string; body: UpdateCommentRequest }
    >({
      query: ({ id, body }) => ({
        url: `/blog/comments/${encodeURIComponent(id)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: ApiSuccessEnvelope<CommentDto>) =>
        unwrap(response),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'BlogComments', id: arg.postId },
      ],
    }),

    deleteBlogComment: build.mutation<
      void,
      { id: string; postId: string }
    >({
      query: ({ id }) => ({
        url: `/blog/comments/${encodeURIComponent(id)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'BlogComments', id: arg.postId },
        { type: 'BlogPost', id: arg.postId },
      ],
    }),

    // ============ Tags ============
    listBlogTags: build.query<BlogTagDto[], void>({
      query: () => ({ url: '/blog/tags' }),
      transformResponse: (response: ApiSuccessEnvelope<BlogTagDto[]>) =>
        unwrap(response),
      providesTags: ['BlogTags'],
    }),
  }),
  overrideExisting: false,
});
