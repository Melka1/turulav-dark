/**
 * Supabase email-confirmation redirects land on the configured Site URL
 * (signup.html in our case) with the issued session in the URL — either as
 * a hash fragment (implicit flow):
 *
 *     /signup.html#access_token=…&refresh_token=…&expires_in=3600&token_type=bearer&type=signup
 *
 * or, for some redirect configs, as query params. Strip them off the URL
 * and hand back the parsed session so the page binder can sign the user in.
 */

const SESSION_PARAM_KEYS = [
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'type',
  'provider_token',
  'provider_refresh_token',
] as const;

export type AuthCallback = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  type: string | null;
};

export function readAuthCallback(): AuthCallback | null {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : '';
  const fromHash = new URLSearchParams(hash);
  const fromQuery = new URLSearchParams(window.location.search);

  const accessToken =
    fromHash.get('access_token') ?? fromQuery.get('access_token');
  if (!accessToken) return null;

  const refreshToken =
    fromHash.get('refresh_token') ?? fromQuery.get('refresh_token') ?? '';
  const expiresInRaw =
    fromHash.get('expires_in') ?? fromQuery.get('expires_in');
  const expiresIn = expiresInRaw ? Number(expiresInRaw) : 3600;

  return {
    accessToken,
    refreshToken,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
    type: fromHash.get('type') ?? fromQuery.get('type'),
  };
}

export function clearAuthCallbackFromUrl(): void {
  const url = new URL(window.location.href);
  url.hash = '';
  for (const key of SESSION_PARAM_KEYS) url.searchParams.delete(key);
  window.history.replaceState(null, '', url.toString());
}

function base64UrlDecode(input: string): string {
  const base = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base + '='.repeat((4 - (base.length % 4)) % 4);
  const binary = atob(padded);
  try {
    return decodeURIComponent(
      Array.from(binary, (c) =>
        '%' + c.charCodeAt(0).toString(16).padStart(2, '0'),
      ).join(''),
    );
  } catch {
    return binary;
  }
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function userIdFromJwt(token: string): string | null {
  const payload = decodeJwtPayload(token);
  return payload && typeof payload.sub === 'string' ? payload.sub : null;
}

export function usernameFromJwt(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const meta =
    payload && typeof payload.user_metadata === 'object'
      ? (payload.user_metadata as Record<string, unknown>)
      : null;
  return meta && typeof meta.username === 'string' ? meta.username : null;
}
