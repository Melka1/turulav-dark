export const env = {
  backendUrl:
    import.meta.env.VITE_BACKEND_URL ??
    'https://5e04-102-213-68-44.ngrok-free.app/api/v1',
  useMocks: import.meta.env.VITE_USE_MOCKS === 'true',
  mode: import.meta.env.MODE,
  isDev: import.meta.env.DEV,
} as const;
