/**
 * Decorates every `input[type="password"]` in the document with an inline
 * show/hide button. Idempotent — running twice is a no-op.
 *
 * The button is anchored to the input itself (not the .form-group) so it
 * stays vertically centered on the input regardless of any sibling error
 * messages that may appear below.
 */

const FLAG = 'appPasswordToggle';

export function applyPasswordToggles(root: ParentNode = document): void {
  const inputs = root.querySelectorAll<HTMLInputElement>(
    'input[type="password"]',
  );
  inputs.forEach(decorate);
}

function decorate(input: HTMLInputElement): void {
  if (input.dataset[FLAG] === '1') return;
  input.dataset[FLAG] = '1';

  // Wrap the input in its own positioning context so the button is
  // anchored to the input box, not the surrounding form group.
  const wrapper = document.createElement('div');
  wrapper.className = 'app-password-field';
  wrapper.style.cssText = 'position:relative;display:block;';
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  input.style.paddingRight = '44px';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'app-password-toggle';
  button.setAttribute('aria-label', 'Show password');
  button.setAttribute('aria-pressed', 'false');
  button.style.cssText = [
    'position:absolute',
    'top:50%',
    'right:12px',
    'transform:translateY(-50%)',
    'margin:0',
    'width:32px',
    'height:32px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:transparent',
    'border:0',
    'padding:0',
    'cursor:pointer',
    'color:inherit',
    'opacity:0.65',
    'line-height:1',
  ].join(';');

  const icon = document.createElement('i');
  icon.className = 'icofont-eye-alt';
  icon.style.fontSize = '1.15rem';
  button.appendChild(icon);

  button.addEventListener('mouseenter', () => (button.style.opacity = '1'));
  button.addEventListener('mouseleave', () => (button.style.opacity = '0.65'));

  button.addEventListener('click', (event) => {
    event.preventDefault();
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    icon.className = showing ? 'icofont-eye-alt' : 'icofont-eye-blocked';
    button.setAttribute('aria-pressed', showing ? 'false' : 'true');
    button.setAttribute(
      'aria-label',
      showing ? 'Show password' : 'Hide password',
    );
  });

  wrapper.appendChild(button);
}
