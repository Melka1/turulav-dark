import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type Toast = {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
};

export type UiState = {
  toasts: Toast[];
  verificationBannerDismissed: boolean;
};

const uiSlice = createSlice({
  name: 'ui',
  initialState: { toasts: [], verificationBannerDismissed: false } as UiState,
  reducers: {
    toastPushed(state, action: PayloadAction<Toast>) {
      state.toasts.push(action.payload);
    },
    toastDismissed(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    verificationBannerDismissed(state) {
      state.verificationBannerDismissed = true;
    },
  },
});

export const { toastPushed, toastDismissed, verificationBannerDismissed } =
  uiSlice.actions;
export const uiReducer = uiSlice.reducer;
