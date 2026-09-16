import { el } from './dom';

/** Accessible tab strip with a content area; panels are created lazily. */
export class Tabs {
  readonly root = el('div', { class: 'tabs' });
  readonly strip = el('div', { class: 'tab-strip', attrs: { role: 'tablist' } });
  readonly content = el('div', { class: 'tab-content' });
  private tabs = new Map<string, { button: HTMLButtonElement; panel: HTMLElement; badge: HTMLElement; onShow?: () => void }>();
  private currentId = '';
  onChange: ((id: string) => void) | null = null;

  constructor(readonly id: string) {
    this.root.append(this.strip, this.content);
    this.strip.addEventListener('keydown', (e) => {
      const ids = Array.from(this.tabs.keys());
      const i = ids.indexOf(this.currentId);
      if (e.key === 'ArrowRight') { e.preventDefault(); this.show(ids[(i + 1) % ids.length]); this.tabs.get(this.currentId)?.button.focus(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.show(ids[(i - 1 + ids.length) % ids.length]); this.tabs.get(this.currentId)?.button.focus(); }
    });
  }

  add(id: string, label: string, panel: HTMLElement, opts: { onShow?: () => void; icon?: Node } = {}): HTMLElement {
    const badge = el('span', { class: 'tab-badge', attrs: { hidden: 'true' } });
    const button = el('button', { class: 'tab', attrs: { role: 'tab', type: 'button', id: `${this.id}-tab-${id}`, 'aria-controls': `${this.id}-panel-${id}`, 'aria-selected': 'false', tabindex: '-1' } }, opts.icon ?? null, el('span', { text: label }), badge);
    button.addEventListener('click', () => this.show(id));
    panel.classList.add('tab-panel');
    panel.id = `${this.id}-panel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.hidden = true;
    this.strip.appendChild(button);
    this.content.appendChild(panel);
    this.tabs.set(id, { button, panel, badge, onShow: opts.onShow });
    if (!this.currentId) this.show(id);
    return panel;
  }

  show(id: string): void {
    const t = this.tabs.get(id);
    if (!t) return;
    for (const [k, v] of this.tabs) {
      const on = k === id;
      v.button.setAttribute('aria-selected', String(on));
      v.button.tabIndex = on ? 0 : -1;
      v.button.classList.toggle('active', on);
      v.panel.hidden = !on;
    }
    const changed = this.currentId !== id;
    this.currentId = id;
    t.onShow?.();
    if (changed) this.onChange?.(id);
  }

  get current(): string { return this.currentId; }

  setBadge(id: string, count: number, cls = ''): void {
    const t = this.tabs.get(id);
    if (!t) return;
    t.badge.textContent = count > 99 ? '99+' : String(count);
    t.badge.hidden = count === 0;
    t.badge.className = `tab-badge ${cls}`;
  }
}
