import { el, icon, type Child } from './dom';

export interface DialogOptions {
  title: string;
  /** Dialog body content. */
  body?: Child | Child[];
  /** Footer buttons; the first `primary` button is triggered by Enter. */
  buttons?: { label: string; primary?: boolean; danger?: boolean; onClick?: (close: () => void) => void | boolean | Promise<void | boolean> }[];
  /** Width preset. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Allow closing with Escape / backdrop click (default true). */
  dismissible?: boolean;
  onClose?: () => void;
  className?: string;
}

export interface DialogHandle {
  root: HTMLElement;
  body: HTMLElement;
  close(): void;
}

/** Open a modal dialog. Focus is trapped inside while open. */
export function openDialog(opts: DialogOptions): DialogHandle {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const dialog = el('div', { class: `dialog dialog-${opts.size ?? 'md'} ${opts.className ?? ''}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title-' + Math.random().toString(36).slice(2, 7) } });
  const titleId = dialog.getAttribute('aria-labelledby')!;
  const head = el('div', { class: 'dialog-head' }, el('h2', { text: opts.title, attrs: { id: titleId } }));
  const body = el('div', { class: 'dialog-body' });
  const bodyItems = Array.isArray(opts.body) ? opts.body : [opts.body];
  for (const b of bodyItems) if (b) body.appendChild(typeof b === 'string' ? document.createTextNode(b) : b);
  dialog.append(head, body);
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
    previouslyFocused?.focus?.();
  };
  if (opts.dismissible !== false) {
    head.appendChild(el('button', { class: 'icon-btn dialog-close', attrs: { 'aria-label': 'Close dialog', type: 'button' }, on: { click: close } }, icon('close')));
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  }
  let primaryBtn: HTMLButtonElement | null = null;
  if (opts.buttons?.length) {
    const foot = el('div', { class: 'dialog-foot' });
    for (const b of opts.buttons) {
      const btn = el('button', { class: `${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`.trim(), text: b.label, attrs: { type: 'button' } });
      btn.addEventListener('click', async () => {
        const r = b.onClick ? await b.onClick(close) : undefined;
        if (r !== false && !b.onClick) close();
      });
      if (b.primary && !primaryBtn) primaryBtn = btn;
      foot.appendChild(btn);
    }
    dialog.appendChild(foot);
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && opts.dismissible !== false) { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && primaryBtn && !(e.target as HTMLElement).matches('textarea, .cm-content, select')) {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      primaryBtn.click();
    } else if (e.key === 'Tab') trapFocus(dialog, e);
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => {
    const first = dialog.querySelector<HTMLElement>('input, select, textarea, button:not(.dialog-close), [tabindex]');
    (first ?? dialog).focus();
  });
  return { root: dialog, body, close };
}

function trapFocus(container: HTMLElement, e: KeyboardEvent): void {
  const focusables = Array.from(container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Confirmation dialog returning a promise. */
export function confirmDialog(title: string, message: string, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog({
      title,
      size: 'sm',
      body: el('p', { text: message }),
      buttons: [
        { label: 'Cancel', onClick: (close) => { resolve(false); close(); } },
        { label: opts.okLabel ?? 'OK', primary: true, danger: opts.danger, onClick: (close) => { resolve(true); close(); } },
      ],
      onClose: () => resolve(false),
    });
  });
}

/** Prompt for a single line of text. */
export function promptDialog(title: string, label: string, initial = '', opts: { placeholder?: string; validate?: (v: string) => string | null } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el('input', { class: 'text-input', attrs: { type: 'text', value: initial, placeholder: opts.placeholder ?? '' } });
    const err = el('div', { class: 'field-error', attrs: { role: 'alert' } });
    let done = false;
    openDialog({
      title,
      size: 'sm',
      body: el('label', { class: 'field-stack' }, el('span', { text: label }), input, err),
      buttons: [
        { label: 'Cancel', onClick: (close) => { done = true; resolve(null); close(); } },
        {
          label: 'OK', primary: true, onClick: (close) => {
            const v = input.value.trim();
            const problem = opts.validate?.(v) ?? null;
            if (problem) { err.textContent = problem; input.focus(); return false; }
            done = true; resolve(v); close(); return true;
          },
        },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}
