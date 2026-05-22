export const env = {
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000/api/v1',
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
} as const;
