/**
 * Shared filter logic for member-search forms. Used by:
 *  - members.html (.filter-form): applies the filter in-place
 *  - blog.html / blog-single.html / profile.html sidebars (.banner-form):
 *    redirects to /members?… with the chosen filters
 *  - index.html (.banner-form in .banner-section): a profession-flavoured
 *    variant, also redirects to /members?…
 *
 * If the viewer is signed in we pre-fill the "I am" / "Looking for" / country
 * selects from their profile so they don't have to retype known preferences.
 */

import { usersApi } from '@/api/usersApi';
import { PROFESSIONS } from '@/lib/professions';
import type { PageContext } from '@/pages';
import type {
  Gender,
  ProfileDto,
  PublicProfileDto,
  SearchProfilesQuery,
} from '@/types/api';

export type MemberFilterState = Pick<
  SearchProfilesQuery,
  | 'q'
  | 'gender'
  | 'seeking'
  | 'interests'
  | 'country'
  | 'city'
  | 'profession'
  | 'viewerProfession'
  | 'minAge'
  | 'maxAge'
>;

const GENDER_LABEL_TO_VALUE: Record<string, Gender> = {
  male: 'male',
  female: 'female',
  others: 'other',
  other: 'other',
  'non binary': 'non_binary',
  'non-binary': 'non_binary',
};

const GENDER_VALUE_TO_LABEL: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Others',
  non_binary: 'Others',
  prefer_not_to_say: '',
};

const PLACEHOLDER_LABEL_RE = /^(i am a|looking for|select|choose your country|your interests|select.*?\.\.\.?)$/i;

function mapGender(label: string | null | undefined): Gender | undefined {
  if (!label) return undefined;
  if (PLACEHOLDER_LABEL_RE.test(label.trim())) return undefined;
  return GENDER_LABEL_TO_VALUE[label.trim().toLowerCase()];
}

function parseAge(label: string | null | undefined): number | undefined {
  if (!label) return undefined;
  const cleaned = label.trim().replace(/\+$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 18 && n <= 120 ? n : undefined;
}

function selectedOptionText(
  select: HTMLSelectElement | null | undefined,
): string | null {
  if (!select) return null;
  const opt = select.options[select.selectedIndex];
  return opt ? opt.text.trim() : null;
}

function findSelect(
  form: HTMLFormElement,
  ...selectors: string[]
): HTMLSelectElement | null {
  for (const sel of selectors) {
    const node = form.querySelector<HTMLSelectElement>(sel);
    if (node) return node;
  }
  return null;
}

/**
 * Set a `<select>` to the option whose visible text matches `label`
 * (case-insensitive). Returns true if a match was found and applied.
 */
function setSelectByLabel(
  select: HTMLSelectElement | null,
  label: string | null | undefined,
): boolean {
  if (!select || !label) return false;
  const target = label.trim().toLowerCase();
  if (!target) return false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i]!.text.trim().toLowerCase() === target) {
      if (select.selectedIndex !== i) select.selectedIndex = i;
      return true;
    }
  }
  return false;
}

/**
 * members.html uses `name="gender"` + `name="seeking"` + `name="country"`.
 */
export function readMembersFilterForm(form: HTMLFormElement): MemberFilterState {
  const out: MemberFilterState = {};

  const gender = mapGender(
    selectedOptionText(form.querySelector<HTMLSelectElement>('select[name="gender"]')),
  );
  if (gender) out.gender = gender;

  const seeking = mapGender(
    selectedOptionText(form.querySelector<HTMLSelectElement>('select[name="seeking"]')),
  );
  if (seeking) out.seeking = seeking;

  const minAge = parseAge(
    selectedOptionText(form.querySelector<HTMLSelectElement>('select[name="age-start"]')),
  );
  if (minAge) out.minAge = minAge;
  const maxAge = parseAge(
    selectedOptionText(form.querySelector<HTMLSelectElement>('select[name="age-end"]')),
  );
  if (maxAge) out.maxAge = maxAge;

  const country = selectedOptionText(
    form.querySelector<HTMLSelectElement>('select[name="country"]'),
  );
  if (country && !PLACEHOLDER_LABEL_RE.test(country)) out.country = country;

  const profession = form
    .querySelector<HTMLSelectElement>('select[name="profession"]')
    ?.value?.trim();
  if (profession) out.profession = profession;

  const city = form
    .querySelector<HTMLInputElement>('input[name="city"]')
    ?.value?.trim();
  if (city) out.city = city;

  const interests = form
    .querySelector<HTMLSelectElement>('select[name="interests"]')
    ?.value?.trim();
  if (interests) out.interests = interests;

  const data = new FormData(form);
  const q = (data.get('q') as string | null)?.trim();
  if (q) out.q = q;

  return out;
}

