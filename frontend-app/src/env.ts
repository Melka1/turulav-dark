export const env = {
  backendUrl:
    import.meta.env.VITE_BACKEND_URL ??
    'https://e5ac-102-208-96-119.ngrok-free.app/api/v1',
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
} as const;
