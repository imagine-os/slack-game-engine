import '../styles/base.css';
import '../styles/launcher.css';
import { ProjectStore } from '../project/ProjectStore';
import type { ProjectSummary } from '../project/types';
import { VERSION } from '../index';

/** One entry of `public/demos/index.json` (written by the demos worker). */
interface DemoEntry {
  id: string;
  title?: string;
  /** Alternative to `title`. */
  name?: string;
  description: string;
  /** Path relative to `demos/`. */
  thumbnail?: string;
  renderer?: '2d' | '3d';
  /** Supports "Play Multiplayer". */
  multiplayer?: boolean;
  /** Player count as free text ("2-4") or a range. */
  players?: string | { min: number; max: number };
  tags?: string[];
  /** Short control hints shown on the card. */
  controls?: string[];
  featured?: boolean;
  /** Shown as the big banner above the demo grid (the first flagged demo wins). */
  hero?: boolean;
  /** Starter template (what "New project" copies). */
  template?: boolean;
}

function demoTitle(d: DemoEntry): string {
  return d.title ?? d.name ?? d.id;
}

function playersText(p: DemoEntry['players']): string {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return p.min === p.max ? `${p.max} player${p.max === 1 ? '' : 's'}` : `${p.min}-${p.max} players`;
}

interface DemoIndex {
  demos: DemoEntry[];
}

const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function roomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function playUrl(project: string, opts: { room?: string; renderer?: string } = {}): string {
  const p = new URLSearchParams({ project });
  if (opts.room) p.set('room', opts.room);
  if (opts.renderer) p.set('renderer', opts.renderer);
  return `./play.html?${p.toString()}`;
}

function editorUrl(project: string): string {
  return `./editor.html?${new URLSearchParams({ project }).toString()}`;
}

function toast(msg: string): void {
  const t = el('div', 'toast', msg);
  t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function card(opts: {
  title: string;
  description: string;
  thumbnail?: string;
  badges: { text: string; cls?: string }[];
  buttons: { label: string; primary?: boolean; onClick: () => void; aria?: string }[];
  /** Optional extra line under the description (e.g. controls). */
  note?: string;
}): HTMLElement {
  const c = el('article', 'card');
  const thumb = el('div', 'thumb');
  if (opts.thumbnail) {
    const img = el('img');
    img.src = opts.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); thumb.textContent = '🎮'; };
    thumb.appendChild(img);
  } else thumb.textContent = '🎮';
  c.appendChild(thumb);
  const body = el('div', 'body');
  body.appendChild(el('h3', undefined, opts.title));
  body.appendChild(el('p', 'desc', opts.description));
  if (opts.note) {
    const note = el('p', 'desc note', opts.note);
    note.style.opacity = '0.75';
    note.style.fontSize = '12px';
    body.appendChild(note);
  }
  const meta = el('div', 'meta');
  for (const b of opts.badges) meta.appendChild(el('span', `badge ${b.cls ?? ''}`.trim(), b.text));
  body.appendChild(meta);
  const buttons = el('div', 'buttons');
  for (const b of opts.buttons) {
    const btn = el('button', b.primary ? 'primary' : undefined, b.label);
    if (b.aria) btn.setAttribute('aria-label', b.aria);
    btn.addEventListener('click', b.onClick);
    buttons.appendChild(btn);
  }
  body.appendChild(buttons);
  c.appendChild(body);
  return c;
}

function demoCard(d: DemoEntry): HTMLElement {
  const title = demoTitle(d);
  const players = playersText(d.players);
  const badges: { text: string; cls?: string }[] = [{ text: d.renderer === '3d' ? '3D' : '2D', cls: d.renderer === '3d' ? 'threed' : '' }];
  if (d.featured) badges.push({ text: 'Featured', cls: 'featured' });
  if (d.template) badges.push({ text: 'Template' });
  if (d.multiplayer) badges.push({ text: players ? `Multiplayer ${players}` : 'Multiplayer', cls: 'net' });
  else if (players) badges.push({ text: players });
  for (const t of d.tags ?? []) badges.push({ text: t });
  const buttons = [
    { label: 'Play', primary: true, onClick: () => { location.href = playUrl(d.id); }, aria: `Play ${title}` },
  ];
  if (d.multiplayer) {
    buttons.push({
      label: 'Play Multiplayer',
      primary: false,
      onClick: () => { location.href = playUrl(d.id, { room: roomId() }); },
      aria: `Play ${title} in a new multiplayer room`,
    });
  }
  buttons.push({ label: 'Open in Editor', primary: false, onClick: () => { location.href = editorUrl(d.id); }, aria: `Open ${title} in the editor` });
  return card({
    title,
    description: d.description,
    thumbnail: d.thumbnail ? `./demos/${d.id}/${d.thumbnail}` : undefined,
    badges,
    buttons,
    note: d.controls?.length ? d.controls.join(' · ') : undefined,
  });
}

