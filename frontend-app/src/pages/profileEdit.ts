import { parseApiError } from '@/api/baseQuery';
import { profilesApi } from '@/api/profilesApi';
import type { PageContext } from '@/pages';
import { escapeHtml } from '@/lib/format';
import {
  PROFESSIONS,
  PROFESSION_OTHER_KEY,
  isKnownProfessionKey,
} from '@/lib/professions';
import type { ProfileDto, UpdateMyProfileBody } from '@/types/api';

type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'csv'
  | 'select-with-other';

type SelectOption = { value: string; label: string };

type FieldSpec = {
  name: keyof UpdateMyProfileBody;
  label: string;
  type: FieldType;
  options?: ReadonlyArray<SelectOption>;
  placeholder?: string;
  rows?: number;
  /** Render style — `block` puts the field on its own row (full-width). */
  block?: boolean;
  required?: boolean;
};

type SectionSpec = {
  title: string;
  /** When true, the section body is a single text block, not an `<ul>`. */
  freeform?: boolean;
  fields: ReadonlyArray<FieldSpec>;
};

const PLACEHOLDER_OPTION: SelectOption = { value: '', label: '— Choose —' };

const GENDER_OPTIONS: ReadonlyArray<SelectOption> = [
  PLACEHOLDER_OPTION,
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const MARITAL_OPTIONS: ReadonlyArray<SelectOption> = [
  PLACEHOLDER_OPTION,
  { value: 'single', label: 'Single' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'separated', label: 'Separated' },
];

const RELATIONSHIP_OPTIONS: ReadonlyArray<SelectOption> = [
  PLACEHOLDER_OPTION,
  { value: 'serious', label: 'Serious' },
  { value: 'casual', label: 'Casual' },
  { value: 'friendship', label: 'Friendship' },
  { value: 'marriage', label: 'Marriage' },
];

const SMOKING_OPTIONS: ReadonlyArray<SelectOption> = [
  PLACEHOLDER_OPTION,
  { value: 'never', label: 'Never' },
  { value: 'occasionally', label: 'Occasionally' },
  { value: 'socially', label: 'Socially' },
  { value: 'regularly', label: 'Regularly' },
];

const SEEKING_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'any', label: 'Any' },
];

const BODY_TYPE_OPTIONS: ReadonlyArray<SelectOption> = [
  PLACEHOLDER_OPTION,
  { value: 'slim', label: 'Slim' },
  { value: 'athletic', label: 'Athletic' },
  { value: 'average', label: 'Average' },
  { value: 'curvy', label: 'Curvy' },
  { value: 'plus_size', label: 'Plus size' },
];

const PROFESSION_OPTIONS: ReadonlyArray<SelectOption> = [
  PLACEHOLDER_OPTION,
  ...PROFESSIONS.map((p) => ({ value: p.key, label: p.label })),
  { value: PROFESSION_OTHER_KEY, label: 'Other (specify)' },
];

