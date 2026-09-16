import type { ProjectSummary } from '../../project/types';
import { el, icon } from '../ui/dom';
import { openDialog } from '../ui/Dialog';

interface DemoEntry { id: string; title: string; description: string; thumbnail?: string; renderer?: '2d' | '3d' }

export interface WelcomeChoice {
  kind: 'new' | 'open' | 'template' | 'import';
  renderer?: '2d' | '3d';
  id?: string;
  name?: string;
  json?: string;
}

/** Start dialog: new 2D/3D project, recent projects, demo templates, import. */
export function openWelcome(recent: ProjectSummary[], demos: DemoEntry[], onChoose: (c: WelcomeChoice) => void, opts: { dismissible?: boolean } = {}): void {
  let handle: { close(): void } | null = null;
  const choose = (c: WelcomeChoice): void => { handle?.close(); onChoose(c); };
  const nameInput = el('input', { class: 'text-input', attrs: { type: 'text', value: 'My Game', 'aria-label': 'Project name' } });
  const newCard = (renderer: '2d' | '3d'): HTMLElement => {
    const b = el('button', { class: 'welcome-card new', attrs: { type: 'button' } }, icon(renderer === '2d' ? 'shapes' : 'cube', 26), el('strong', { text: renderer === '2d' ? 'New 2D project' : 'New 3D project' }), el('span', { class: 'dim small', text: renderer === '2d' ? 'Sprites, tilemaps, 2D physics' : 'Meshes, lights, orbit camera' }));
    b.addEventListener('click', () => choose({ kind: 'new', renderer, name: nameInput.value.trim() || 'My Game' }));
    return b;
  };
  const importBtn = el('button', { class: 'welcome-card', attrs: { type: 'button' } }, icon('upload', 26), el('strong', { text: 'Import JSON' }), el('span', { class: 'dim small', text: 'Open a .forge.json file' }));
  importBtn.addEventListener('click', () => {
    const input = el('input', { attrs: { type: 'file', accept: 'application/json,.json' } });
    input.addEventListener('change', async () => { const f = input.files?.[0]; if (f) choose({ kind: 'import', json: await f.text() }); });
    input.click();
  });
  const recentList = el('div', { class: 'welcome-list' });
  if (!recent.length) recentList.appendChild(el('p', { class: 'dim small', text: 'Projects you save appear here.' }));
  for (const p of recent.slice(0, 8)) {
    const b = el('button', { class: 'welcome-row', attrs: { type: 'button' } },
      p.thumbnail ? el('img', { class: 'welcome-thumb', attrs: { src: p.thumbnail, alt: '' } }) : el('span', { class: 'welcome-thumb' }, icon(p.renderer === '3d' ? 'cube' : 'shapes', 16)),
      el('span', { class: 'welcome-row-text' }, el('strong', { text: p.name }), el('span', { class: 'dim small', text: `${p.renderer.toUpperCase()} · ${new Date(p.updatedAt).toLocaleString()}` })));
    b.addEventListener('click', () => choose({ kind: 'open', id: p.id }));
    recentList.appendChild(b);
  }
  const demoList = el('div', { class: 'welcome-list' });
  if (!demos.length) demoList.appendChild(el('p', { class: 'dim small', text: 'No demo templates available.' }));
  for (const d of demos) {
    const b = el('button', { class: 'welcome-row', attrs: { type: 'button' } },
      d.thumbnail ? el('img', { class: 'welcome-thumb', attrs: { src: `./demos/${d.id}/${d.thumbnail}`, alt: '' } }) : el('span', { class: 'welcome-thumb' }, icon('forge', 16)),
      el('span', { class: 'welcome-row-text' }, el('strong', { text: d.title }), el('span', { class: 'dim small', text: d.description })));
    b.addEventListener('click', () => choose({ kind: 'template', id: d.id }));
    demoList.appendChild(b);
  }
  const drop = el('div', { class: 'welcome-drop dim small', text: 'Tip: drop a project .json file anywhere on this dialog to import it.' });
  const body = el('div', { class: 'welcome' },
    el('div', { class: 'welcome-hero' }, icon('forge', 34), el('div', {}, el('h3', { text: 'Forge Editor' }), el('p', { class: 'dim', text: 'Build 2D and 3D games in your browser. Everything is saved locally; export JSON to share.' }))),
    el('label', { class: 'field-stack' }, el('span', { text: 'Project name' }), nameInput),
    el('div', { class: 'welcome-cards' }, newCard('2d'), newCard('3d'), importBtn),
    el('div', { class: 'welcome-cols' },
      el('section', {}, el('h4', { text: 'Recent projects' }), recentList),
      el('section', {}, el('h4', { text: 'Start from a demo' }), demoList)),
    drop,
  );
  body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('drop'); });
  body.addEventListener('dragleave', () => body.classList.remove('drop'));
  body.addEventListener('drop', async (e) => { e.preventDefault(); body.classList.remove('drop'); const f = e.dataTransfer?.files[0]; if (f) choose({ kind: 'import', json: await f.text() }); });
  handle = openDialog({ title: 'Welcome', size: 'lg', body, dismissible: opts.dismissible ?? false, className: 'welcome-dialog' });
}
