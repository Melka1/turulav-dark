export function serializeForm(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const out: Record<string, string> = {};
  for (const [k, v] of data.entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

const ERROR_CLASS = 'app-field-error';

function ensureErrorNode(field: HTMLElement): HTMLElement {
  const group = field.closest('.form-group') ?? field.parentElement;
  if (!group) return field;
  let node = group.querySelector<HTMLElement>(`.${ERROR_CLASS}`);
  if (!node) {
    node = document.createElement('div');
    node.className = ERROR_CLASS;
    node.setAttribute('role', 'alert');
    node.style.color = '#e84a5f';
    node.style.fontSize = '0.85rem';
    node.style.marginTop = '4px';
    node.style.minHeight = '1em';
    group.appendChild(node);
  }
  return node;
}

export function setFieldError(
  form: HTMLFormElement,
  field: string,
  message: string,
): void {
  const input = form.querySelector<HTMLElement>(`[name="${field}"]`);
  if (!input) return;
  const node = ensureErrorNode(input);
  node.textContent = message;
}

export function clearFieldErrors(form: HTMLFormElement): void {
  form
    .querySelectorAll<HTMLElement>(`.${ERROR_CLASS}`)
    .forEach((node) => (node.textContent = ''));
}

export function setFormBusy(form: HTMLFormElement, busy: boolean): void {
  const button = form.querySelector<HTMLButtonElement>('button');
  if (button) button.disabled = busy;
  form
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input, select, textarea',
    )
    .forEach((el) => (el.disabled = busy));
}
