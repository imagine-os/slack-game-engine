/**
 * Editor entry point. URL parameters:
 * - `?project=<id|url>`  open a local project (or a demo/URL as template)
 * - `?template=<demoId>` open a bundled demo as a template
 * - `?new=1|2d|3d`       create a new project
 * - `?room=<id>`         join / start a collaboration room
 */
import '../styles/base.css';
import '../styles/editor.css';
import '../styles/editor-panels.css';
import { Engine } from '../core/Engine';
import { createProject } from '../project/createProject';
import { ProjectLoader } from '../project/ProjectLoader';
import { ProjectStore } from '../project/ProjectStore';
import type { Project } from '../project/types';
import { EditorApp } from './app/EditorApp';
import { openWelcome } from './app/Welcome';
import { openChannel, type CollabChannel } from './collab/Channel';
import type { ProjectOrigin } from './project/ProjectService';
import { el, icon, shortId, storage } from './ui/dom';
import { toast } from './ui/Toast';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const store = new ProjectStore();
const loader = new ProjectLoader(store);

function splash(text: string): HTMLElement {
  app.textContent = '';
  const s = el('div', { class: 'editor-splash' }, icon('forge', 40), el('h1', { text: 'Forge Editor' }), el('p', { class: 'dim', text }));
  app.appendChild(s);
  return s;
}

async function loadDemos(): Promise<{ id: string; title: string; description: string; thumbnail?: string; renderer?: '2d' | '3d' }[]> {
  try {
    const res = await fetch('./demos/index.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = (await res.json()) as { demos?: unknown[] } | unknown[];
    return (Array.isArray(data) ? data : data.demos ?? []) as never;
  } catch { return []; }
}

function boot(doc: Project, origin: ProjectOrigin, room?: string, channel?: CollabChannel): void {
  app.textContent = '';
  const editor = new EditorApp(app, doc, origin, { room, channel });
  (window as unknown as { forgeEditor?: EditorApp }).forgeEditor = editor;
}

async function main(): Promise<void> {
  const room = params.get('room') ?? undefined;
  const newParam = params.get('new');
  const template = params.get('template');
  const projectRef = params.get('project');

  if (newParam) {
    const renderer = newParam === '3d' ? '3d' : '2d';
    const doc = createProject({ name: params.get('name') ?? 'My Game', renderer });
    await store.save(doc);
    const next = new URLSearchParams({ project: doc.id });
    if (room) next.set('room', room);
    const net = params.get('net');
    if (net) next.set('net', net);
    history.replaceState(null, '', `?${next.toString()}`);
    boot(doc, 'new', room);
    return;
  }
  if (template) {
    splash('Loading template…');
    try { boot(await loader.fromDemo(template), 'template', room); }
    catch (err) { splash(`Could not load demo "${template}": ${(err as Error).message}`); }
    return;
  }
  if (projectRef) {
    splash('Loading project…');
    const local = await store.load(projectRef).catch(() => undefined);
    if (local) { boot(local, 'local', room); return; }
    try { boot(await loader.resolve(projectRef), 'template', room); return; }
    catch (err) {
      if (!room) { splash(`Could not open project "${projectRef}": ${(err as Error).message}`); return; }
    }
  }
  if (room) {
    // Guest joining a room without the project: fetch the state from the host before booting.
    splash(`Joining room ${room}…`);
    const name = storage.get('forge.editor.displayName', `User ${shortId(3)}`);
    // A headless engine provides `engine.net` so the real transports are used when available.
    const channel = await openChannel(Engine.create(null, { renderer: 'none' }), room, name);
    const doc = await new Promise<Project | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);
      const off = channel.onMessage((_from, data) => {
        const m = data as { t?: string; project?: Project };
        if (m.t === 'state' && m.project) { clearTimeout(timer); off(); resolve(m.project); }
      });
      channel.send('host', { t: 'state-request' });
    });
    if (doc) { boot(doc, 'remote', room, channel); return; }
    channel.close();
    toast('Nobody answered in that room; starting a new project instead.', 'warn', { duration: 6000 });
  }
  // Welcome dialog.
  app.textContent = '';
  splash('Choose a project to begin.');
  const [recent, demos] = await Promise.all([store.list().catch(() => []), loadDemos()]);
  openWelcome(recent, demos, async (choice) => {
    if (choice.kind === 'new') location.href = `./editor.html?new=${choice.renderer}&name=${encodeURIComponent(choice.name ?? 'My Game')}`;
    else if (choice.kind === 'open') location.href = `./editor.html?project=${encodeURIComponent(choice.id!)}`;
    else if (choice.kind === 'template') location.href = `./editor.html?template=${encodeURIComponent(choice.id!)}`;
    else if (choice.kind === 'import' && choice.json) {
      try {
        const p = store.import(choice.json, { newId: `p_${shortId(8)}` });
        await store.save(p);
        location.href = `./editor.html?project=${encodeURIComponent(p.id)}`;
      } catch (err) { toast(`Import failed: ${(err as Error).message}`, 'error'); }
    }
  });
}

void main();