const SECTIONS: ReadonlyArray<SectionSpec> = [
  {
    title: 'Base Info',
    fields: [
      { name: 'displayName', label: 'Name', type: 'text', required: true },
      {
        name: 'gender',
        label: "I'm a",
        type: 'select',
        options: GENDER_OPTIONS,
        required: true,
      },
      {
        name: 'seeking',
        label: 'Looking for a',
        type: 'multiselect',
        options: SEEKING_OPTIONS,
        required: true,
      },
      { name: 'maritalStatus', label: 'Marital Status', type: 'select', options: MARITAL_OPTIONS },
      {
        name: 'profession',
        label: 'Profession',
        type: 'select-with-other',
        options: PROFESSION_OPTIONS,
        placeholder: 'Type your profession',
      },
      { name: 'dob', label: 'Date of Birth', type: 'date', required: true },
      { name: 'address', label: 'Address', type: 'text', block: true },
      { name: 'city', label: 'City', type: 'text' },
      { name: 'country', label: 'Country', type: 'text', required: true },
    ],
  },
  {
    title: 'Myself Summary',
    freeform: true,
    fields: [
      {
        name: 'bio',
        label: 'Bio',
        type: 'textarea',
        rows: 5,
        block: true,
        required: true,
      },
    ],
  },
  {
    title: 'Looking For',
    fields: [
      {
        name: 'lookingFor',
        label: "Things I'm looking for",
        type: 'textarea',
        rows: 3,
        block: true,
      },
      {
        name: 'likes',
        label: 'Whatever I like',
        type: 'textarea',
        rows: 3,
        block: true,
      },
    ],
  },
  {
    title: 'Lifestyle',
    fields: [
      { name: 'interests', label: 'Interest', type: 'csv', placeholder: 'hiking, jazz, reading' },
      {
        name: 'favoritePlaces',
        label: 'Favorite vocations spot',
        type: 'csv',
        placeholder: 'Entoto Park, Lalibela',
      },
      {
        name: 'relationshipType',
        label: 'Looking for',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
      },
      { name: 'smoking', label: 'Smoking', type: 'select', options: SMOKING_OPTIONS },
      { name: 'languages', label: 'Language', type: 'csv', placeholder: 'Amharic, English' },
    ],
  },
  {
    title: 'Physical info',
    fields: [
      { name: 'heightCm', label: 'Height (cm)', type: 'number' },
      { name: 'weightKg', label: 'Weight (kg)', type: 'number' },
      { name: 'hairColor', label: 'Hair Color', type: 'text' },
      { name: 'eyeColor', label: 'Eye Color', type: 'text' },
      { name: 'bodyType', label: 'Body Type', type: 'select', options: BODY_TYPE_OPTIONS },
      { name: 'ethnicity', label: 'Ethnicity', type: 'text' },
    ],
  },
];

type EditorContext = {
  ctx: PageContext;
  getProfile: () => ProfileDto;
  setProfile: (next: ProfileDto) => void;
  /** Re-render the read-only view of the whole tab from the latest profile. */
  rerenderReadOnly: () => void;
};

export function bindOwnProfileEditors(opts: EditorContext): void {
  const tab = document.querySelector<HTMLElement>('#profile.tab-pane');
  if (!tab) return;

  for (const section of SECTIONS) {
    const card = findCardByTitle(tab, section.title);
    if (!card) continue;
    injectEditButton(card, () => openEditor(card, section, opts));
  }
}

function injectEditButton(card: HTMLElement, onClick: () => void): void {
  const titleNode = card.querySelector<HTMLElement>('.info-card-title');
  if (!titleNode) return;
  if (titleNode.querySelector('[data-app-action="edit-section"]')) return;

  titleNode.style.display = 'flex';
  titleNode.style.justifyContent = 'space-between';
  titleNode.style.alignItems = 'center';

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.appAction = 'edit-section';
  button.textContent = 'Edit';
  button.style.cssText =
    'background:transparent;border:1px solid #c2185b;color:#c2185b;padding:4px 12px;border-radius:4px;font-size:13px;cursor:pointer;line-height:1.2;';
  button.addEventListener('click', onClick);
  titleNode.appendChild(button);
}

function openEditor(
  card: HTMLElement,
  section: SectionSpec,
  opts: EditorContext,
): void {
  const content = card.querySelector<HTMLElement>('.info-card-content');
  const button = card.querySelector<HTMLButtonElement>(
    '[data-app-action="edit-section"]',
  );
  if (!content) return;
  if (button) button.style.display = 'none';

  const savedHtml = content.innerHTML;
  content.innerHTML = formHtml(section, opts.getProfile());

  const form = content.querySelector<HTMLFormElement>('form');
  if (!form) return;

  wireOtherToggles(form);

  const cancelBtn = form.querySelector<HTMLButtonElement>('[data-action="cancel"]');
  const errorNode = form.querySelector<HTMLElement>('[data-target="error"]');
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-action="save"]');

  const restoreReadOnly = (): void => {
    content.innerHTML = savedHtml;
    if (button) button.style.display = '';
  };

  cancelBtn?.addEventListener('click', () => {
    restoreReadOnly();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorNode) errorNode.textContent = '';
    const result = readForm(form, section);
    if ('error' in result) {
      if (errorNode) errorNode.textContent = result.error;
      return;
    }
    const body = result.body;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
    }
    try {
      const updated = await opts.ctx
        .dispatch(profilesApi.endpoints.updateMyProfile.initiate(body))
        .unwrap();
      opts.setProfile(updated);
      restoreReadOnly();
      opts.rerenderReadOnly();
    } catch (raw) {
      const err = parseApiError(raw as Parameters<typeof parseApiError>[0]);
      if (errorNode) {
        errorNode.textContent =
          err?.message ?? 'Could not save changes. Please try again.';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';
      }
    }
  });
}