/**
 * Sidebar widgets on blog.html / blog-single.html / profile.html. The template
 * gives both gender selects `name="gender"`, so we disambiguate by id:
 *   #gender    → "I am"
 *   #gender-two → "Looking for"
 *   #country   → country
 *   #interest  → interests
 * Age range selects don't have stable names — we fall back to position.
 */
export function readSidebarFilterForm(form: HTMLFormElement): MemberFilterState {
  const out: MemberFilterState = {};

  const gender = mapGender(
    selectedOptionText(findSelect(form, 'select#gender', '.gender select')),
  );
  if (gender) out.gender = gender;

  const seeking = mapGender(
    selectedOptionText(findSelect(form, 'select#gender-two', '.person select')),
  );
  if (seeking) out.seeking = seeking;

  const ageSelects = form.querySelectorAll<HTMLSelectElement>('.age .custom-select select');
  const minAge = parseAge(selectedOptionText(ageSelects[0]));
  if (minAge) out.minAge = minAge;
  const maxAge = parseAge(selectedOptionText(ageSelects[1]));
  if (maxAge) out.maxAge = maxAge;

  const country = selectedOptionText(
    findSelect(form, 'select#country', '.city select'),
  );
  if (country && !PLACEHOLDER_LABEL_RE.test(country)) out.country = country;

  const interest = selectedOptionText(
    findSelect(form, 'select#interest', '.interest select'),
  );
  if (interest && !PLACEHOLDER_LABEL_RE.test(interest)) {
    // SearchProfilesQuery expects a comma-separated list; single value is fine.
    out.interests = interest;
  }

  return out;
}

/**
 * Home page banner — profession-flavoured. "Looking for" maps to the API's
 * `profession` filter (target's profession); "I am a" maps to
 * `viewerProfession` (the searcher's own profession, used by the backend for
 * symmetric matching). The banner select displays human labels ("Painter");
 * the backend expects enum keys ("PAINTER"), so we translate via the shared
 * PROFESSIONS list. City goes to the `city` filter.
 */
const PROFESSION_KEY_BY_LABEL = new Map<string, string>(
  PROFESSIONS.map((p) => [p.label.toLowerCase(), p.key]),
);

function labelToProfessionKey(label: string): string {
  return PROFESSION_KEY_BY_LABEL.get(label.trim().toLowerCase()) ?? label;
}

export function readHomeBannerForm(form: HTMLFormElement): MemberFilterState {
  const out: MemberFilterState = {};

  const iAmA = selectedOptionText(
    findSelect(form, 'select#gender', '.gender select'),
  );
  if (iAmA && !PLACEHOLDER_LABEL_RE.test(iAmA)) {
    out.viewerProfession = labelToProfessionKey(iAmA);
  }

  const lookingFor = selectedOptionText(
    findSelect(form, 'select#gender-two', '.person select'),
  );
  if (lookingFor && !PLACEHOLDER_LABEL_RE.test(lookingFor)) {
    out.profession = labelToProfessionKey(lookingFor);
  }

  const city = form.querySelector<HTMLInputElement>('#city')?.value?.trim();
  if (city) out.city = city;

  return out;
}

