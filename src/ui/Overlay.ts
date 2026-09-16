/** Placement for overlay elements. */
export type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export interface OverlayItemOptions {
  anchor?: Anchor;
  /** Offset in CSS px from the anchor. */
  x?: number;
  y?: number;
  /** Extra class names. */
  className?: string;
}

const ANCHOR_CSS: Record<Anchor, string> = {
  'top-left': 'top:0;left:0;',
  top: 'top:0;left:50%;transform:translateX(-50%);',
  'top-right': 'top:0;right:0;',
  left: 'top:50%;left:0;transform:translateY(-50%);',
  center: 'top:50%;left:50%;transform:translate(-50%,-50%);',
  right: 'top:50%;right:0;transform:translateY(-50%);',
  'bottom-left': 'bottom:0;left:0;',
  bottom: 'bottom:0;left:50%;transform:translateX(-50%);',
  'bottom-right': 'bottom:0;right:0;',
};

/**
 * Tiny DOM HUD layered over a canvas: labels, buttons and arbitrary
 * elements positioned by anchor. Styling comes from `src/styles/hud.css`
 * (class `forge-hud`) with sensible inline fallbacks.
 */
export class Overlay {
  readonly root: HTMLElement;
  private items = new Map<string, HTMLElement>();

  constructor(readonly container: HTMLElement) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.root = document.createElement('div');
    this.root.className = 'forge-hud';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff;';
    container.appendChild(this.root);
  }

  private place(el: HTMLElement, opts: OverlayItemOptions): void {
    const a = opts.anchor ?? 'top-left';
    el.style.cssText += `position:absolute;${ANCHOR_CSS[a]}margin:${opts.y ?? 12}px ${opts.x ?? 12}px;`;
    if (opts.className) el.classList.add(...opts.className.split(' '));
  }

  /** Create or update a text label. */
  text(id: string, text: string, opts: OverlayItemOptions = {}): HTMLElement {
    let el = this.items.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'forge-hud-text';
      el.style.cssText = 'font-size:14px;text-shadow:0 1px 2px rgba(0,0,0,.8);white-space:pre;';
      this.place(el, opts);
      this.root.appendChild(el);
      this.items.set(id, el);
    }
    el.textContent = text;
    return el;
  }

  /** Create a clickable button. */
  button(id: string, label: string, onClick: () => void, opts: OverlayItemOptions = {}): HTMLButtonElement {
    this.remove(id);
    const el = document.createElement('button');
    el.className = 'forge-hud-button';
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = 'pointer-events:auto;cursor:pointer;background:rgba(20,22,30,.85);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:8px 14px;font:600 14px system-ui;';
    el.addEventListener('click', onClick);
    this.place(el, opts);
    this.root.appendChild(el);
    this.items.set(id, el);
    return el;
  }

  /** Mount any element. */
  add(id: string, el: HTMLElement, opts: OverlayItemOptions = {}): HTMLElement {
    this.remove(id);
    this.place(el, opts);
    this.root.appendChild(el);
    this.items.set(id, el);
    return el;
  }

  /** A centred message panel (title + optional body) that blocks clicks until removed. */
  panel(id: string, title: string, body = '', opts: OverlayItemOptions = {}): HTMLElement {
    const el = document.createElement('div');
    el.className = 'forge-hud-panel';
    el.style.cssText = 'pointer-events:auto;background:rgba(15,17,24,.92);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:20px 28px;text-align:center;min-width:220px;';
    const h = document.createElement('div');
    h.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:6px;';
    h.textContent = title;
    el.appendChild(h);
    if (body) {
      const p = document.createElement('div');
      p.style.cssText = 'font-size:14px;opacity:.85;white-space:pre-line;';
      p.textContent = body;
      el.appendChild(p);
    }
    return this.add(id, el, { anchor: 'center', x: 0, y: 0, ...opts });
  }

  get(id: string): HTMLElement | undefined {
    return this.items.get(id);
  }

  remove(id: string): void {
    const el = this.items.get(id);
    if (el) {
      el.remove();
      this.items.delete(id);
    }
  }

  clear(): void {
    for (const el of this.items.values()) el.remove();
    this.items.clear();
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}
