import { el, formatShortcut, icon } from './dom';

/** One entry of a dropdown or context menu. */
export interface MenuItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  /** Renders a separator when true. */
  separator?: boolean;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  submenu?: MenuItem[];
  onClick?: () => void;
}

let openMenu: HTMLElement | null = null;
let closeOpen: (() => void) | null = null;

/** Close any open dropdown/context menu. */
export function closeMenus(): void {
  closeOpen?.();
}

/**
 * Show a floating menu at a position (or anchored below an element). Returns
 * a close function. Keyboard: arrows navigate, Enter activates, Escape closes.
 */
export function showMenu(items: MenuItem[], at: { x: number; y: number } | HTMLElement, opts: { onClose?: () => void; align?: 'left' | 'right'; parent?: HTMLElement } = {}): () => void {
  if (!opts.parent) closeMenus();
  const menu = el('div', { class: 'menu', attrs: { role: 'menu', tabindex: '-1' } });
  const focusables: HTMLElement[] = [];
  let submenuClose: (() => void) | null = null;
  for (const item of items) {
    if (item.separator) { menu.appendChild(el('div', { class: 'menu-sep', attrs: { role: 'separator' } })); continue; }
    const row = el('div', { class: `menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''}`, attrs: { role: item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', tabindex: item.disabled ? '-1' : '0', 'aria-disabled': item.disabled ? 'true' : undefined, 'aria-checked': item.checked !== undefined ? String(item.checked) : undefined } });
    row.appendChild(el('span', { class: 'menu-check' }, item.checked ? icon('check', 14) : null));
    row.appendChild(el('span', { class: 'menu-icon' }, item.icon ? icon(item.icon, 14) : null));
    row.appendChild(el('span', { class: 'menu-label', text: item.label ?? '' }));
    if (item.submenu) row.appendChild(el('span', { class: 'menu-shortcut' }, icon('chevron', 12)));
    else if (item.shortcut) row.appendChild(el('span', { class: 'menu-shortcut', text: formatShortcut(item.shortcut) }));
    if (!item.disabled) {
      const activate = (): void => {
        if (item.submenu) {
          submenuClose?.();
          submenuClose = showMenu(item.submenu, row, { parent: menu, align: 'right' });
          return;
        }
        closeAll();
        item.onClick?.();
      };
      row.addEventListener('click', (e) => { e.stopPropagation(); activate(); });
      row.addEventListener('mouseenter', () => {
        row.focus();
        if (item.submenu) activate();
        else submenuClose?.();
      });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || (item.submenu && e.key === 'ArrowRight')) { e.preventDefault(); activate(); } });
      focusables.push(row);
    }
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  // Position.
  const rect = at instanceof HTMLElement ? at.getBoundingClientRect() : null;
  const submenu = !!opts.parent;
  let x = rect ? (submenu ? rect.right + 2 : rect.left) : at instanceof HTMLElement ? 0 : at.x;
  let y = rect ? (submenu ? rect.top - 6 : rect.bottom + 4) : at instanceof HTMLElement ? 0 : at.y;
  if (rect && opts.align === 'right' && !submenu) x = rect.right - menu.offsetWidth;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (x + mw > innerWidth - 8) x = submenu && rect ? rect.left - mw - 2 : Math.max(8, innerWidth - mw - 8);
  if (y + mh > innerHeight - 8) y = Math.max(8, innerHeight - mh - 8);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const onDocDown = (e: MouseEvent): void => {
    const t = e.target as Node;
    if (menu.contains(t)) return;
    if (opts.parent?.contains(t)) return;
    // Clicks inside a nested submenu are handled by that submenu.
    if ((t as HTMLElement).closest?.('.menu')) return;
    if (at instanceof HTMLElement && at.contains(t) && !submenu) { closeAll(); return; }
    closeAll();
  };
  const onKey = (e: KeyboardEvent): void => {
    const idx = focusables.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAll(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(idx + 1) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(idx - 1 + focusables.length) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowLeft' && submenu) { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); closeAll(); }
  };
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    submenuClose?.();
    menu.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openMenu === menu) { openMenu = null; closeOpen = null; }
    opts.onClose?.();
  };
  const closeAll = (): void => {
    close();
    if (submenu) closeMenus();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
  });
  if (!submenu) { openMenu = menu; closeOpen = close; }
  if (!submenu) requestAnimationFrame(() => focusables[0]?.focus());
  return close;
}

/** Bind a context menu to an element. `build` runs on each open so items reflect current state. */
export function contextMenu(target: HTMLElement, build: (ev: MouseEvent) => MenuItem[] | null): void {
  target.addEventListener('contextmenu', (ev) => {
    const items = build(ev);
    if (!items) return;
    ev.preventDefault();
    ev.stopPropagation();
    showMenu(items, { x: ev.clientX, y: ev.clientY });
  });
}

/** A horizontal menu bar (File, Edit, ...). */
export class MenuBar {
  readonly root = el('div', { class: 'menubar', attrs: { role: 'menubar' } });
  private closeCurrent: (() => void) | null = null;
  private current: HTMLElement | null = null;

  add(label: string, build: () => MenuItem[]): HTMLElement {
    const btn = el('button', { class: 'menubar-item', text: label, attrs: { type: 'button', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false' } });
    const open = (): void => {
      if (this.current === btn) { this.closeCurrent?.(); return; }
      this.closeCurrent?.();
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('open');
      this.current = btn;
      this.closeCurrent = showMenu(build(), btn, {
        onClose: () => {
          btn.setAttribute('aria-expanded', 'false');
          btn.classList.remove('open');
          if (this.current === btn) { this.current = null; this.closeCurrent = null; }
        },
      });
    };
    btn.addEventListener('click', open);
    btn.addEventListener('mouseenter', () => { if (this.current && this.current !== btn) open(); });
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } });
    this.root.appendChild(btn);
    return btn;
  }
}
