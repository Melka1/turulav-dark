import { store } from '@/store/store';
import { toastDismissed, toastPushed, type Toast } from '@/slices/uiSlice';

const DEFAULT_TTL_MS = 3000;
const FADE_MS = 200;
const CONTAINER_ID = 'app-toast-container';
const STYLE_ID = 'app-toast-styles';

const LEVEL_COLORS: Record<Toast['level'], { bg: string; border: string }> = {
  success: { bg: '#163a26', border: '#2e7d4f' },
  error: { bg: '#3a1f24', border: '#e84a5f' },
  warning: { bg: '#3a2f17', border: '#d4a017' },
  info: { bg: '#1f2a3a', border: '#4a7bd4' },
};

let mounted = false;
const elements = new Map<string, HTMLElement>();
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

export type ShowToastOptions = {
  level?: Toast['level'];
  message: string;
  ttl?: number;
};

export function showToast(options: ShowToastOptions): string {
  const id = generateId();
  const toast: Toast = {
    id,
    level: options.level ?? 'info',
    message: options.message,
  };
  store.dispatch(toastPushed(toast));
  const ttl = options.ttl ?? DEFAULT_TTL_MS;
  if (ttl > 0) {
    const timer = setTimeout(() => {
      store.dispatch(toastDismissed(id));
    }, ttl);
    dismissTimers.set(id, timer);
  }
  return id;
}

export function mountToastContainer(): void {
  if (mounted) return;
  mounted = true;
  ensureStyles();
  const container = ensureContainer();
  store.subscribe(() => syncToasts(container));
  syncToasts(container);
}

function syncToasts(container: HTMLElement): void {
  const toasts = store.getState().ui.toasts;
  const liveIds = new Set(toasts.map((t) => t.id));

  for (const toast of toasts) {
    if (!elements.has(toast.id)) {
      const el = renderToast(toast);
      elements.set(toast.id, el);
      container.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
    }
  }

  for (const [id, el] of elements) {
    if (liveIds.has(id)) continue;
    elements.delete(id);
    const timer = dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), FADE_MS);
  }
}

function renderToast(toast: Toast): HTMLElement {
  const colors = LEVEL_COLORS[toast.level];
  const el = document.createElement('div');
  el.className = 'app-toast';
  el.setAttribute('role', toast.level === 'error' ? 'alert' : 'status');
  el.style.background = colors.bg;
  el.style.borderLeft = `4px solid ${colors.border}`;
  el.textContent = toast.message;
  el.addEventListener('click', () => {
    store.dispatch(toastDismissed(toast.id));
  });
  return el;
}

function ensureContainer(): HTMLElement {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;
  container = document.createElement('div');
  container.id = CONTAINER_ID;
  document.body.appendChild(container);
  return container;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${CONTAINER_ID} {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      max-width: calc(100vw - 32px);
    }
    #${CONTAINER_ID} .app-toast {
      pointer-events: auto;
      min-width: 240px;
      max-width: 440px;
      padding: 12px 18px;
      border-radius: 6px;
      color: #fff;
      font-size: 14px;
      line-height: 1.4;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      cursor: pointer;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
    }
  `;
  document.head.appendChild(style);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