/**
 * Pre-fill the `I am` / `Looking for` / country selects from the signed-in
 * viewer's profile. Safe to call before knowing whether the URL also carries
 * filters — call applyStateToFilterForm() afterwards to let URL params win.
 */
export function applyProfileDefaultsToFilterForm(
  form: HTMLFormElement,
  profile: ProfileDto | PublicProfileDto,
): void {
  if (profile.gender) {
    const label = GENDER_VALUE_TO_LABEL[profile.gender];
    if (label) {
      setSelectByLabel(
        form.querySelector<HTMLSelectElement>('select[name="gender"], select#gender'),
        label,
      );
    }
  }

  // SearchProfilesQuery.seeking is single-value on the wire; only pre-fill
  // when the user is looking for exactly one gender. If they want multiple,
  // leave the dropdown blank so the filter stays open.
  if (Array.isArray(profile.seeking) && profile.seeking.length === 1) {
    const seekValue = profile.seeking[0]!.toLowerCase() as Gender;
    const label = GENDER_VALUE_TO_LABEL[seekValue];
    if (label) {
      setSelectByLabel(
        form.querySelector<HTMLSelectElement>(
          'select[name="seeking"], select#gender-two',
        ),
        label,
      );
    }
  }

  if (profile.country) {
    setSelectByLabel(
      form.querySelector<HTMLSelectElement>('select[name="country"], select#country'),
      profile.country,
    );
  }
}

/**
 * Apply a filter state back to a members-style form (used after parsing
 * incoming URL params on the members page).
 */
export function applyStateToMembersForm(
  form: HTMLFormElement,
  state: MemberFilterState,
): void {
  if (state.gender) {
    setSelectByLabel(
      form.querySelector<HTMLSelectElement>('select[name="gender"]'),
      GENDER_VALUE_TO_LABEL[state.gender],
    );
  }
  if (state.seeking) {
    const seekLabel = GENDER_VALUE_TO_LABEL[state.seeking as Gender];
    if (seekLabel) {
      setSelectByLabel(
        form.querySelector<HTMLSelectElement>('select[name="seeking"]'),
        seekLabel,
      );
    }
  }
  if (state.country) {
    setSelectByLabel(
      form.querySelector<HTMLSelectElement>('select[name="country"]'),
      state.country,
    );
  }
  if (state.minAge) {
    setSelectByLabel(
      form.querySelector<HTMLSelectElement>('select[name="age-start"]'),
      String(state.minAge),
    );
  }
  if (state.maxAge) {
    setSelectByLabel(
      form.querySelector<HTMLSelectElement>('select[name="age-end"]'),
      String(state.maxAge),
    );
  }
  if (state.q) {
    const qInput = form.querySelector<HTMLInputElement>('input[name="q"]');
    if (qInput) qInput.value = state.q;
  }
}

const ALLOWED_KEYS: Array<keyof MemberFilterState> = [
  'q',
  'gender',
  'seeking',
  'interests',
  'country',
  'city',
  'profession',
  'viewerProfession',
  'minAge',
  'maxAge',
];

export function filterStateToParams(state: MemberFilterState): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ALLOWED_KEYS) {
    const value = state[key];
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params;
}

export function parseFilterStateFromUrl(search: string): MemberFilterState {
  const params = new URLSearchParams(search);
  const out: MemberFilterState = {};
  const q = params.get('q');
  if (q) out.q = q;
  const gender = params.get('gender');
  if (gender && isGender(gender)) out.gender = gender;
  const seeking = params.get('seeking');
  if (seeking) out.seeking = seeking;
  const country = params.get('country');
  if (country) out.country = country;
  const city = params.get('city');
  if (city) out.city = city;
  const interests = params.get('interests');
  if (interests) out.interests = interests;
  const profession = params.get('profession');
  if (profession) out.profession = profession;
  const viewerProfession = params.get('viewerProfession');
  if (viewerProfession) out.viewerProfession = viewerProfession;
  const minAge = Number(params.get('minAge'));
  if (Number.isFinite(minAge) && minAge >= 18 && minAge <= 120) out.minAge = minAge;
  const maxAge = Number(params.get('maxAge'));
  if (Number.isFinite(maxAge) && maxAge >= 18 && maxAge <= 120) out.maxAge = maxAge;
  return out;
}

