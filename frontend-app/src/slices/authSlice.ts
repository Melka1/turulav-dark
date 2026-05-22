import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null; // ISO 8601, computed from session.expiresIn at login time
  userId: string | null;
  status: 'idle' | 'authenticated' | 'unauthenticated';
};

const ACCESS_TOKEN_KEY = 'turulav.access_token';
const REFRESH_TOKEN_KEY = 'turulav.refresh_token';
const EXPIRES_AT_KEY = 'turulav.expires_at';
const USER_ID_KEY = 'turulav.user_id';

function hydrate(): AuthState {
  if (typeof window === 'undefined') {
    return {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      userId: null,
      status: 'idle',
    };
  }
  const accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  const expiresAt = window.localStorage.getItem(EXPIRES_AT_KEY);
  const userId = window.localStorage.getItem(USER_ID_KEY);
  return {
    accessToken,
    refreshToken,
    expiresAt,
    userId,
    status: accessToken && userId ? 'authenticated' : 'unauthenticated',
  };
}

function persist(state: AuthState): void {
  if (typeof window === 'undefined') return;
  const set = (k: string, v: string | null): void => {
    if (v) window.localStorage.setItem(k, v);
    else window.localStorage.removeItem(k);
  };
  set(ACCESS_TOKEN_KEY, state.accessToken);
  set(REFRESH_TOKEN_KEY, state.refreshToken);
  set(EXPIRES_AT_KEY, state.expiresAt);
  set(USER_ID_KEY, state.userId);
}

type SignedInPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
};

const authSlice = createSlice({
  name: 'auth',
  initialState: hydrate(),
  reducers: {
    signedIn(state, action: PayloadAction<SignedInPayload>) {
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.expiresAt = action.payload.expiresAt;
      state.userId = action.payload.userId;
      state.status = 'authenticated';
      persist(state);
    },
    tokensRefreshed(
      state,
      action: PayloadAction<{ accessToken: string; expiresAt: string }>,
    ) {
      state.accessToken = action.payload.accessToken;
      state.expiresAt = action.payload.expiresAt;
      persist(state);
    },
    signedOut(state) {
      state.accessToken = null;
      state.refreshToken = null;
      state.expiresAt = null;
      state.userId = null;
      state.status = 'unauthenticated';
      persist(state);
    },
  },
});

export const { signedIn, tokensRefreshed, signedOut } = authSlice.actions;
export const authReducer = authSlice.reducer;
