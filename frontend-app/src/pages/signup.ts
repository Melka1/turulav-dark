import { authApi } from '@/api/authApi';
import { parseApiError } from '@/api/baseQuery';
import { usersApi } from '@/api/usersApi';
import { registerPage, type PageBinder, type PageContext } from '@/pages';
import {
  clearFieldErrors,
  serializeForm,
  setFieldError,
  setFormBusy,
} from '@/lib/form';
import {
  clearAuthCallbackFromUrl,
  readAuthCallback,
  userIdFromJwt,
  type AuthCallback,
} from '@/lib/authCallback';
import { showToast } from '@/lib/toast';
import { signedIn, signedOut } from '@/slices/authSlice';
import type { SignupRequest, UsernameSuggestionResponseData } from '@/types/api';

const POST_VERIFY_DESTINATION = '/profile.html';
const SUGGEST_DEBOUNCE_MS = 300;
const MIN_DISPLAY_NAME_LENGTH = 2;
const STYLE_ID = 'app-signup-username-styles';

const SUCCESS_VIEW = `
  <div data-app-target="signup-success" class="signup-success">
    <h3 class="title">Check your inbox</h3>
    <p>
      We sent a verification link to
      <strong data-app-field="email-shown"></strong>.
      Click it to activate your account, then sign in.
    </p>
    <p>
      Didn't get the email?
      <a href="#" data-app-action="resend-verification">Resend it</a>
    </p>
  </div>
`;

type SuggestionState = {
  available: boolean;
  username: string;
};

const bindSignup: PageBinder = async ({ dispatch }) => {
  const callback = readAuthCallback();
  if (callback) {
    await handleEmailConfirmed(callback, dispatch);
    return;
  }

  const form = document.querySelector<HTMLFormElement>(
    'form[data-app-form="signup"]',
  );
  if (!form) {
    console.warn('[signup] no form[data-app-form="signup"] on this page');
    return;
  }

  ensureStyles();

  const displayNameInput = form.elements.namedItem(
    'displayName',
  ) as HTMLInputElement | null;
  const usernameInput = form.elements.namedItem(
    'username',
  ) as HTMLInputElement | null;
  if (!displayNameInput || !usernameInput) {
    console.warn('[signup] expected displayName + hidden username inputs');
    return;
  }

  const state: SuggestionState = { available: false, username: '' };
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastQuery = '';
  let requestSeq = 0;

  const runSuggestion = async (rawDisplayName: string): Promise<void> => {
    const displayName = rawDisplayName.trim();
    if (displayName.length < MIN_DISPLAY_NAME_LENGTH) {
      resetPreview(form);
      state.available = false;
      state.username = '';
      usernameInput.value = '';
      return;
    }
    if (displayName === lastQuery) return;
    lastQuery = displayName;

    showPreviewLoading(form, displayName);
    const seq = ++requestSeq;
    try {
      const result = await dispatch(
        authApi.endpoints.suggestUsername.initiate({ displayName }),
      ).unwrap();
      if (seq !== requestSeq) return;
      applySuggestion(form, result, (picked) => {
        state.available = true;
        state.username = picked;
        usernameInput.value = picked;
      });
      if (result.available) {
        state.available = true;
        state.username = result.username;
        usernameInput.value = result.username;
      } else {
        state.available = false;
        state.username = '';
        usernameInput.value = '';
      }
    } catch (raw) {
      if (seq !== requestSeq) return;
      console.warn('[signup] username suggestion failed', raw);
      showPreviewError(form, "Couldn't reach the server. Try again.");
      state.available = false;
      state.username = '';
      usernameInput.value = '';
    }
  };

  displayNameInput.addEventListener('input', () => {
    clearFieldErrors(form);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSuggestion(displayNameInput.value);
    }, SUGGEST_DEBOUNCE_MS);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const values = serializeForm(form);
    const displayName = (values.displayName ?? '').trim();
    const confirm = values.password_confirm ?? '';

    if (displayName.length < MIN_DISPLAY_NAME_LENGTH) {
      setFieldError(
        form,
        'displayName',
        `Display name must be at least ${MIN_DISPLAY_NAME_LENGTH} characters.`,
      );
      return;
    }

    if (!state.available || !state.username) {
      setFieldError(
        form,
        'displayName',
        'Pick an available @handle before continuing.',
      );
      return;
    }

    const body: SignupRequest = {
      email: (values.email ?? '').trim(),
      password: values.password ?? '',
      displayName,
      username: state.username,
    };

    if (body.password !== confirm) {
      setFieldError(form, 'password_confirm', 'Passwords do not match.');
      return;
    }

    setFormBusy(form, true);
    try {
      await dispatch(authApi.endpoints.signup.initiate(body)).unwrap();
      renderSuccess(form, body.email, dispatch);
    } catch (raw) {
      const apiErr = parseApiError(
        raw as Parameters<typeof parseApiError>[0],
      );
      await applyError(form, apiErr, displayName, (next) => {
        state.available = next.available;
        state.username = next.username;
        usernameInput.value = next.username;
      });
    } finally {
      setFormBusy(form, false);
    }
  });

  async function applyError(
    form: HTMLFormElement,
    err: ReturnType<typeof parseApiError>,
    displayName: string,
    setState: (next: SuggestionState) => void,
  ): Promise<void> {
    if (!err) {
      setFieldError(form, 'password', 'Something went wrong. Try again.');
      return;
    }
    if (err.code === 'USERNAME_TAKEN') {
      showToast({
        level: 'warning',
        message: 'That @handle was just taken — pick another.',
      });
      setState({ available: false, username: '' });
      lastQuery = '';
      await runSuggestion(displayName);
      return;
    }
    if (err.code === 'USERNAME_RESERVED') {
      setFieldError(form, 'displayName', err.message);
      setState({ available: false, username: '' });
      lastQuery = '';
      await runSuggestion(displayName);
      return;
    }
    if (err.code === 'EMAIL_TAKEN') {
      setFieldError(form, 'email', err.message);
      return;
    }
    if (err.code === 'VALIDATION') {
      const fieldErrors =
        (err.details?.field_errors as Record<string, string> | undefined) ?? {};
      let applied = 0;
      for (const [field, message] of Object.entries(fieldErrors)) {
        const target =
          form.elements.namedItem(field) !== null ? field : field.toLowerCase();
        setFieldError(form, target, message);
        applied++;
      }
      if (applied === 0) {
        setFieldError(form, 'password', err.message);
      }
      return;
    }
    setFieldError(form, 'password', err.message);
  }
};