function formHtml(section: SectionSpec, profile: ProfileDto): string {
  const fields = section.fields.map((f) => fieldHtml(f, profile)).join('');
  return `
    <form data-app-section-form="${escapeHtml(section.title)}">
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px;">
        ${fields}
      </div>
      <p data-target="error" style="color:#e84a5f;min-height:1em;margin:12px 0 0;"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button type="button" data-action="cancel" style="background:transparent;border:1px solid #555;color:#ccc;padding:8px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
        <button type="submit" data-action="save" style="background:#c2185b;border:1px solid #c2185b;color:#fff;padding:8px 18px;border-radius:4px;cursor:pointer;">Save</button>
      </div>
    </form>
  `;
}

function fieldHtml(spec: FieldSpec, profile: ProfileDto): string {
  const current = profile[spec.name as keyof ProfileDto];
  const id = `pe-${spec.name}`;
  const wrapperStyle = spec.block
    ? 'display:flex;flex-direction:column;gap:6px;grid-column:1/-1;'
    : 'display:flex;flex-direction:column;gap:6px;';
  const inputStyle =
    'background:#1f1418;border:1px solid #3a1f24;color:#eee;border-radius:4px;padding:8px 10px;font:inherit;width:100%;';
  const req = spec.required ? ' required' : '';
  const ariaReq = spec.required ? ' aria-required="true"' : '';

  let control = '';
  switch (spec.type) {
    case 'text': {
      const value = typeof current === 'string' ? current : '';
      control = `<input id="${id}" name="${spec.name}" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(spec.placeholder ?? '')}" style="${inputStyle}"${req}${ariaReq} />`;
      break;
    }
    case 'textarea': {
      const value = typeof current === 'string' ? current : '';
      control = `<textarea id="${id}" name="${spec.name}" rows="${spec.rows ?? 4}" placeholder="${escapeHtml(spec.placeholder ?? '')}" style="${inputStyle};resize:vertical;"${req}${ariaReq}>${escapeHtml(value)}</textarea>`;
      break;
    }
    case 'number': {
      const value = typeof current === 'number' && Number.isFinite(current) ? String(current) : '';
      control = `<input id="${id}" name="${spec.name}" type="number" inputmode="numeric" value="${escapeHtml(value)}" style="${inputStyle}"${req}${ariaReq} />`;
      break;
    }
    case 'date': {
      const value = typeof current === 'string' ? current.slice(0, 10) : '';
      control = `<input id="${id}" name="${spec.name}" type="date" value="${escapeHtml(value)}" style="${inputStyle}"${req}${ariaReq} />`;
      break;
    }
    case 'select': {
      const value = typeof current === 'string' ? current : '';
      const options = (spec.options ?? []).map((o) => {
        const selected = o.value === value ? ' selected' : '';
        return `<option value="${escapeHtml(o.value)}"${selected}>${escapeHtml(o.label)}</option>`;
      }).join('');
      control = `<select id="${id}" name="${spec.name}" style="${inputStyle}"${req}${ariaReq}>${options}</select>`;
      break;
    }
    case 'multiselect': {
      const selectedArr = Array.isArray(current)
        ? (current as unknown[]).map(String)
        : typeof current === 'string'
          ? current.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
          : [];
      const selected = new Set(selectedArr);
      const opts = (spec.options ?? []).filter((o) => o.value !== '');
      const options = opts
        .map((o) => {
          const sel = selected.has(o.value) ? ' selected' : '';
          return `<option value="${escapeHtml(o.value)}"${sel}>${escapeHtml(o.label)}</option>`;
        })
        .join('');
      const size = Math.min(Math.max(opts.length, 3), 8);
      control = `<select id="${id}" name="${spec.name}" multiple size="${size}" style="${inputStyle};height:auto;"${req}${ariaReq}>${options}</select><small style="font-size:11px;opacity:0.6;">Hold ⌘/Ctrl to select multiple</small>`;
      break;
    }
    case 'csv': {
      const arr = Array.isArray(current) ? (current as unknown[]).map(String) : [];
      const value = arr.join(', ');
      control = `<input id="${id}" name="${spec.name}" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(spec.placeholder ?? '')}" style="${inputStyle}"${req}${ariaReq} />`;
      break;
    }
    case 'select-with-other': {
      const raw = typeof current === 'string' ? current : '';
      const isOther = raw !== '' && !isKnownProfessionKey(raw);
      const selectValue = isOther ? PROFESSION_OTHER_KEY : raw;
      const otherValue = isOther ? raw : '';
      const options = (spec.options ?? []).map((o) => {
        const selected = o.value === selectValue ? ' selected' : '';
        return `<option value="${escapeHtml(o.value)}"${selected}>${escapeHtml(o.label)}</option>`;
      }).join('');
      const otherHidden = selectValue === PROFESSION_OTHER_KEY ? '' : 'display:none;';
      const otherName = `${spec.name}__other`;
      control = `
        <select id="${id}" name="${spec.name}" data-app-other-toggle style="${inputStyle}"${req}${ariaReq}>${options}</select>
        <input
          type="text"
          name="${otherName}"
          data-app-other-input
          value="${escapeHtml(otherValue)}"
          placeholder="${escapeHtml(spec.placeholder ?? 'Type your profession')}"
          style="${inputStyle};margin-top:6px;${otherHidden}"
        />
      `;
      break;
    }
  }

  const requiredMark = spec.required
    ? ' <span aria-hidden="true" style="color:#e84a5f;">*</span>'
    : '';
  return `
    <div style="${wrapperStyle}">
      <label for="${id}" style="font-size:13px;opacity:0.85;">${escapeHtml(spec.label)}${requiredMark}</label>
      ${control}
    </div>
  `;
}