function isGender(value: string): value is Gender {
  return (
    value === 'male' ||
    value === 'female' ||
    value === 'non_binary' ||
    value === 'other' ||
    value === 'prefer_not_to_say'
  );
}

// Vercel's `cleanUrls: true` and `serve`'s default cleanUrls both 308-redirect
// `/members.html` → `/members`. Older `serve` versions drop the query string on
// that hop, which lands the user on /members with no filters. Emit the clean
// URL directly to skip the redirect entirely.
const MEMBERS_PATH = '/members';

export function buildMembersUrl(state: MemberFilterState): string {
  const params = filterStateToParams(state);
  const qs = params.toString();
  return qs ? `${MEMBERS_PATH}?${qs}` : MEMBERS_PATH;
}

/**
 * Attach a submit handler that reads the form, builds /members?…, and
 * navigates. Used by every page except members.html itself.
 */
export function bindRedirectFilter(
  form: HTMLFormElement,
  reader: (form: HTMLFormElement) => MemberFilterState,
): void {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const state = reader(form);
    window.location.assign(buildMembersUrl(state));
  });
}

/**
 * Wire up every sidebar `Filter Search Member` widget on the current page:
 * pre-fill from the signed-in viewer's profile, hide the gender/seeking
 * selects when the profile already declares them (re-asking on every search
 * is noise), then redirect on submit to `/members?…`. Gender/seeking
 * are intentionally NOT carried in the URL when the profile already has them
 * — the members page backfills them from the same profile on arrival, so
 * including them in the query would just be redundant noise. Safe to call
 * on pages that have no such widget.
 */
export async function bindSidebarMemberFilters(ctx: PageContext): Promise<void> {
  const forms = Array.from(
    document.querySelectorAll<HTMLFormElement>(
      '.widget.search-widget form.banner-form',
    ),
  );
  if (forms.length === 0) return;

  const profile = await fetchMyProfile(ctx);
  for (const form of forms) {
    if (profile) {
      applyProfileDefaultsToFilterForm(form, profile);
      hidePrefilledGenderSeeking(form, profile);
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const state = readSidebarFilterForm(form);
      if (profile) stripProfileDuplicates(state, profile);
      window.location.assign(buildMembersUrl(state));
    });
  }
}

function hidePrefilledGenderSeeking(
  form: HTMLFormElement,
  profile: ProfileDto,
): void {
  if (profile.gender) {
    const wrap = form.querySelector<HTMLElement>('.gender');
    if (wrap) wrap.style.display = 'none';
  }
  if (Array.isArray(profile.seeking) && profile.seeking.length > 0) {
    const wrap = form.querySelector<HTMLElement>('.person');
    if (wrap) wrap.style.display = 'none';
  }
}

/**
 * Drop gender/seeking from the redirect state when they would just duplicate
 * the viewer's profile. The members page will re-derive these from the same
 * profile, so emitting them on the URL adds noise without changing results.
 * We only strip when the value MATCHES the profile — if the user explicitly
 * picked something different in the form, that intent is preserved.
 */
function stripProfileDuplicates(
  state: MemberFilterState,
  profile: ProfileDto,
): void {
  if (state.gender && profile.gender && state.gender === profile.gender) {
    delete state.gender;
  }
  if (
    state.seeking &&
    Array.isArray(profile.seeking) &&
    profile.seeking.length > 0 &&
    state.seeking === profile.seeking.join(',')
  ) {
    delete state.seeking;
  }
}

async function fetchMyProfile(ctx: PageContext): Promise<ProfileDto | null> {
  if (ctx.getState().auth.status !== 'authenticated') return null;
  try {
    const me = await ctx
      .dispatch(usersApi.endpoints.getMe.initiate())
      .unwrap();
    return me.profile;
  } catch {
    return null;
  }
}
