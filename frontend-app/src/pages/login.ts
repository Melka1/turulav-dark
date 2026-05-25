import { authApi } from '@/api/authApi';
import { parseApiError } from '@/api/baseQuery';
import { registerPage, type PageBinder } from '@/pages';
import { signedIn } from '@/slices/authSlice';
import {
  clearFieldErrors,
  serializeForm,
  setFieldError,
  setFormBusy,
} from '@/lib/form';
import type { LoginRequest } from '@/types/api';

function nextDestination(): string {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next && /^\/?[\w.\-/]+$/.test(next)) return next;
  return '/profile.html';
}

const bindLogin: PageBinder = ({ dispatch }) => {
  const form = document.querySelector<HTMLFormElement>(
    'form[data-app-form="login"]',
  );
  if (!form) {
    console.warn('[login] no form[data-app-form="login"] on this page');
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    clearFormBanner(form);

    const values = serializeForm(form);
    const body: LoginRequest = {
      email: (values.email ?? '').trim(),
      password: values.password ?? '',
    };

    if (!body.email || !body.password) {
      if (!body.email) setFieldError(form, 'email', 'Enter your email.');
      if (!body.password) setFieldError(form, 'password', 'Enter your password.');
      return;
    }

    setFormBusy(form, true);
    try {
      const result = await dispatch(
        authApi.endpoints.login.initiate(body),
      ).unwrap();
      const expiresAt = new Date(
        Date.now() + result.session.expiresIn * 1000,
      ).toISOString();
      dispatch(
        signedIn({
          userId: result.userId,
          accessToken: result.session.accessToken,
          refreshToken: result.session.refreshToken,
          expiresAt,
        }),
      );
      window.location.assign(nextDestination());
    } catch (raw) {
      const apiErr = parseApiError(raw as Parameters<typeof parseApiError>[0]);
      applyError(form, apiErr);
    } finally {
      setFormBusy(form, false);
    }
  });
};

function applyError(
  form: HTMLFormElement,
  err: ReturnType<typeof parseApiError>,
): void {
  if (!err) {
    showFormBanner(
      form,
      'Something went wrong. Check your connection and try again.',
    );
    return;
  }
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      // The backend returns 401 for wrong password, unknown email, AND
      // unverified accounts. We can't tell them apart, so we surface the
      // generic message and a verification hint.
      showFormBanner(
        form,
        "Invalid email or password. If you just signed up, click the verification link we emailed you first.",
      );
      return;
    case 'ACCOUNT_DELETED':
      showFormBanner(
        form,
        'This account is scheduled for deletion. Check your email for the restore link.',
      );
      return;
    case 'ACCOUNT_SUSPENDED':
      showFormBanner(form, 'This account is suspended.');
      return;
    case 'ACCOUNT_BANNED':
      showFormBanner(form, 'This account has been banned.');
      return;
    case 'RATE_LIMITED':
      showFormBanner(form, 'Too many attempts. Please try again in a moment.');
      return;
    case 'VALIDATION': {
      const fieldErrors =
        (err.details?.field_errors as Record<string, string> | undefined) ?? {};
      for (const [field, message] of Object.entries(fieldErrors)) {
        setFieldError(form, field, message);
      }
      return;
    }
    default:
      showFormBanner(form, err.message);
  }
}

const BANNER_CLASS = 'app-form-banner';

function showFormBanner(form: HTMLFormElement, message: string): void {
  let banner = form.querySelector<HTMLElement>(`.${BANNER_CLASS}`);
  if (!banner) {
    banner = document.createElement('div');
    banner.className = BANNER_CLASS;
    banner.setAttribute('role', 'alert');
    banner.style.cssText =
      'background:#3a1f24;border:1px solid #e84a5f;color:#ffdde2;padding:10px 12px;border-radius:6px;margin-bottom:14px;font-size:0.9rem;';
    form.insertBefore(banner, form.firstChild);
  }
  banner.textContent = message;
}

function clearFormBanner(form: HTMLFormElement): void {
  form.querySelector<HTMLElement>(`.${BANNER_CLASS}`)?.remove();
}

registerPage('login', bindLogin);
