import { escapeHtml } from '@/lib/format';

const MAX_AVATARS = 6;
const FALLBACK_AVATAR = 'assets/images/group/group-mem/01.png';

// The template's .img-stack li sets border-radius:50% but no overflow:hidden,
// and the inner img has no object-fit — the original static thumbs were
// already-cropped circles, so it didn't matter. Real photo avatars bleed past
// the circle without these inline tweaks.
const AVATAR_LI_STYLE = 'overflow:hidden;';
const AVATAR_IMG_STYLE = 'width:100%;height:100%;object-fit:cover;';

/**
 * Renders the inner `<li>` children of an `.img-stack` list — up to six
 * member avatars followed by a `bg-theme` band tile when more members exist.
 * Caller owns the wrapping `<ul class="img-stack d-flex">`.
 */
export function renderGroupAvatarStack(group: {
  memberAvatars: string[];
  extraMembersBand: string | null;
}): string {
  const avatars = group.memberAvatars.slice(0, MAX_AVATARS);
  const tiles = avatars
    .map((src) => {
      const safe = src ? escapeHtml(src) : FALLBACK_AVATAR;
      return `<li style="${AVATAR_LI_STYLE}"><img src="${safe}" alt="member-img" style="${AVATAR_IMG_STYLE}"></li>`;
    })
    .join('');
  const band = group.extraMembersBand
    ? `<li class="bg-theme">${escapeHtml(group.extraMembersBand)}</li>`
    : '';
  return `${tiles}${band}`;
}
