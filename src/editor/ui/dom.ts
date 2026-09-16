/** Small DOM helpers used across the editor (no framework). */

export type Child = Node | string | null | undefined | false;

export interface ElOptions {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  style?: Partial<CSSStyleDeclaration>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
  children?: Child[];
}

/** Create an element with classes, text, attributes, listeners and children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: ElOptions | string = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const o = typeof opts === 'string' ? { class: opts } : opts;
  if (o.class) e.className = o.class;
  if (o.text !== undefined) e.textContent = o.text;
  if (o.html !== undefined) e.innerHTML = o.html;
  if (o.title) { e.title = o.title; }
  if (o.attrs) for (const [k, v] of Object.entries(o.attrs)) if (v !== undefined && v !== false) e.setAttribute(k, String(v === true ? '' : v));
  if (o.style) Object.assign(e.style, o.style);
  if (o.on) for (const [k, fn] of Object.entries(o.on)) e.addEventListener(k, fn as EventListener);
  append(e, ...(o.children ?? []), ...children);
  return e;
}

/** Append children, skipping null/false and converting strings to text nodes. */
export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** Remove all children. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A button with an optional tooltip (`title` + aria-label) and icon. */
export function button(label: string, onClick: (ev: MouseEvent) => void, opts: { class?: string; title?: string; icon?: string; ariaLabel?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const b = el('button', { class: opts.class ?? '', title: opts.title, attrs: { type: 'button', 'aria-label': opts.ariaLabel ?? (label ? undefined : opts.title), 'data-tip': opts.title } });
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (label) b.appendChild(el('span', { text: label }));
  b.disabled = !!opts.disabled;
  b.addEventListener('click', onClick);
  return b;
}

/** Inline SVG icon by name (a compact hand-drawn set). */
export function icon(name: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon', `icon-${name}`);
  svg.innerHTML = ICONS[name] ?? ICONS.dot;
  return svg;
}

const ICONS: Record<string, string> = {
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor"/>',
  play: '<path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="5" y="4" width="4" height="16" fill="currentColor" stroke="none"/><rect x="15" y="4" width="4" height="16" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>',
  step: '<path d="M5 4l10 8-10 8z" fill="currentColor" stroke="none"/><rect x="17" y="4" width="3" height="16" fill="currentColor" stroke="none"/>',
  select: '<path d="M4 3l7 18 2.5-7.5L21 11z"/>',
  move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  scale: '<path d="M21 3l-7 7M21 3h-6M21 3v6"/><rect x="3" y="11" width="10" height="10" rx="1"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  magnet: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 3h4v6H6zM14 3h4v6h-4z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  frame: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
  collider: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18M10 10a3 3 0 0 0 4 4"/><path d="M6.5 6.7C4 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1M9.9 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7s-.9 1.6-2.4 3.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  entity: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  shapes: '<circle cx="8" cy="8" r="4"/><rect x="12" y="12" width="8" height="8" rx="1"/>',
  type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  box: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12L3 7M12 12v10"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  atom: '<circle cx="12" cy="12" r="1.5" fill="currentColor"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>',
  audio: '<path d="M4 10v4h3l4 4V6L7 10z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  ear: '<path d="M6 9a6 6 0 0 1 12 0c0 3-2 4-2 6a3 3 0 0 1-6 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  gamepad: '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15 11h.01M18 13h.01"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 15a5 5 0 0 1 6 5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  file: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/><path d="M12 8v4l3 2"/>',
  console: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 3 0 4-1a9 9 0 0 0-6-12z"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7" r="1.2" fill="currentColor"/><circle cx="16" cy="10" r="1.2" fill="currentColor"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="M4 12l5 5L20 7"/>',
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/>',
  hand: '<path d="M8 13V5a2 2 0 1 1 4 0v6M12 11V4a2 2 0 1 1 4 0v8M16 12V7a2 2 0 1 1 4 0v7a7 7 0 0 1-14 0v-2a2 2 0 1 1 4 0"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  drag: '<circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>',
  'external': '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v6H4V5h6"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12L3 7M12 12v10"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  forge: '<path d="M4 20h16M6 20V10l6-6 6 6v10"/><path d="M10 20v-5h4v5"/>',
};

/** Format a keyboard shortcut for display (`Mod+S` → `Ctrl+S` / `⌘S`). */
export function formatShortcut(s: string | undefined): string {
  if (!s) return '';
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return s.split('+').map((p) => {
    if (p === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (p === 'Shift') return mac ? '⇧' : 'Shift';
    if (p === 'Alt') return mac ? '⌥' : 'Alt';
    if (p === 'Ctrl') return mac ? '⌃' : 'Ctrl';
    if (p === 'Delete') return 'Del';
    if (p === 'ArrowUp') return '↑';
    if (p === 'ArrowDown') return '↓';
    if (p === 'Escape') return 'Esc';
    return p.length === 1 ? p.toUpperCase() : p;
  }).join(mac ? '' : '+');
}

/** True when the keyboard focus is inside a text-editing element. */
export function isTextInputFocused(target: EventTarget | null = document.activeElement): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable || !!t.closest('.cm-editor');
}

/** Debounce helper. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
}
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;
  const wrapped = ((...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; const a = lastArgs; lastArgs = null; if (a) fn(...a); }, ms);
  }) as Debounced<A>;
  wrapped.cancel = () => { if (timer) clearTimeout(timer); timer = null; lastArgs = null; };
  wrapped.flush = () => { if (timer) { clearTimeout(timer); timer = null; const a = lastArgs; lastArgs = null; if (a) fn(...a); } };
  return wrapped;
}

/** Clamp a number. */
export function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Human readable byte size. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Safe localStorage access (private windows may throw). */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

/** Random short id. */
export function shortId(len = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const rnd = typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? crypto.getRandomValues(new Uint8Array(len)) : null;
  for (let i = 0; i < len; i++) out += chars[(rnd ? rnd[i] : Math.floor(Math.random() * 256)) % chars.length];
  return out;
}
