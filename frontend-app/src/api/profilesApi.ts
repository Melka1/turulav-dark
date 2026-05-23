import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  ProfileDto,
  PublicProfileDto,
  SearchProfilesQuery,
  SearchProfilesResponseData,
  UpdateMyProfileBody,
} from '@/types/api';

function buildQueryString(params: SearchProfilesQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const profilesApi = api.injectEndpoints({
  endpoints: (build) => ({
    searchProfiles: build.query<
      SearchProfilesResponseData,
      SearchProfilesQuery
    >({
      query: (params) => ({ url: `/profiles/search${buildQueryString(params)}` }),
      transformResponse: (
        response: ApiSuccessEnvelope<SearchProfilesResponseData>,
      ) => unwrap(response),
      providesTags: ['Search'],
    }),
    getProfileById: build.query<PublicProfileDto, string>({
      query: (userId) => ({ url: `/profiles/${userId}` }),
      transformResponse: (response: ApiSuccessEnvelope<PublicProfileDto>) =>
        unwrap(response),
      providesTags: (_result, _err, userId) => [{ type: 'Profile', id: userId }],
    }),
    updateMyProfile: build.mutation<ProfileDto, UpdateMyProfileBody>({
      query: (body) => ({
        url: '/profiles/me',
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: ApiSuccessEnvelope<ProfileDto>) =>
        unwrap(response),
      invalidatesTags: ['Me', 'Search'],
    }),
  }),
  overrideExisting: false,
});
