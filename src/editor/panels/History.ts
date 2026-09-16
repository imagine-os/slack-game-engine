import type { EditorContext } from '../app/EditorContext';
import { el, icon } from '../ui/dom';

/** Bottom tab: undo history; click an entry to jump to that state. */
export class HistoryPanel {
  readonly root = el('div', { class: 'history' });
  private list = el('div', { class: 'history-list', attrs: { role: 'listbox', 'aria-label': 'Undo history' } });

  constructor(private readonly ctx: EditorContext) {
    const bar = el('div', { class: 'panel-toolbar' },
      el('button', { class: 'small', attrs: { type: 'button' }, on: { click: () => ctx.actions.run('edit.undo') } }, icon('undo', 14), el('span', { text: 'Undo' })),
      el('button', { class: 'small', attrs: { type: 'button' }, on: { click: () => ctx.actions.run('edit.redo') } }, icon('redo', 14), el('span', { text: 'Redo' })),
      el('span', { class: 'spacer' }),
      el('button', { class: 'small ghost', text: 'Clear history', attrs: { type: 'button' }, on: { click: () => ctx.commands.clear() } }),
    );
    this.root.append(bar, this.list);
    ctx.commands.events.on('change', () => this.render());
    this.render();
  }

  private render(): void {
    const { commands } = this.ctx;
    this.list.textContent = '';
    const origin = el('div', { class: `history-row ${commands.index === 0 ? 'current' : ''}`, attrs: { role: 'option', 'aria-selected': String(commands.index === 0) } }, icon('history', 13), el('span', { text: 'Original state' }));
    origin.addEventListener('click', () => commands.jumpTo(0));
    this.list.appendChild(origin);
    commands.history.forEach((c, i) => {
      const applied = i < commands.index;
      const row = el('div', { class: `history-row ${applied ? '' : 'undone'} ${i + 1 === commands.index ? 'current' : ''}`, attrs: { role: 'option', 'aria-selected': String(i + 1 === commands.index) } }, el('span', { class: 'history-idx dim', text: String(i + 1) }), el('span', { text: c.label }));
      row.addEventListener('click', () => commands.jumpTo(i + 1));
      this.list.appendChild(row);
    });
    if (!commands.history.length) this.list.appendChild(el('div', { class: 'panel-empty small dim', text: 'Edits you make appear here. Every change can be undone with Ctrl+Z.' }));
    this.list.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }
}
