import { api } from './api';
import { unwrap } from './baseQuery';
import type {
  ApiSuccessEnvelope,
  LoginRequest,
  LoginResponseData,
  RefreshRequest,
  RefreshResponseData,
  SignupRequest,
  SignupResponseData,
  UsernameSuggestionRequest,
  UsernameSuggestionResponseData,
} from '@/types/api';

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    signup: build.mutation<SignupResponseData, SignupRequest>({
      query: (body) => ({ url: '/auth/signup', method: 'POST', body }),
      transformResponse: (response: ApiSuccessEnvelope<SignupResponseData>) =>
        unwrap(response),
    }),
    login: build.mutation<LoginResponseData, LoginRequest>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      transformResponse: (response: ApiSuccessEnvelope<LoginResponseData>) =>
        unwrap(response),
      invalidatesTags: ['Me'],
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
    }),
    refresh: build.mutation<RefreshResponseData, RefreshRequest>({
      query: (body) => ({ url: '/auth/refresh', method: 'POST', body }),
      transformResponse: (response: ApiSuccessEnvelope<RefreshResponseData>) =>
        unwrap(response),
    }),
    resendVerification: build.mutation<void, { email: string }>({
      query: (body) => ({
        url: '/auth/resend-verification',
        method: 'POST',
        body,
      }),
    }),
    suggestUsername: build.mutation<
      UsernameSuggestionResponseData,
      UsernameSuggestionRequest
    >({
      query: (body) => ({
        url: '/auth/username-suggestions',
        method: 'POST',
        body,
      }),
      transformResponse: (
        response: ApiSuccessEnvelope<UsernameSuggestionResponseData>,
      ) => unwrap(response),
    }),
  }),
  overrideExisting: false,
});
