const STYLE_ID = 'app-confirm-modal-styles';
const ROOT_ID = 'app-confirm-modal-root';

export type ConfirmInputSpec = {
  label: string;
  placeholder?: string;
  /** If true, an empty value is accepted. Defaults to false (required). */
  optional?: boolean;
  maxLength?: number;
  multiline?: boolean;
};

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in a destructive red style. */
  danger?: boolean;
  input?: ConfirmInputSpec;
};

export type ConfirmResult = {
  confirmed: boolean;
  /** The trimmed input value when an input was rendered, otherwise null. */
  inputValue: string | null;
};

export function showConfirm(opts: ConfirmOptions): Promise<ConfirmResult> {
  ensureStyles();
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'app-confirm-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const inputId = opts.input ? `app-confirm-input-${Date.now()}` : '';
    const inputField = opts.input
      ? opts.input.multiline
        ? `<textarea id="${inputId}" class="app-confirm-input" rows="3"
             ${opts.input.maxLength ? `maxlength="${opts.input.maxLength}"` : ''}
             placeholder="${escapeAttr(opts.input.placeholder ?? '')}"></textarea>`
        : `<input id="${inputId}" type="text" class="app-confirm-input"
             ${opts.input.maxLength ? `maxlength="${opts.input.maxLength}"` : ''}
             placeholder="${escapeAttr(opts.input.placeholder ?? '')}">`
      : '';

    const inputBlock = opts.input
      ? `<label class="app-confirm-input-label" for="${inputId}">
           ${escapeText(opts.input.label)}
           ${opts.input.optional ? '<span class="app-confirm-optional">(optional)</span>' : ''}
         </label>
         ${inputField}`
      : '';

    root.innerHTML = `
      <div class="app-confirm-dialog">
        <h4 class="app-confirm-title">${escapeText(opts.title)}</h4>
        <p class="app-confirm-message">${escapeText(opts.message)}</p>
        ${inputBlock}
        <div class="app-confirm-actions">
          <button type="button" class="app-confirm-btn app-confirm-cancel">
            ${escapeText(opts.cancelLabel ?? 'Cancel')}
          </button>
          <button type="button"
                  class="app-confirm-btn app-confirm-ok ${opts.danger ? 'is-danger' : ''}">
            ${escapeText(opts.confirmLabel ?? 'Confirm')}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    const inputEl = opts.input
      ? root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          '.app-confirm-input',
        )
      : null;
    const cancelBtn = root.querySelector<HTMLButtonElement>(
      '.app-confirm-cancel',
    )!;
    const okBtn = root.querySelector<HTMLButtonElement>('.app-confirm-ok')!;

    let settled = false;
    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      const inputValue = inputEl ? inputEl.value.trim() : null;
      document.removeEventListener('keydown', onKeyDown);
      root.remove();
      resolve({ confirmed, inputValue });
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      if (
        event.key === 'Enter' &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        finish(true);
      }
    };

    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    root.addEventListener('click', (event) => {
      if (event.target === root) finish(false);
    });
    document.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => {
      root.classList.add('is-open');
      if (inputEl) inputEl.focus();
      else okBtn.focus();
    });
  });
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .app-confirm-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      padding: 16px;
      opacity: 0;
      transition: opacity 140ms ease;
    }
    .app-confirm-overlay.is-open { opacity: 1; }
    .app-confirm-dialog {
      width: 100%;
      max-width: 420px;
      background: #1f1418;
      border: 1px solid #3a1f24;
      border-radius: 8px;
      padding: 22px 24px 18px;
      color: #fff;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
      transform: translateY(8px);
      transition: transform 140ms ease;
    }
    .app-confirm-overlay.is-open .app-confirm-dialog {
      transform: translateY(0);
    }
    .app-confirm-title {
      margin: 0 0 8px;
      font-size: 18px;
      font-weight: 600;
    }
    .app-confirm-message {
      margin: 0 0 14px;
      font-size: 14px;
      line-height: 1.5;
      opacity: 0.85;
    }
    .app-confirm-input-label {
      display: block;
      margin: 0 0 6px;
      font-size: 13px;
      font-weight: 500;
    }
    .app-confirm-optional {
      margin-left: 6px;
      opacity: 0.6;
      font-weight: 400;
    }
    .app-confirm-input {
      width: 100%;
      padding: 9px 12px;
      border-radius: 6px;
      border: 1px solid #3a1f24;
      background: #15090c;
      color: #fff;
      font-size: 14px;
      line-height: 1.4;
      font-family: inherit;
      box-sizing: border-box;
      margin-bottom: 16px;
      resize: vertical;
    }
    .app-confirm-input:focus {
      outline: none;
      border-color: #d63b50;
      box-shadow: 0 0 0 2px rgba(214, 59, 80, 0.25);
    }
    .app-confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .app-confirm-btn {
      appearance: none;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
      font-family: inherit;
    }
    .app-confirm-cancel {
      background: transparent;
      border-color: #3a1f24;
      color: #fff;
    }
    .app-confirm-cancel:hover { background: #2a161a; }
    .app-confirm-ok {
      background: #2e7d4f;
      color: #fff;
    }
    .app-confirm-ok:hover { background: #266a43; }
    .app-confirm-ok.is-danger { background: #d63b50; }
    .app-confirm-ok.is-danger:hover { background: #b8303f; }
    .app-confirm-ok:focus-visible,
    .app-confirm-cancel:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(style);
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}
