import { el, storage } from '../ui/dom';
import { EventEmitter } from '../../core/EventEmitter';

export interface LayoutState {
  left: number;
  right: number;
  bottom: number;
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
}

const DEFAULT: LayoutState = { left: 260, right: 320, bottom: 260, leftOpen: true, rightOpen: true, bottomOpen: true };
const KEY = 'forge.editor.layout';

export interface LayoutEvents extends Record<string, unknown> {
  change: LayoutState;
}

/**
 * Editor shell layout: menu bar, toolbar, left / center / right columns and
 * a bottom dock, separated by draggable splitters. Sizes persist in
 * localStorage. Panels can be collapsed; at narrow widths the side panels
 * shrink so the viewport keeps a usable size.
 */
export class Layout {
  readonly events = new EventEmitter<LayoutEvents>();
  readonly root = el('div', { class: 'editor-root' });
  readonly menubarHost = el('div', { class: 'menubar-host' });
  readonly toolbarHost = el('div', { class: 'toolbar-host', attrs: { role: 'toolbar', 'aria-label': 'Editor toolbar' } });
  readonly left = el('aside', { class: 'panel panel-left', attrs: { 'aria-label': 'Hierarchy' } });
  readonly center = el('main', { class: 'panel panel-center', attrs: { 'aria-label': 'Viewport' } });
  readonly right = el('aside', { class: 'panel panel-right', attrs: { 'aria-label': 'Inspector' } });
  readonly bottom = el('section', { class: 'panel panel-bottom', attrs: { 'aria-label': 'Bottom dock' } });
  readonly statusbar = el('footer', { class: 'statusbar' });
  state: LayoutState;

  private splitLeft = el('div', { class: 'splitter splitter-v', attrs: { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize hierarchy', tabindex: '0' } });
  private splitRight = el('div', { class: 'splitter splitter-v', attrs: { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize inspector', tabindex: '0' } });
  private splitBottom = el('div', { class: 'splitter splitter-h', attrs: { role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize bottom dock', tabindex: '0' } });

  constructor(host: HTMLElement) {
    this.state = { ...DEFAULT, ...storage.get<Partial<LayoutState>>(KEY, {}) };
    const body = el('div', { class: 'editor-body' });
    const middle = el('div', { class: 'editor-middle' });
    middle.append(this.left, this.splitLeft, this.center, this.splitRight, this.right);
    body.append(middle, this.splitBottom, this.bottom);
    this.root.append(this.menubarHost, this.toolbarHost, body, this.statusbar);
    host.appendChild(this.root);
    this.bindSplitter(this.splitLeft, 'left', 1);
    this.bindSplitter(this.splitRight, 'right', -1);
    this.bindSplitter(this.splitBottom, 'bottom', -1);
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  toggle(panel: 'left' | 'right' | 'bottom', open?: boolean): void {
    const key = `${panel}Open` as const;
    this.state[key] = open ?? !this.state[key];
    this.apply();
  }

  isOpen(panel: 'left' | 'right' | 'bottom'): boolean {
    return this.state[`${panel}Open` as const];
  }

  reset(): void {
    this.state = { ...DEFAULT };
    this.apply();
  }

  private apply(): void {
    const s = this.state;
    const narrow = innerWidth < 1100;
    const maxSide = Math.max(160, Math.floor(innerWidth * (narrow ? 0.28 : 0.4)));
    s.left = Math.min(Math.max(160, s.left), maxSide);
    s.right = Math.min(Math.max(200, s.right), maxSide);
    s.bottom = Math.min(Math.max(120, s.bottom), Math.floor(innerHeight * 0.7));
    this.root.style.setProperty('--left-w', s.leftOpen ? `${s.left}px` : '0px');
    this.root.style.setProperty('--right-w', s.rightOpen ? `${s.right}px` : '0px');
    this.root.style.setProperty('--bottom-h', s.bottomOpen ? `${s.bottom}px` : '0px');
    this.left.hidden = !s.leftOpen;
    this.right.hidden = !s.rightOpen;
    this.bottom.hidden = !s.bottomOpen;
    this.splitLeft.classList.toggle('collapsed', !s.leftOpen);
    this.splitRight.classList.toggle('collapsed', !s.rightOpen);
    this.splitBottom.classList.toggle('collapsed', !s.bottomOpen);
    this.root.classList.toggle('narrow', narrow);
    storage.set(KEY, s);
    this.events.emit('change', s);
  }

  private bindSplitter(sp: HTMLElement, key: 'left' | 'right' | 'bottom', dir: 1 | -1): void {
    sp.addEventListener('pointerdown', (e) => {
      if (!this.state[`${key}Open` as const]) return;
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.classList.add('dragging');
      const start = key === 'bottom' ? e.clientY : e.clientX;
      const startSize = this.state[key];
      const move = (ev: PointerEvent): void => {
        const cur = key === 'bottom' ? ev.clientY : ev.clientX;
        this.state[key] = startSize + (cur - start) * dir;
        this.apply();
      };
      const up = (): void => {
        sp.classList.remove('dragging');
        sp.removeEventListener('pointermove', move);
        sp.removeEventListener('pointerup', up);
        sp.removeEventListener('pointercancel', up);
      };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
      sp.addEventListener('pointercancel', up);
    });
    sp.addEventListener('dblclick', () => this.toggle(key));
    sp.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const horizontal = key !== 'bottom';
      if ((horizontal && e.key === 'ArrowLeft') || (!horizontal && e.key === 'ArrowUp')) { this.state[key] += (horizontal ? -1 : 1) * step * dir * (horizontal ? 1 : -1); this.apply(); e.preventDefault(); }
      if ((horizontal && e.key === 'ArrowRight') || (!horizontal && e.key === 'ArrowDown')) { this.state[key] += (horizontal ? 1 : -1) * step * dir * (horizontal ? 1 : -1); this.apply(); e.preventDefault(); }
      if (e.key === 'Enter') this.toggle(key);
    });
  }
}
