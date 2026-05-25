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
import { signedIn, signedOut } from '@/slices/authSlice';
import type { SignupRequest } from '@/types/api';

const POST_VERIFY_DESTINATION = '/profile.html';

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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const values = serializeForm(form);
    const body: SignupRequest = {
      username: (values.username ?? '').trim(),
      email: (values.email ?? '').trim(),
      password: values.password ?? '',
    };
    const confirm = values.password_confirm ?? '';

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
      applyError(form, apiErr);
    } finally {
      setFormBusy(form, false);
    }
  });
};

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

function applyError(
  form: HTMLFormElement,
  err: ReturnType<typeof parseApiError>,
): void {
  if (!err) {
    setFieldError(form, 'password', 'Something went wrong. Try again.');
    return;
  }
  if (err.code === 'USERNAME_TAKEN') {
    setFieldError(form, 'username', err.message);
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
