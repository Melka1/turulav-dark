const backendUrl =
  import.meta.env.VITE_BACKEND_URL ??
  'https://5e04-102-213-68-44.ngrok-free.app/api/v1';

// Socket.io attaches at /socket.io on the backend's root origin — strip the
// /api/v1 (or any path) from backendUrl when VITE_API_HOST isn't set.
const apiHost =
  import.meta.env.VITE_API_HOST ?? new URL(backendUrl).origin;

export const env = {
  backendUrl,
  apiHost,
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
} as const;