function previewNodes(form: HTMLFormElement): {
  wrapper: HTMLElement | null;
  status: HTMLElement | null;
  suggestions: HTMLElement | null;
} {
  return {
    wrapper: form.querySelector<HTMLElement>(
      '[data-app-target="username-preview"]',
    ),
    status: form.querySelector<HTMLElement>(
      '[data-app-field="username-status"]',
    ),
    suggestions: form.querySelector<HTMLElement>(
      '[data-app-field="username-suggestions"]',
    ),
  };
}

function resetPreview(form: HTMLFormElement): void {
  const { wrapper, status, suggestions } = previewNodes(form);
  if (wrapper) wrapper.hidden = true;
  if (status) {
    status.textContent = '';
    status.dataset.state = '';
  }
  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.hidden = true;
  }
}

function showPreviewLoading(form: HTMLFormElement, displayName: string): void {
  const { wrapper, status, suggestions } = previewNodes(form);
  if (wrapper) wrapper.hidden = false;
  if (status) {
    status.dataset.state = 'loading';
    status.textContent = `Checking handle for "${displayName}"…`;
  }
  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.hidden = true;
  }
}

function showPreviewError(form: HTMLFormElement, message: string): void {
  const { wrapper, status, suggestions } = previewNodes(form);
  if (wrapper) wrapper.hidden = false;
  if (status) {
    status.dataset.state = 'error';
    status.textContent = message;
  }
  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.hidden = true;
  }
}

