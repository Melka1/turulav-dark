import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  NewMembersListQuery,
  NewMembersListResponseData,
  ProfileDto,
  PublicProfileDto,
  SearchProfilesQuery,
  SearchProfilesResponseData,
  UpdateMyProfileBody,
} from '@/types/api';

function buildQueryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
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
    getNewMembers: build.query<
      NewMembersListResponseData,
      NewMembersListQuery | void
    >({
      query: (params) => ({
        url: `/profiles/new${buildQueryString(params ?? {})}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<NewMembersListResponseData>,
      ) => unwrap(response),
      providesTags: ['Profiles'],
    }),
    getProfileById: build.query<PublicProfileDto, string>({
      query: (userId) => ({ url: `/profiles/${userId}` }),
      transformResponse: (response: ApiSuccessEnvelope<PublicProfileDto>) =>
        unwrap(response),
      providesTags: (_result, _err, userId) => [{ type: 'Profile', id: userId }],
    }),
    // `PATCH /profiles/me` accepts either JSON or multipart/form-data. Pass a
    // `FormData` when uploading `avatar` / `cover` files (numbers come through
    // as strings, arrays as JSON-stringified text or repeated keys — the server
    // coerces). Pass the JSON body shape for plain field edits.
    updateMyProfile: build.mutation<ProfileDto, UpdateMyProfileBody | FormData>({
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
