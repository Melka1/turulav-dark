import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { seedFixtures } from './fixtures';

export const worker = setupWorker(...handlers);

export async function startMocks(): Promise<void> {
  seedFixtures();
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
  console.info('[msw] mock service worker started');
}
