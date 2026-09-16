import type { Diagnostic } from '../../scripting/types';
import type { EditorContext } from '../app/EditorContext';
import { el, icon } from '../ui/dom';

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  time: number;
  source: 'editor' | 'edit-engine' | 'play';
  script?: string;
  entity?: number;
  count: number;
}

/** Bottom tab: diagnostics from the editor, the editing engine and play mode. */
export class ConsolePanel {
  readonly root = el('div', { class: 'console' });
  private list = el('div', { class: 'console-list', attrs: { role: 'log', 'aria-live': 'polite' } });
  private entries: ConsoleEntry[] = [];
  private filters = { log: true, warn: true, error: true };
  private search = el('input', { class: 'text-input search-input', attrs: { type: 'search', placeholder: 'Filter…', 'aria-label': 'Filter console' } });
  private counts = { log: 0, warn: 0, error: 0 };
  private countEls: Record<string, HTMLElement> = {};
  onCounts: ((counts: { log: number; warn: number; error: number }) => void) | null = null;
  private autoScroll = true;

  constructor(private readonly ctx: EditorContext) {
    const bar = el('div', { class: 'panel-toolbar' });
    for (const lvl of ['error', 'warn', 'log'] as const) {
      const c = el('span', { class: 'count', text: '0' });
      this.countEls[lvl] = c;
      const b = el('button', { class: `filter-btn lvl-${lvl} active`, attrs: { type: 'button', 'aria-pressed': 'true', 'data-tip': `Show ${lvl}s` } }, icon(lvl === 'error' ? 'error' : lvl === 'warn' ? 'warning' : 'info', 14), c);
      b.addEventListener('click', () => { this.filters[lvl] = !this.filters[lvl]; b.classList.toggle('active', this.filters[lvl]); b.setAttribute('aria-pressed', String(this.filters[lvl])); this.render(); });
      bar.appendChild(b);
    }
    bar.appendChild(this.search);
    const clear = el('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Clear console', 'data-tip': 'Clear' } }, icon('trash'));
    clear.addEventListener('click', () => this.clear());
    bar.appendChild(clear);
    this.root.append(bar, this.list);
    this.search.addEventListener('input', () => this.render());
    this.list.addEventListener('scroll', () => { this.autoScroll = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 8; });
    for (const level of ['error', 'warn', 'log'] as const) ctx.engine.diagnostics.on(level, (d) => this.push(level, d, 'edit-engine'));
    ctx.viewport.play.events.on('diagnostic', ({ level, d }) => this.push(level, d, 'play'));
    this.render();
  }

  push(level: ConsoleEntry['level'], d: Diagnostic | string, source: ConsoleEntry['source']): void {
    const diag = typeof d === 'string' ? { level, message: d } as Diagnostic : d;
    const last = this.entries[this.entries.length - 1];
    if (last && last.message === diag.message && last.level === level && last.source === source) { last.count++; last.time = Date.now(); this.render(); return; }
    this.entries.push({ level, message: diag.message, time: Date.now(), source, script: diag.script, entity: diag.entity, count: 1 });
    if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500);
    this.counts[level]++;
    this.onCounts?.(this.counts);
    this.render();
  }

  clear(): void {
    this.entries = [];
    this.counts = { log: 0, warn: 0, error: 0 };
    this.onCounts?.(this.counts);
    this.render();
  }

  /** Reset counters shown in the tab badge (e.g. when the tab is viewed). */
  acknowledge(): void { this.counts = { log: 0, warn: 0, error: 0 }; this.onCounts?.(this.counts); }

  private render(): void {
    for (const lvl of ['error', 'warn', 'log'] as const) this.countEls[lvl].textContent = String(this.entries.filter((e) => e.level === lvl).reduce((n, e) => n + e.count, 0));
    this.list.textContent = '';
    const q = this.search.value.trim().toLowerCase();
    const shown = this.entries.filter((e) => this.filters[e.level] && (!q || e.message.toLowerCase().includes(q) || e.script?.toLowerCase().includes(q)));
    if (!shown.length) { this.list.appendChild(el('div', { class: 'panel-empty small dim', text: this.entries.length ? 'Nothing matches the current filter.' : 'Script logs, warnings and errors appear here. Press Play to run the scene.' })); return; }
    for (const e of shown.slice(-300)) {
      const row = el('div', { class: `console-row lvl-${e.level}` },
        icon(e.level === 'error' ? 'error' : e.level === 'warn' ? 'warning' : 'info', 13),
        el('span', { class: 'console-time dim', text: new Date(e.time).toLocaleTimeString([], { hour12: false }) }),
        el('span', { class: `console-src src-${e.source}`, text: e.source === 'play' ? 'play' : e.source === 'editor' ? 'editor' : 'edit' }),
        e.script ? el('button', { class: 'console-script', text: e.script, attrs: { type: 'button', title: 'Open script' }, on: { click: () => this.ctx.openScript(e.script!) } }) : null,
        el('span', { class: 'console-msg', text: e.message }),
        e.count > 1 ? el('span', { class: 'console-count', text: `×${e.count}` }) : null,
      );
      if (e.entity && e.source === 'edit-engine') row.addEventListener('click', () => { if (this.ctx.engine.world.isAlive(e.entity!)) { this.ctx.state.select(e.entity!); this.ctx.state.reveal(e.entity!); } });
      this.list.appendChild(row);
    }
    if (this.autoScroll) this.list.scrollTop = this.list.scrollHeight;
  }
}
