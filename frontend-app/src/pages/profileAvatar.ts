import { parseApiError } from '@/api/baseQuery';
import { profilesApi } from '@/api/profilesApi';
import { showToast } from '@/lib/toast';
import type { PageContext } from '@/pages';
import type { ProfileDto } from '@/types/api';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

type UploadOptions = {
  ctx: PageContext;
  onUpdated: (profile: ProfileDto) => void;
};

type UploadKind = {
  label: 'avatar' | 'cover photo';
  field: 'avatar' | 'cover';
  imgSelector: string;
  inputSelector: string;
  pickUrl: (profile: ProfileDto) => string | null;
};

export function bindOwnAvatarUpload(opts: UploadOptions): void {
  bindUpload(opts, {
    label: 'avatar',
    field: 'avatar',
    imgSelector: '.profile-pic img',
    inputSelector: '.profile-pic .custom-upload input[type="file"]',
    pickUrl: (p) => p.avatarUrl,
  });
}

export function bindOwnCoverUpload(opts: UploadOptions): void {
  bindUpload(opts, {
    label: 'cover photo',
    field: 'cover',
    imgSelector: '.profile-cover img',
    inputSelector: '.profile-cover .edit-photo input[type="file"]',
    pickUrl: (p) => p.coverUrl,
  });
}

function bindUpload(opts: UploadOptions, kind: UploadKind): void {
  const root = document.querySelector<HTMLElement>(
    '.member-profile .profile-item:not(.d-none)',
  );
  if (!root) return;

  const input = root.querySelector<HTMLInputElement>(kind.inputSelector);
  const img = root.querySelector<HTMLImageElement>(kind.imgSelector);
  if (!input || !img) return;

  if (!input.accept) input.accept = ALLOWED_MIME.join(',');

  let busy = false;
  input.addEventListener('change', async () => {
    if (busy) return;
    const file = input.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME.includes(file.type)) {
      showToast({
        level: 'error',
        message: 'Please choose a JPEG, PNG, or WebP image.',
      });
      input.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast({
        level: 'error',
        message: `Image is too large (max ${Math.round(MAX_BYTES / (1024 * 1024))} MB).`,
      });
      input.value = '';
      return;
    }

    busy = true;
    const prevSrc = img.src;
    const previewUrl = URL.createObjectURL(file);
    img.src = previewUrl;
    img.style.opacity = '0.7';

    try {
      const fd = new FormData();
      fd.append(kind.field, file);
      const profile = await opts.ctx
        .dispatch(profilesApi.endpoints.updateMyProfile.initiate(fd))
        .unwrap();

      const newUrl = kind.pickUrl(profile);
      if (newUrl) img.src = newUrl;
      opts.onUpdated(profile);
      showToast({
        level: 'success',
        message: `${capitalize(kind.label)} updated.`,
      });
    } catch (raw) {
      img.src = prevSrc;
      const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
      const message =
        err?.message ??
        (raw instanceof Error
          ? raw.message
          : `Could not upload ${kind.label}.`);
      console.error(`[profile] ${kind.label} upload failed`, err ?? raw);
      showToast({ level: 'error', message });
    } finally {
      URL.revokeObjectURL(previewUrl);
      img.style.opacity = '';
      input.value = '';
      busy = false;
    }
  });
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
