import type { ActionRegistry } from '../app/Actions';
import { el, formatShortcut, icon } from './dom';

/** Ctrl+K palette listing every registered action with fuzzy search. */
export function openCommandPalette(actions: ActionRegistry): void {
  const backdrop = el('div', { class: 'dialog-backdrop palette-backdrop' });
  const box = el('div', { class: 'palette', attrs: { role: 'dialog', 'aria-label': 'Command palette' } });
  const input = el('input', { class: 'palette-input', attrs: { type: 'text', placeholder: 'Type a command…', 'aria-label': 'Search commands', autocomplete: 'off' } });
  const list = el('div', { class: 'palette-list', attrs: { role: 'listbox' } });
  box.append(el('div', { class: 'palette-head' }, icon('search'), input), list);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  let rows: { el: HTMLElement; run: () => void }[] = [];
  let active = 0;

  const close = (): void => { backdrop.remove(); document.removeEventListener('keydown', onKey, true); };
  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    list.textContent = '';
    rows = [];
    const all = actions.all().filter((a) => !a.hidden && (a.enabled?.() ?? true));
    const scored = all
      .map((a) => ({ a, s: score(q, `${a.category ?? ''} ${a.title}`) }))
      .filter((x) => x.s > 0 || !q)
      .sort((x, y) => y.s - x.s || x.a.title.localeCompare(y.a.title))
      .slice(0, 60);
    let i = 0;
    for (const { a } of scored) {
      const row = el('div', { class: 'palette-row', attrs: { role: 'option', 'aria-selected': 'false' } },
        el('span', { class: 'palette-cat', text: a.category ?? '' }),
        el('span', { class: 'palette-title', text: a.title }),
        a.shortcut ? el('kbd', { text: formatShortcut(a.shortcut) }) : null,
      );
      const idx = i++;
      row.addEventListener('mousemove', () => setActive(idx));
      row.addEventListener('click', () => { close(); actions.run(a.id); });
      list.appendChild(row);
      rows.push({ el: row, run: () => actions.run(a.id) });
    }
    if (!rows.length) list.appendChild(el('div', { class: 'palette-empty', text: 'No matching commands' }));
    setActive(0);
  };
  const setActive = (i: number): void => {
    active = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, j) => { r.el.classList.toggle('active', j === active); r.el.setAttribute('aria-selected', String(j === active)); });
    rows[active]?.el.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; close(); r?.run(); }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  input.addEventListener('input', render);
  render();
  input.focus();
}

/** Simple subsequence scoring: 0 = no match. */
function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0, s = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return 0;
    s += idx === ti ? 3 : 1;
    ti = idx + 1;
  }
  return s;
}
