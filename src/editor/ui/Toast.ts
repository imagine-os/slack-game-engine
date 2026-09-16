import { el, icon } from './dom';

export type ToastLevel = 'info' | 'success' | 'warn' | 'error';

let host: HTMLElement | null = null;

/** Show a transient notification in the bottom-right corner. */
export function toast(message: string, level: ToastLevel = 'info', opts: { duration?: number; action?: { label: string; onClick: () => void } } = {}): HTMLElement {
  if (!host || !host.isConnected) {
    host = el('div', { class: 'toast-host', attrs: { 'aria-live': 'polite', role: 'status' } });
    document.body.appendChild(host);
  }
  const t = el('div', { class: `toast toast-${level}` }, icon(level === 'success' ? 'check' : level === 'warn' ? 'warning' : level === 'error' ? 'error' : 'info'), el('span', { class: 'toast-msg', text: message }));
  if (opts.action) {
    const a = opts.action;
    t.appendChild(el('button', { class: 'toast-action', text: a.label, on: { click: () => { a.onClick(); t.remove(); } } }));
  }
  host.appendChild(t);
  const duration = opts.duration ?? (level === 'error' ? 6000 : 3000);
  const timer = setTimeout(() => dismiss(), duration);
  function dismiss(): void {
    clearTimeout(timer);
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 200);
  }
  t.addEventListener('click', (e) => { if ((e.target as HTMLElement).tagName !== 'BUTTON') dismiss(); });
  return t;
}
