import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  FriendItemDto,
  FriendRequestDto,
  FriendshipStatusDto,
  FriendsListQuery,
  FriendsListResponseData,
  FriendSuggestionsQuery,
  FriendSuggestionsResponseData,
  SendFriendRequestBody,
} from '@/types/api';

function buildQueryString(params: FriendsListQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const friendsApi = api.injectEndpoints({
  endpoints: (build) => ({
    listFriends: build.query<FriendsListResponseData, FriendsListQuery | void>({
      query: (params) => ({
        url: `/friends${buildQueryString((params ?? {}) as FriendsListQuery)}`,
      }),
      transformResponse: (response: ApiSuccessEnvelope<FriendsListResponseData>) =>
        unwrap(response),
      providesTags: ['Friends'],
    }),

    getFriendSuggestions: build.query<
      FriendSuggestionsResponseData,
      FriendSuggestionsQuery | void
    >({
      query: (params) => ({
        url: `/friends/suggestions${buildQueryString((params ?? {}) as FriendsListQuery)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<FriendSuggestionsResponseData>,
      ) => unwrap(response),
      providesTags: ['Friends'],
    }),

    getFriendshipStatus: build.query<FriendshipStatusDto, string>({
      query: (userId) => ({ url: `/friends/${encodeURIComponent(userId)}` }),
      transformResponse: (response: ApiSuccessEnvelope<FriendshipStatusDto>) =>
        unwrap(response),
      providesTags: (_result, _err, userId) => [
        { type: 'FriendStatus', id: userId },
      ],
    }),

    sendFriendRequest: build.mutation<void, SendFriendRequestBody>({
      query: (body) => ({
        url: '/friends/requests',
        method: 'POST',
        body,
      }),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'FriendStatus', id: arg.targetUserId },
        'FriendRequests',
      ],
    }),

    /** `id` accepts either the partner userId or the "<low>:<high>" form. */
    acceptFriendRequest: build.mutation<void, string>({
      query: (id) => ({
        url: `/friends/requests/${encodeURIComponent(id)}/accept`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'FriendStatus', id },
        'Friends',
        'FriendRequests',
      ],
    }),

    declineFriendRequest: build.mutation<void, string>({
      query: (id) => ({
        url: `/friends/requests/${encodeURIComponent(id)}/decline`,
        method: 'POST',
      }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'FriendStatus', id },
        'FriendRequests',
      ],
    }),

    cancelFriendRequest: build.mutation<void, string>({
      query: (id) => ({
        url: `/friends/requests/${encodeURIComponent(id)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'FriendStatus', id },
        'FriendRequests',
      ],
    }),

    unfriend: build.mutation<void, string>({
      query: (userId) => ({
        url: `/friends/${encodeURIComponent(userId)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, userId) => [
        { type: 'FriendStatus', id: userId },
        'Friends',
      ],
    }),

    listIncomingFriendRequests: build.query<FriendRequestDto[], void>({
      query: () => ({ url: '/friends/requests/incoming' }),
      transformResponse: (response: ApiSuccessEnvelope<FriendRequestDto[]>) =>
        unwrap(response),
      providesTags: ['FriendRequests'],
    }),

    listOutgoingFriendRequests: build.query<FriendRequestDto[], void>({
      query: () => ({ url: '/friends/requests/outgoing' }),
      transformResponse: (response: ApiSuccessEnvelope<FriendRequestDto[]>) =>
        unwrap(response),
      providesTags: ['FriendRequests'],
    }),
  }),
  overrideExisting: false,
});

export type FriendItem = FriendItemDto;
