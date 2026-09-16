/**
 * Runtime player. Reads `?project=<id|url>&room=<id>&scene=<name>&renderer=2d|3d`
 * and runs the project. Without `project`, shows a built-in smoke scene
 * (bouncing sprites in 2D, or a lit spinning cube with `?renderer=3d`).
 */
import '../styles/base.css';
import '../styles/player.css';
import { Engine } from '../core/Engine';
import { ProjectLoader } from '../project/ProjectLoader';
import { ProjectStore } from '../project/ProjectStore';
import { engineOptionsFor, runProject } from '../project/runProject';
import { smokeScene2D, smokeScene3D, smokeScripts } from './smoke';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Game viewport');
canvas.tabIndex = 0;
app.appendChild(canvas);

const loading = document.createElement('div');
loading.className = 'player-loading';
loading.innerHTML = '<div class="box"><h1>Loading…</h1><progress max="1" value="0"></progress><div class="error" hidden></div></div>';
app.appendChild(loading);
const progress = loading.querySelector('progress')!;
const errorBox = loading.querySelector<HTMLElement>('.error')!;

function fail(message: string): void {
  loading.hidden = false;
  loading.querySelector('h1')!.textContent = 'Could not start';
  progress.hidden = true;
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function toolbar(engine: Engine): void {
  const bar = document.createElement('div');
  bar.className = 'player-bar';
  const mk = (label: string, fn: () => void, aria?: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', fn);
    bar.appendChild(b);
    return b;
  };
  const pause = mk('Pause', () => { engine.togglePause(); pause.textContent = engine.paused ? 'Resume' : 'Pause'; });
  mk('Debug', () => { const d = engine.renderer?.debug; if (d) d.enabled = !d.enabled; }, 'Toggle debug drawing');
  mk('Fullscreen', () => { void app.requestFocus?.(); void app.requestFullscreen?.(); });
  mk('Home', () => { location.href = './index.html'; });
  app.appendChild(bar);
  const stats = engine.hud.text('stats', '', { anchor: 'bottom-left' });
  stats.style.fontFamily = 'var(--mono)';
  stats.style.fontSize = '11px';
  stats.style.opacity = '0.7';
  engine.events.on('afterRender', () => {
    if (engine.clock.frame % 15 !== 0) return;
    const s = engine.renderer?.stats;
    stats.textContent = `${engine.clock.fps.toFixed(0)} fps · tick ${engine.clock.tick} · ${engine.world.entityCount} entities` + (s ? ` · ${s.drawCalls} draws` : '');
  });
}

declare global {
  interface HTMLElement { requestFocus?(): void }
  interface Window { forge?: Engine }
}

async function main(): Promise<void> {
  const projectRef = params.get('project');
  const room = params.get('room') ?? '';
  const rendererParam = params.get('renderer');
  let engine: Engine;
  try {
    if (projectRef) {
      const loader = new ProjectLoader(new ProjectStore());
      const project = await loader.resolve(projectRef);
      document.title = `${project.name} – Forge Player`;
      loading.querySelector('h1')!.textContent = project.name;
      engine = Engine.create(canvas, engineOptionsFor(project, rendererParam === '2d' || rendererParam === '3d' ? { renderer: rendererParam } : {}));
      engine.diagnostics.on('error', (d) => console.error('[forge]', d.message, d.error ?? ''));
      await runProject(engine, project, {
        onProgress: (f) => { progress.value = f; },
        scene: params.get('scene') ?? undefined,
      });
      if (room && project.settings.network.mode !== 'none') {
        // Multiplayer: transport from ?net= (peer | local | ws), room from ?room=, name from ?name=.
        // installNetworking connects, installs the NetSync for the project's mode and shows the lobby
        // (with a "Play offline" fallback); see src/net/README.md and docs/MULTIPLAYER.md.
        const { installNetworking, parseNetParams } = await import('../net');
        await installNetworking(engine, {
          params: parseNetParams(location.search),
          project,
          container: app,
          onOffline: () => engine.hud.text('room', 'Playing offline', { anchor: 'top-left' }),
        });
      }
    } else {
      const is3d = rendererParam === '3d';
      document.title = is3d ? 'Forge Player – 3D smoke test' : 'Forge Player – 2D smoke test';
      engine = Engine.create(canvas, { renderer: is3d ? '3d' : '2d', pixelsPerUnit: 48, seed: 42, touchOverlay: { joystick: true, buttons: [{ name: 'jump' }] } });
      engine.diagnostics.on('error', (d) => console.error('[forge]', d.message, d.error ?? ''));
      engine.scripting.load(smokeScripts);
      engine.loadScene(is3d ? smokeScene3D() : smokeScene2D());
      engine.hud.text('hint', is3d ? 'Drag to orbit · wheel to zoom · ?renderer=2d for the 2D scene' : 'WASD / arrows to move · Space to jump · ?renderer=3d for the 3D scene', { anchor: 'top', y: 10 });
    }
  } catch (err) {
    fail((err as Error).stack ?? String(err));
    return;
  }
  loading.hidden = true;
  toolbar(engine);
  window.forge = engine;
  engine.start();
  canvas.focus();
}

void main();
