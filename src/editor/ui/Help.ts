import type { ActionRegistry } from '../app/Actions';
import { el, formatShortcut } from './dom';
import { openDialog } from './Dialog';

/** Minimal Markdown → DOM renderer (headings, lists, code, tables, inline). */
export function renderMarkdown(md: string): HTMLElement {
  const root = el('div', { class: 'markdown' });
  const lines = md.split('\n');
  let i = 0;
  let list: HTMLElement | null = null;
  const flushList = (): void => { list = null; };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      root.appendChild(el('pre', {}, el('code', { text: buf.join('\n') })));
      flushList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { root.appendChild(el(`h${Math.min(6, h[1].length + 1)}` as 'h2', { html: inline(h[2]) })); flushList(); i++; continue; }
    if (/^\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const table = el('table');
      rows.forEach((r, ri) => {
        if (/^\|\s*-/.test(r)) return;
        const cells = r.split('|').slice(1, -1).map((c) => c.trim());
        const tr = el('tr');
        for (const c of cells) tr.appendChild(el(ri === 0 ? 'th' : 'td', { html: inline(c) }));
        table.appendChild(tr);
      });
      root.appendChild(table);
      flushList();
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line) ?? /^\s*\d+\.\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /^\s*\d+\./.test(line);
      if (!list) { list = el(ordered ? 'ol' : 'ul'); root.appendChild(list); }
      list.appendChild(el('li', { html: inline(li[1]) }));
      i++;
      continue;
    }
    if (!line.trim()) { flushList(); i++; continue; }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|```|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
    root.appendChild(el('p', { html: inline(para.join(' ')) }));
    flushList();
  }
  return root;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, href: string) => `<a href="${href.startsWith('http') ? href : `https://github.com/imagine-os/slack-game-engine/blob/main/docs/${href}`}" target="_blank" rel="noopener">${t}</a>`);
  return out;
}

/** Open a docs page in a dialog. */
export function openDocsDialog(title: string, markdown: string): void {
  openDialog({ title, size: 'xl', className: 'docs-dialog', body: renderMarkdown(markdown), buttons: [{ label: 'Close', primary: true, onClick: (close) => close() }] });
}

/** Shortcut cheat sheet generated from the action registry. */
export function openShortcutsDialog(actions: ActionRegistry): void {
  const groups = new Map<string, HTMLElement>();
  for (const a of actions.all()) {
    if (!a.shortcut) continue;
    const cat = a.category ?? 'General';
    let g = groups.get(cat);
    if (!g) { g = el('div', { class: 'shortcut-group' }, el('h3', { text: cat })); groups.set(cat, g); }
    g.appendChild(el('div', { class: 'shortcut-row' }, el('span', { text: a.title }), el('span', { class: 'keys' }, ...a.shortcut.split(',').map((s) => el('kbd', { text: formatShortcut(s.trim()) })))));
  }
  const extra = el('div', { class: 'shortcut-group' }, el('h3', { text: 'Viewport' }),
    ...[['Pan', 'Middle drag / Space+drag / Alt+drag'], ['Zoom', 'Wheel'], ['Orbit (3D)', 'Right drag'], ['Select', 'Click · Shift adds · Ctrl toggles'], ['Box select', 'Drag on empty space'], ['Move selection', 'Drag entity · Arrow keys nudge'], ['Snap toggle while dragging', 'Hold Ctrl'], ['Frame entity', 'Double-click']].map(([k, v]) => el('div', { class: 'shortcut-row' }, el('span', { text: k }), el('span', { class: 'keys dim', text: v }))));
  openDialog({ title: 'Keyboard shortcuts', size: 'lg', body: el('div', { class: 'shortcuts-grid' }, ...groups.values(), extra), buttons: [{ label: 'Close', primary: true, onClick: (close) => close() }] });
}
