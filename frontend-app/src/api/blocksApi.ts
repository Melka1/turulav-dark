import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  BlockUserBody,
  BlockedUserDto,
} from '@/types/api';

export const blocksApi = api.injectEndpoints({
  endpoints: (build) => ({
    listBlocks: build.query<BlockedUserDto[], void>({
      query: () => ({ url: '/blocks' }),
      transformResponse: (response: ApiSuccessEnvelope<BlockedUserDto[]>) =>
        unwrap(response),
      providesTags: ['Blocks'],
    }),

    blockUser: build.mutation<void, BlockUserBody>({
      query: ({ targetUserId, reason }) => ({
        url: `/blocks/${encodeURIComponent(targetUserId)}`,
        method: 'POST',
        body: reason ? { reason } : {},
      }),
      invalidatesTags: (_r, _e, arg) => [
        'Blocks',
        'Friends',
        'FriendRequests',
        { type: 'FriendStatus', id: arg.targetUserId },
      ],
    }),

    unblockUser: build.mutation<void, string>({
      query: (targetUserId) => ({
        url: `/blocks/${encodeURIComponent(targetUserId)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, targetUserId) => [
        'Blocks',
        { type: 'FriendStatus', id: targetUserId },
      ],
    }),
  }),
  overrideExisting: false,
});
