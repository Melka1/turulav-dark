import {
  fetchBaseQuery,
  type BaseQueryApi,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query';
import type { RootState } from '@/store/store';
import { signedOut, tokensRefreshed } from '@/slices/authSlice';
import type {
  ApiSuccessEnvelope,
  RefreshResponseData,
} from '@/types/api';
import { env } from '@/env';

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
};

const rawBaseQuery = fetchBaseQuery({
  baseUrl: env.backendUrl,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('ngrok-skip-browser-warning', '1');
    return headers;
  },
});

let refreshPromise: Promise<string | null> | null = null;

/**
 * Single-flight refresh. Concurrent 401s share the same in-flight refresh and
 * all retry once it resolves. Returns the new access token, or `null` if the
 * refresh failed — caller must dispatch `signedOut` in that case.
 */
async function refreshAccessToken(
  api: BaseQueryApi,
  extraOptions: Record<string, unknown>,
): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = (api.getState() as RootState).auth.refreshToken;
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    const result = await rawBaseQuery(
      { url: '/auth/refresh', method: 'POST', body: { refreshToken } },
      api,
      extraOptions,
    );
    if (result.error) return null;
    const envelope = result.data as
      | ApiSuccessEnvelope<RefreshResponseData>
      | undefined;
    const session = envelope?.data?.session;
    if (!session) return null;
    const expiresAt = new Date(
      Date.now() + session.expiresIn * 1000,
    ).toISOString();
    api.dispatch(
      tokensRefreshed({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt,
      }),
    );
    return session.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

export const baseQuery: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  // Proactive refresh: if the access token has expired but a refresh token is
  // still on hand, swap the access token before issuing the request. Avoids a
  // guaranteed 401-then-retry round trip after the page sits idle past TTL.
  const state = api.getState() as RootState;
  const { accessToken, refreshToken, expiresAt } = state.auth;
  const isExpired =
    !!expiresAt && Date.parse(expiresAt) <= Date.now();
  const isRefreshCall =
    typeof args === 'object' && (args as FetchArgs).url === '/auth/refresh';
  if (accessToken && refreshToken && isExpired && !isRefreshCall) {
    const refreshed = await refreshAccessToken(api, extraOptions);
    if (!refreshed) {
      api.dispatch(signedOut());
      return {
        error: { status: 401, data: { message: 'Session expired' } },
      };
    }
  }

  let result = await rawBaseQuery(args, api, extraOptions);

  // Reactive refresh: server rejected the access token. Try once with the
  // refresh token; if that also fails, sign the user out.
  if (
    result.error &&
    result.error.status === 401 &&
    !isRefreshCall &&
    (api.getState() as RootState).auth.refreshToken
  ) {
    const refreshed = await refreshAccessToken(api, extraOptions);
    if (refreshed) {
      result = await rawBaseQuery(args, api, extraOptions);
    } else {
      api.dispatch(signedOut());
    }
  }

  return result;
};

/**
 * Pulls the `data` payload out of the wire envelope. Use as `transformResponse`
 * on every endpoint that hits the real backend.
 */
export function unwrap<T>(response: ApiSuccessEnvelope<T>): T {
  return response.data;
}

/**
 * NestJS default error envelope.
 *
 *     { statusCode, message: string | string[], error, path, timestamp, requestId }
 */
type NestErrorBody = {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  path?: string;
  timestamp?: string;
  requestId?: string;
};

function statusToCode(status: number, message: string): string {
  const m = message.toLowerCase();
  if (status === 401) return 'INVALID_CREDENTIALS';
  if (status === 403) {
    if (
      m.includes('verification') ||
      m.includes('verified') ||
      m.includes('confirm')
    )
      return 'EMAIL_UNVERIFIED';
    if (m.includes('deleted')) return 'ACCOUNT_DELETED';
    if (m.includes('suspended')) return 'ACCOUNT_SUSPENDED';
    if (m.includes('banned')) return 'ACCOUNT_BANNED';
    return 'FORBIDDEN';
  }
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) {
    if (m.includes('username')) {
      if (m.includes('reserved')) return 'USERNAME_RESERVED';
      return 'USERNAME_TAKEN';
    }
    if (m.includes('email')) return 'EMAIL_TAKEN';
    return 'CONFLICT';
  }
  if (status === 410) return 'RESTORE_EXPIRED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return `HTTP_${status}`;
}

/**
 * NestJS validation messages look like:
 *
 *     "email must be an email"
 *     "Username must be 3–24 chars, letters/digits/underscore/hyphen"
 *
 * Pull the leading identifier as the field name (lowercased).
 */
function fieldErrorsFromMessages(messages: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const msg of messages) {
    const match = msg.match(/^([A-Za-z_][\w]*)/);
    const field = match ? match[1]!.toLowerCase() : '_';
    if (!out[field]) out[field] = msg;
  }
  return out;
}

export function parseApiError(
  err: FetchBaseQueryError | undefined,
): ApiError | null {
  if (!err) return null;

  if ('data' in err && err.data && typeof err.data === 'object') {
    const body = err.data as NestErrorBody;

    if (typeof body.statusCode === 'number') {
      const isArray = Array.isArray(body.message);
      const flatMessage = isArray
        ? (body.message as string[]).join(' · ')
        : (body.message as string | undefined) ?? body.error ?? 'Request failed.';
      const code = isArray
        ? 'VALIDATION'
        : statusToCode(body.statusCode, flatMessage);
      const details: Record<string, unknown> = {};
      if (isArray) {
        details.field_errors = fieldErrorsFromMessages(body.message as string[]);
      }
      return {
        code,
        message: flatMessage,
        details: Object.keys(details).length > 0 ? details : undefined,
        requestId: body.requestId,
      };
    }
  }

  if (typeof err.status === 'number') {
    return {
      code: `HTTP_${err.status}`,
      message: 'Server returned an unexpected response.',
    };
  }

  return { code: 'NETWORK', message: 'Unable to reach the server.' };
}