function applySuggestion(
  form: HTMLFormElement,
  result: UsernameSuggestionResponseData,
  onPick: (username: string) => void,
): void {
  const { wrapper, status, suggestions } = previewNodes(form);
  if (wrapper) wrapper.hidden = false;
  if (!status || !suggestions) return;

  if (result.username === '') {
    status.dataset.state = 'invalid';
    status.textContent = 'Please use at least 2 letters/digits.';
    suggestions.innerHTML = '';
    suggestions.hidden = true;
    return;
  }

  if (result.available) {
    status.dataset.state = 'available';
    status.textContent = `@${result.username} is available`;
    suggestions.innerHTML = '';
    suggestions.hidden = true;
    return;
  }

  status.dataset.state = 'taken';
  status.textContent = `@${result.username} is taken`;
  suggestions.innerHTML = '';
  if (result.suggestions.length === 0) {
    suggestions.hidden = true;
    return;
  }
  suggestions.hidden = false;
  for (const handle of result.suggestions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'username-chip';
    chip.dataset.appAction = 'pick-username';
    chip.textContent = `@${handle}`;
    chip.addEventListener('click', () => {
      onPick(handle);
      status.dataset.state = 'available';
      status.textContent = `@${handle} is available`;
      suggestions.innerHTML = '';
      suggestions.hidden = true;
    });
    suggestions.appendChild(chip);
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .username-preview {
      margin-top: 6px;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .username-preview-status {
      min-height: 1.2em;
      color: #b6c0cc;
    }
    .username-preview-status[data-state="available"] {
      color: #2ecc71;
    }
    .username-preview-status[data-state="taken"],
    .username-preview-status[data-state="invalid"],
    .username-preview-status[data-state="error"] {
      color: #e84a5f;
    }
    .username-preview-suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .username-chip {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: inherit;
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 0.85rem;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .username-chip:hover,
    .username-chip:focus-visible {
      background: rgba(46, 204, 113, 0.18);
      border-color: #2ecc71;
      outline: none;
    }
  `;
  document.head.appendChild(style);
}

async function handleEmailConfirmed(
  cb: AuthCallback,
  dispatch: PageContext['dispatch'],
): Promise<void> {
  clearAuthCallbackFromUrl();

  const userId = userIdFromJwt(cb.accessToken);
  if (!userId) {
    console.warn('[signup] auth callback present but JWT had no sub claim');
    renderVerificationError(
      "We couldn't read the confirmation link. Please log in.",
    );
    return;
  }

  const expiresAt = new Date(Date.now() + cb.expiresIn * 1000).toISOString();
  dispatch(
    signedIn({
      userId,
      accessToken: cb.accessToken,
      refreshToken: cb.refreshToken,
      expiresAt,
    }),
  );

  try {
    await dispatch(usersApi.endpoints.getMe.initiate()).unwrap();
    window.location.replace(POST_VERIFY_DESTINATION);
  } catch (err) {
    console.warn('[signup] /users/me failed after email confirmation', err);
    dispatch(signedOut());
    renderVerificationError(
      "Your confirmation link couldn't be used. Please log in.",
    );
  }
}

function renderVerificationError(message: string): void {
  const wrapper = document.querySelector<HTMLElement>('.account-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = `
    <h3 class="title">Email confirmed</h3>
    <p>${message}</p>
    <p><a href="/login.html">Go to login</a></p>
  `;
}

function renderSuccess(
  form: HTMLFormElement,
  email: string,
  dispatch: PageContext['dispatch'],
): void {
  const wrapper = form.closest('.account-wrapper') ?? form.parentElement;
  if (!wrapper) return;
  const title = wrapper.querySelector('.title');
  if (title) title.remove();
  form.outerHTML = SUCCESS_VIEW;
  const emailNode = document.querySelector<HTMLElement>(
    '[data-app-field="email-shown"]',
  );
  if (emailNode) emailNode.textContent = email;
  bindResend(email, dispatch);
}

function bindResend(email: string, dispatch: PageContext['dispatch']): void {
  const link = document.querySelector<HTMLAnchorElement>(
    '[data-app-action="resend-verification"]',
  );
  if (!link) return;
  let busy = false;
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const original = link.textContent ?? 'Resend it';
    link.textContent = 'Sending…';
    try {
      await dispatch(
        authApi.endpoints.resendVerification.initiate({ email }),
      ).unwrap();
      link.textContent = 'Sent — check your inbox.';
      link.style.pointerEvents = 'none';
    } catch {
      link.textContent = 'Could not resend — try again.';
      busy = false;
      window.setTimeout(() => {
        link.textContent = original;
      }, 3000);
    }
  });
}

registerPage('signup', bindSignup);
