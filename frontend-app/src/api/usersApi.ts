import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  PublicUserDto,
  UserWithProfileDto,
} from '@/types/api';

export const usersApi = api.injectEndpoints({
  endpoints: (build) => ({
    getMe: build.query<UserWithProfileDto, void>({
      query: () => ({ url: '/users/me' }),
      transformResponse: (response: ApiSuccessEnvelope<UserWithProfileDto>) =>
        unwrap(response),
      providesTags: ['Me'],
    }),
    getUserById: build.query<PublicUserDto, string>({
      query: (id) => ({ url: `/users/${id}` }),
      transformResponse: (response: ApiSuccessEnvelope<PublicUserDto>) =>
        unwrap(response),
      providesTags: (_result, _err, id) => [{ type: 'Users', id }],
    }),
    // Fired once at session start. The matching DELETE is sent via
    // navigator.sendBeacon on tab close (so it survives unload), not through
    // RTK Query — see src/lib/presence.ts.
    presenceOnline: build.mutation<void, void>({
      query: () => ({ url: '/users/me/presence', method: 'POST' }),
    }),
  }),
  overrideExisting: false,
});
