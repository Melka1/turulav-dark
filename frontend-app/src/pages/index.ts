import type { AppDispatch, RootState } from '@/store/store';

export type PageContext = {
  page: string;
  dispatch: AppDispatch;
  getState: () => RootState;
};

export type PageBinder = (ctx: PageContext) => void | Promise<void>;

const binders: Record<string, PageBinder> = {};

export function registerPage(name: string, binder: PageBinder): void {
  binders[name] = binder;
}

export async function runPage(ctx: PageContext): Promise<void> {
  const binder = binders[ctx.page];
  if (!binder) {
    console.debug(`[pages] no binder registered for "${ctx.page}"`);
    return;
  }
  try {
    await binder(ctx);
  } catch (err) {
    console.error(`[pages] binder for "${ctx.page}" threw`, err);
  }
}

export function readCurrentPage(): string {
  const body = document.body;
  return body.getAttribute('data-app-page') ?? 'unknown';
}