/** Flagship banner for a demo flagged `hero`: big thumbnail, blurb and the same actions as its card. */
function heroBanner(d: DemoEntry): HTMLElement {
  const title = demoTitle(d);
  const banner = el('section', 'showcase');
  banner.setAttribute('aria-label', `${title} showcase`);
  if (d.thumbnail) banner.style.backgroundImage = `url("./demos/${d.id}/${d.thumbnail}")`;
  const body = el('div', 'showcase-body');
  body.appendChild(el('span', 'showcase-kicker', 'Featured demo'));
  body.appendChild(el('h2', undefined, title));
  body.appendChild(el('p', undefined, d.description));
  const meta = el('div', 'meta');
  const players = playersText(d.players);
  if (d.renderer === '3d') meta.appendChild(el('span', 'badge threed', '3D'));
  if (d.multiplayer) meta.appendChild(el('span', 'badge net', players ? `Multiplayer ${players}` : 'Multiplayer'));
  for (const t of (d.tags ?? []).slice(0, 4)) meta.appendChild(el('span', 'badge', t));
  body.appendChild(meta);
  const actions = el('div', 'actions');
  const play = el('button', 'primary', 'Play now');
  play.setAttribute('aria-label', `Play ${title}`);
  play.addEventListener('click', () => { location.href = playUrl(d.id); });
  actions.appendChild(play);
  if (d.multiplayer) {
    const mp = el('button', undefined, 'Play with friends');
    mp.setAttribute('aria-label', `Play ${title} in a new multiplayer room`);
    mp.addEventListener('click', () => { location.href = playUrl(d.id, { room: roomId() }); });
    actions.appendChild(mp);
  }
  const edit = el('button', undefined, 'Open in Editor');
  edit.addEventListener('click', () => { location.href = editorUrl(d.id); });
  actions.appendChild(edit);
  body.appendChild(actions);
  if (d.controls?.length) body.appendChild(el('p', 'showcase-controls', d.controls.join('  ·  ')));
  banner.appendChild(body);
  return banner;
}

function projectCard(p: ProjectSummary, store: ProjectStore, refresh: () => void): HTMLElement {
  return card({
    title: p.name,
    description: p.description || 'Local project saved in this browser.',
    thumbnail: p.thumbnail || undefined,
    badges: [{ text: p.renderer === '3d' ? '3D' : '2D', cls: p.renderer === '3d' ? 'threed' : '' }, { text: 'Local' }],
    buttons: [
      { label: 'Play', primary: true, onClick: () => { location.href = playUrl(p.id); } },
      { label: 'Edit', onClick: () => { location.href = editorUrl(p.id); } },
      {
        label: 'Delete',
        onClick: async () => {
          if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
          await store.delete(p.id);
          toast('Project deleted');
          refresh();
        },
        aria: `Delete ${p.name}`,
      },
    ],
  });
}