type ReadFormResult =
  | { body: UpdateMyProfileBody }
  | { error: string };

function readForm(
  form: HTMLFormElement,
  section: SectionSpec,
): ReadFormResult {
  const body: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const spec of section.fields) {
    const element = form.elements.namedItem(spec.name as string);
    if (!element || element instanceof RadioNodeList) continue;
    const value = readField(element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, spec);
    body[spec.name as string] = value;
    if (spec.required && isEmptyValue(value)) missing.push(spec.label);
  }
  if (missing.length > 0) {
    return {
      error: `Please fill in the required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    };
  }
  return { body: body as UpdateMyProfileBody };
}

function wireOtherToggles(form: HTMLFormElement): void {
  const selects = form.querySelectorAll<HTMLSelectElement>('select[data-app-other-toggle]');
  selects.forEach((select) => {
    const input = form.querySelector<HTMLInputElement>(
      `input[name="${select.name}__other"]`,
    );
    if (!input) return;
    const sync = (): void => {
      const showOther = select.value === PROFESSION_OTHER_KEY;
      input.style.display = showOther ? '' : 'none';
      if (showOther) input.focus();
      else input.value = '';
    };
    select.addEventListener('change', sync);
  });
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function readField(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  spec: FieldSpec,
): unknown {
  const raw = element.value;
  switch (spec.type) {
    case 'text':
    case 'textarea': {
      const trimmed = raw.trim();
      return trimmed === '' ? null : trimmed;
    }
    case 'select': {
      return raw === '' ? null : raw;
    }
    case 'multiselect': {
      const select = element as HTMLSelectElement;
      const values: string[] = [];
      for (const opt of Array.from(select.selectedOptions)) {
        if (opt.value) values.push(opt.value);
      }
      return values;
    }
    case 'number': {
      const trimmed = raw.trim();
      if (trimmed === '') return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    case 'date': {
      return raw === '' ? null : raw;
    }
    case 'csv': {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    case 'select-with-other': {
      if (raw === '') return null;
      if (raw !== PROFESSION_OTHER_KEY) return raw;
      const form = (element as HTMLSelectElement).form;
      const otherInput = form?.querySelector<HTMLInputElement>(
        `input[name="${spec.name}__other"]`,
      );
      const text = otherInput?.value.trim() ?? '';
      return text === '' ? null : text;
    }
  }
}

function findCardByTitle(root: HTMLElement, title: string): HTMLElement | null {
  const cards = root.querySelectorAll<HTMLElement>('.info-card');
  for (const card of cards) {
    const titleNode = card.querySelector<HTMLElement>('.info-card-title h6');
    if (titleNode && (titleNode.textContent ?? '').trim() === title) {
      return card;
    }
  }
  return null;
}
