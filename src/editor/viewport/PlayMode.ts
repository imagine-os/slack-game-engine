import { Engine } from '../../core/Engine';
import { EventEmitter } from '../../core/EventEmitter';
import { engineOptionsFor, runProject } from '../../project/runProject';
import type { Project } from '../../project/types';
import type { Diagnostic } from '../../scripting/types';
import type { PlayState } from '../app/EditorState';
import { el } from '../ui/dom';
import { procgenPlugin } from '../../procgen/plugin';

export interface PlayModeEvents extends Record<string, unknown> {
  change: PlayState;
  diagnostic: { level: Diagnostic['level']; d: Diagnostic };
}

/**
 * Runs the project in a second engine on its own canvas layered over the
 * edit viewport. The edit world is never touched, so stopping restores the
 * scene exactly.
 */
export class PlayMode {
  readonly events = new EventEmitter<PlayModeEvents>();
  readonly host = el('div', { class: 'play-host', attrs: { hidden: 'true' } });
  engine: Engine | null = null;
  private _state: PlayState = 'edit';
  private canvas: HTMLCanvasElement | null = null;
  private fpsTimer = 0;
  onStats: ((text: string) => void) | null = null;

  get state(): PlayState { return this._state; }

  private setState(s: PlayState): void {
    if (s === this._state) return;
    this._state = s;
    this.events.emit('change', s);
  }

  async start(project: Project, sceneName: string): Promise<void> {
    if (this.engine) this.stop();
    this.host.hidden = false;
    this.canvas = el('canvas', { attrs: { 'aria-label': 'Game preview', tabindex: '0' } });
    this.host.appendChild(this.canvas);
    const engine = Engine.create(this.canvas, engineOptionsFor(project, { render: { preserveDrawingBuffer: true } }));
    engine.use(procgenPlugin);
    this.engine = engine;
    for (const level of ['error', 'warn', 'log'] as const) engine.diagnostics.on(level, (d) => this.events.emit('diagnostic', { level, d }));
    try {
      await runProject(engine, project, { scene: sceneName });
    } catch (err) {
      this.events.emit('diagnostic', { level: 'error', d: { level: 'error', message: `Play failed: ${(err as Error).message}`, error: err } });
      this.stop();
      return;
    }
    engine.start();
    this.canvas.focus();
    this.setState('playing');
    this.fpsTimer = window.setInterval(() => {
      if (!this.engine) return;
      const s = this.engine.renderer?.stats;
      this.onStats?.(`${this.engine.clock.fps.toFixed(0)} fps · tick ${this.engine.clock.tick} · ${this.engine.world.entityCount} entities${s ? ` · ${s.drawCalls} draws` : ''}`);
    }, 250);
  }

  pause(): void {
    if (!this.engine || this._state !== 'playing') return;
    this.engine.pause();
    this.setState('paused');
  }

  resume(): void {
    if (!this.engine || this._state !== 'paused') return;
    this.engine.resume();
    this.canvas?.focus();
    this.setState('playing');
  }

  /** Advance one fixed step while paused. */
  step(): void {
    if (!this.engine) return;
    if (this._state === 'playing') this.pause();
    const e = this.engine;
    e.resume();
    e.step(e.clock.fixedDelta);
    e.pause();
  }

  stop(): void {
    if (this.fpsTimer) { clearInterval(this.fpsTimer); this.fpsTimer = 0; }
    if (this.engine) {
      try { this.engine.dispose(); } catch { /* ignore */ }
      this.engine = null;
    }
    this.canvas?.remove();
    this.canvas = null;
    this.host.hidden = true;
    this.host.textContent = '';
    this.onStats?.('');
    this.setState('edit');
  }
}