async function loadDemos(): Promise<DemoEntry[]> {
  try {
    const res = await fetch('./demos/index.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = (await res.json()) as DemoIndex | DemoEntry[];
    return Array.isArray(data) ? data : data.demos ?? [];
  } catch {
    return [];
  }
}

async function render(): Promise<void> {
  app.innerHTML = '';
  app.setAttribute('aria-busy', 'true');
  const hero = el('header', 'hero');
  const intro = el('div');
  intro.appendChild(el('h1', undefined, 'Forge Engine'));
  intro.appendChild(el('p', undefined, 'Build 2D and 3D games in the browser with an entity-component world, scripting, physics, and shared multiplayer rooms. Pick a demo, jump in, or open the editor.'));
  hero.appendChild(intro);
  const actions = el('div', 'actions');
  const newBtn = el('button', 'primary', 'New project');
  newBtn.addEventListener('click', () => { location.href = './editor.html?new=1'; });
  const editorBtn = el('button', undefined, 'Open editor');
  editorBtn.addEventListener('click', () => { location.href = './editor.html'; });
  const importBtn = el('button', undefined, 'Import project');
  importBtn.addEventListener('click', () => importProject());
  actions.append(newBtn, editorBtn, importBtn);
  hero.appendChild(actions);
  app.appendChild(hero);
  app.appendChild(multiplayerHelp());

  const showcaseSlot = el('div');
  app.appendChild(showcaseSlot);

  const demosTitle = el('div', 'section-title');
  demosTitle.id = 'demos';
  demosTitle.appendChild(el('h2', undefined, 'Demos'));
  const demoCount = el('span');
  demosTitle.appendChild(demoCount);
  app.appendChild(demosTitle);
  const demoGrid = el('section', 'grid');
  demoGrid.setAttribute('aria-label', 'Demo games');
  app.appendChild(demoGrid);

  const tplTitle = el('div', 'section-title');
  tplTitle.id = 'templates';
  tplTitle.appendChild(el('h2', undefined, 'Templates'));
  const tplCount = el('span');
  tplTitle.appendChild(tplCount);
  app.appendChild(tplTitle);
  const tplGrid = el('section', 'grid');
  tplGrid.setAttribute('aria-label', 'Starter templates');
  app.appendChild(tplGrid);

  const projTitle = el('div', 'section-title');
  projTitle.appendChild(el('h2', undefined, 'Your projects'));
  const projCount = el('span');
  projTitle.appendChild(projCount);
  app.appendChild(projTitle);
  const projGrid = el('section', 'grid');
  projGrid.setAttribute('aria-label', 'Local projects');
  app.appendChild(projGrid);

  const foot = el('footer');
  foot.appendChild(el('span', undefined, `Forge Engine v${VERSION}`));
  const docs = el('a', undefined, 'Documentation');
  docs.href = 'https://github.com/imagine-os/slack-game-engine#readme';
  docs.target = '_blank';
  docs.rel = 'noopener';
  foot.appendChild(docs);
  app.appendChild(foot);

  const store = new ProjectStore();
  const [demos, projects] = await Promise.all([loadDemos(), store.list().catch(() => [] as ProjectSummary[])]);
  const games = demos.filter((d) => !d.template);
  const templates = demos.filter((d) => d.template);
  const flagship = games.find((d) => d.hero);
  if (flagship) showcaseSlot.appendChild(heroBanner(flagship));
  demoCount.textContent = games.length ? `${games.length} available` : '';
  if (games.length === 0) {
    demoGrid.appendChild(el('div', 'empty', 'No demos yet. Demo projects live in public/demos/ and are listed in public/demos/index.json.'));
  } else for (const d of games) demoGrid.appendChild(demoCard(d));
  tplCount.textContent = templates.length ? `${templates.length} to start from` : '';
  if (templates.length === 0) {
    tplGrid.appendChild(el('div', 'empty', 'Starter templates are demos flagged "template" in public/demos/index.json; "New project" copies one.'));
  } else for (const d of templates) tplGrid.appendChild(demoCard(d));
  projCount.textContent = projects.length ? `${projects.length} saved` : '';
  if (projects.length === 0) {
    projGrid.appendChild(el('div', 'empty', 'Projects you create in the editor are saved in this browser and appear here.'));
  } else for (const p of projects) projGrid.appendChild(projectCard(p, store, () => void render()));
  app.setAttribute('aria-busy', 'false');
}

/** Collapsible explainer for the three ways a room can be shared. */
function multiplayerHelp(): HTMLElement {
  const box = el('details', 'howto');
  box.id = 'multiplayer';
  const summary = el('summary', undefined, 'How multiplayer works');
  box.appendChild(summary);
  const intro = el('p', undefined, 'Every game here is a room. "Play Multiplayer" opens one with a fresh room code; the lobby\'s "Copy invite link" gives friends the URL. The first person in a room hosts and runs the simulation, everyone else sends input. If the host leaves, another player takes over.');
  box.appendChild(intro);
  const list = el('dl');
  const row = (term: string, text: string, code?: string) => {
    list.appendChild(el('dt', undefined, term));
    const dd = el('dd', undefined, text);
    if (code) { dd.appendChild(document.createTextNode(' ')); dd.appendChild(el('code', undefined, code)); }
    list.appendChild(dd);
  };
  row('Different devices (default)', 'Peer-to-peer over WebRTC with a public signalling server: nothing to deploy, but every device needs internet access and strict NATs may need a TURN server.', '?room=CODE');
  row('Trying it alone', 'Same-browser mode connects tabs of this browser without any network: open the same link in two tabs.', '?room=CODE&net=local');
  row('Your own relay', 'Behind strict NATs or for a fixed address, run the bundled WebSocket relay (npm run serve, see server/README.md) and point rooms at it.', '?room=CODE&net=ws&server=wss://your-host/ws');
  box.appendChild(list);
  const more = el('p');
  const link = el('a', undefined, 'docs/MULTIPLAYER.md');
  link.href = 'https://github.com/imagine-os/slack-game-engine/blob/main/docs/MULTIPLAYER.md';
  link.target = '_blank';
  link.rel = 'noopener';
  more.append('Making your own game multiplayer takes five steps: ', link, '.');
  box.appendChild(more);
  return box;
}

function importProject(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const store = new ProjectStore();
      const project = store.import(await file.text());
      await store.save(project);
      toast(`Imported "${project.name}"`);
      void render();
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`);
    }
  });
  input.click();
}

void render();
