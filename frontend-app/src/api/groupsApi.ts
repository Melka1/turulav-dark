import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  GroupDto,
  GroupSuggestionsQuery,
  GroupSuggestionsResponseData,
  SearchGroupsQuery,
  SearchGroupsResponseData,
} from '@/types/api';

function buildQueryString(
  params: SearchGroupsQuery | GroupSuggestionsQuery,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const groupsApi = api.injectEndpoints({
  endpoints: (build) => ({
    searchGroups: build.query<SearchGroupsResponseData, SearchGroupsQuery>({
      query: (params) => ({ url: `/groups/search${buildQueryString(params)}` }),
      transformResponse: (
        response: ApiSuccessEnvelope<SearchGroupsResponseData>,
      ) => unwrap(response),
      providesTags: ['Search'],
    }),
    getMyGroups: build.query<GroupDto[], void>({
      query: () => ({ url: '/groups/me' }),
      transformResponse: (response: ApiSuccessEnvelope<GroupDto[]>) =>
        unwrap(response),
      providesTags: ['Me'],
    }),
    getGroupSuggestions: build.query<
      GroupSuggestionsResponseData,
      GroupSuggestionsQuery | void
    >({
      query: (params) => ({
        url: `/groups/suggestions${buildQueryString((params ?? {}) as GroupSuggestionsQuery)}`,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<GroupSuggestionsResponseData>,
      ) => unwrap(response),
      providesTags: ['Search'],
    }),
  }),
  overrideExisting: false,
});
