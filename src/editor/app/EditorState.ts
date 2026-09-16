import { EventEmitter } from '../../core/EventEmitter';
import type { Entity } from '../../core/ecs/Entity';
import { storage } from '../ui/dom';

export type Tool = 'select' | 'move' | 'rotate' | 'scale';
export type PlayState = 'edit' | 'playing' | 'paused';

export interface SnapSettings {
  enabled: boolean;
  /** Grid step in world units. */
  grid: number;
  /** Angle step in degrees. */
  angle: number;
  /** Scale step. */
  scale: number;
}

export interface EditorStateEvents extends Record<string, unknown> {
  selection: readonly Entity[];
  tool: Tool;
  snap: SnapSettings;
  play: PlayState;
  dirty: boolean;
  /** Toggle-able overlays. */
  overlays: OverlaySettings;
  /** Request the inspector / hierarchy to enter entity picking mode. */
  pickEntity: ((e: Entity | null) => void) | null;
  /** A user asked to see this entity in the hierarchy/viewport. */
  reveal: Entity;
}

export interface OverlaySettings {
  grid: boolean;
  colliders: boolean;
  gizmos: boolean;
  bounds: boolean;
  remoteCursors: boolean;
}

/**
 * Shared editor UI state: selection, active tool, snapping, play state and
 * dirty flag. Panels subscribe to change events rather than polling.
 */
export class EditorState {
  readonly events = new EventEmitter<EditorStateEvents>();
  private _selection: Entity[] = [];
  private _tool: Tool = 'select';
  private _play: PlayState = 'edit';
  private _dirty = false;
  private _pick: ((e: Entity | null) => void) | null = null;
  snap: SnapSettings = storage.get<SnapSettings>('forge.editor.snap', { enabled: false, grid: 0.5, angle: 15, scale: 0.1 });
  overlays: OverlaySettings = storage.get<OverlaySettings>('forge.editor.overlays', { grid: true, colliders: false, gizmos: true, bounds: false, remoteCursors: true });

  get selection(): readonly Entity[] { return this._selection; }
  /** Last selected entity (the inspector's primary target). */
  get primary(): Entity | null { return this._selection.length ? this._selection[this._selection.length - 1] : null; }

  select(entities: Entity | Entity[] | null, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    const list = entities === null ? [] : Array.isArray(entities) ? entities : [entities];
    let next: Entity[];
    if (mode === 'replace') next = [...new Set(list)];
    else if (mode === 'add') next = [...new Set([...this._selection, ...list])];
    else {
      next = [...this._selection];
      for (const e of list) {
        const i = next.indexOf(e);
        if (i >= 0) next.splice(i, 1); else next.push(e);
      }
    }
    if (next.length === this._selection.length && next.every((e, i) => e === this._selection[i])) return;
    this._selection = next;
    this.events.emit('selection', this._selection);
  }

  isSelected(e: Entity): boolean { return this._selection.includes(e); }

  /** Drop dead entities from the selection. */
  prune(isAlive: (e: Entity) => boolean): void {
    const next = this._selection.filter(isAlive);
    if (next.length !== this._selection.length) { this._selection = next; this.events.emit('selection', next); }
  }

  get tool(): Tool { return this._tool; }
  set tool(t: Tool) { if (t !== this._tool) { this._tool = t; this.events.emit('tool', t); } }

  setSnap(patch: Partial<SnapSettings>): void {
    this.snap = { ...this.snap, ...patch };
    storage.set('forge.editor.snap', this.snap);
    this.events.emit('snap', this.snap);
  }

  setOverlay(patch: Partial<OverlaySettings>): void {
    this.overlays = { ...this.overlays, ...patch };
    storage.set('forge.editor.overlays', this.overlays);
    this.events.emit('overlays', this.overlays);
  }

  get play(): PlayState { return this._play; }
  set play(p: PlayState) { if (p !== this._play) { this._play = p; this.events.emit('play', p); } }
  get isPlaying(): boolean { return this._play !== 'edit'; }

  get dirty(): boolean { return this._dirty; }
  set dirty(d: boolean) { if (d !== this._dirty) { this._dirty = d; this.events.emit('dirty', d); } }

  /** Entity picking mode (inspector "pick" buttons). */
  get picking(): ((e: Entity | null) => void) | null { return this._pick; }
  beginPick(fn: (e: Entity | null) => void): void { this._pick = fn; this.events.emit('pickEntity', fn); }
  endPick(e: Entity | null): void { const fn = this._pick; this._pick = null; this.events.emit('pickEntity', null); fn?.(e); }

  reveal(e: Entity): void { this.events.emit('reveal', e); }
}
