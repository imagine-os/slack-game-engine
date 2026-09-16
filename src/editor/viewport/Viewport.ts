import { Engine } from '../../core/Engine';
import { EventEmitter } from '../../core/EventEmitter';
import type { Entity } from '../../core/ecs/Entity';
import { Transform } from '../../core/ecs/Transform';
import { Color, Vec2, Vec3 } from '../../core/math';
import { BoxCollider2D, CircleCollider2D, PolygonCollider2D } from '../../physics/components2d';
import { BoxCollider3D, SphereCollider3D } from '../../physics/physics3d';
import { Camera2D, Light2D, MeshRenderer, ParticleEmitter, Shape, Sprite, Text, Tilemap } from '../../render/components';
import type { EditorState } from '../app/EditorState';
import type { CommandStack } from '../commands/CommandStack';
import { SetFieldsCommand } from '../commands/SceneCommands';
import type { SceneEditor } from '../project/SceneEditor';
import { el, icon } from '../ui/dom';
import { EditorCamera, type CameraPose } from './EditorCamera';
import { Gizmo } from './Gizmo';
import { Picker } from './Picking';
import { PlayMode } from './PlayMode';

/** A collaborator's cursor and selection as drawn in the viewport. */
export interface RemotePresence {
  id: string;
  name: string;
  color: string;
  /** World-space cursor (2D plane or 3D ground plane), or null when outside the viewport. */
  cursor: { x: number; y: number; z: number } | null;
  selection: Entity[];
}

export interface ViewportEvents extends Record<string, unknown> {
  /** World position under the pointer changed (throttled by caller). */
  cursor: { x: number; y: number; z: number } | null;
  /** Camera moved. */
  camera: CameraPose;
  /** Asset dropped on the viewport. */
  assetDrop: { id: string; kind: string; position: Vec3 };
  /** Right click on the viewport. */
  contextMenu: { x: number; y: number; world: Vec3; entity: Entity | null };
}

type DragMode = 'none' | 'pan' | 'rotate' | 'gizmo' | 'move' | 'box';

/**
 * Center panel: an editing `Engine` (render only, simulation paused) with an
 * overlay canvas for grid, selection, gizmos and collaborator cursors, plus a
 * layered play-mode canvas. Handles picking, box select, camera navigation,
 * transform drags and asset drops.
 */
export class Viewport {
  readonly events = new EventEmitter<ViewportEvents>();
  readonly root = el('div', { class: 'viewport', attrs: { tabindex: '0', 'aria-label': 'Scene viewport' } });
  readonly canvas: HTMLCanvasElement;
  readonly overlay = el('canvas', { class: 'overlay-canvas', attrs: { 'aria-hidden': 'true' } });
  readonly hint = el('div', { class: 'viewport-hint' });
  readonly emptyState = el('div', { class: 'viewport-empty', attrs: { hidden: 'true' } });
  readonly engine: Engine;
  readonly camera: EditorCamera;
  readonly picker: Picker;
  readonly gizmo: Gizmo;
  readonly play: PlayMode;
  readonly is3d: boolean;
  /** Collaborator presence to draw. */
  remote: RemotePresence[] = [];
  /** Highlighted entity for "reveal" flashes. */
  private flashUntil = 0;
  private flashEntity: Entity = 0;

  private drag: DragMode = 'none';
  private dragStart = new Vec2();
  private dragLast = new Vec2();
  private boxRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private moveStarted = false;
  private hiddenRestore: { c: { visible: boolean }; v: boolean }[] = [];
  private lastCursorEmit = 0;
  private dropHover = false;
  private ctx: CanvasRenderingContext2D;

  constructor(
    readonly state: EditorState,
    readonly scene: SceneEditor,
    private readonly commands: CommandStack,
    engine: Engine,
  ) {
    this.engine = engine;
    this.canvas = engine.canvas!;
    this.canvas.classList.add('edit-canvas');
    this.is3d = engine.renderer?.kind === '3d';
    this.root.append(this.canvas, this.overlay, this.hint, this.emptyState);
    this.play = new PlayMode();
    this.root.appendChild(this.play.host);
    this.ctx = this.overlay.getContext('2d')!;
    this.camera = new EditorCamera(engine, scene, this.is3d);
    this.picker = new Picker(engine, scene);
    this.gizmo = new Gizmo(engine, scene, state);
    this.emptyState.append(
      icon('layers', 28),
      el('h3', { text: 'Your scene is empty' }),
      el('p', { text: this.is3d ? 'Right-click the viewport or use Entity › Create to add a cube, light or camera.' : 'Right-click the viewport or use Entity › Create to add sprites and shapes. Drag an image from the Assets tab to place it here.' }),
    );
    if (engine.renderer) engine.renderer.debug.enabled = true;
    engine.events.on('beforeRender', () => this.beforeRender());
    engine.events.on('afterRender', () => this.afterRender());
    engine.events.on('resize', () => this.resizeOverlay());
    engine.start();
    engine.pause();
    this.resizeOverlay();
    this.bindEvents();
    scene.events.on('loaded', () => {
      const pose = scene.editorSettings.camera as CameraPose | undefined;
      if (pose && typeof pose.x === 'number') this.camera.setPose(pose);
      else this.camera.reset();
      this.updateEmptyState();
    });
    scene.events.on('structure', () => this.updateEmptyState());
    state.events.on('play', (p) => { this.root.classList.toggle('playing', p !== 'edit'); });
    state.events.on('reveal', (e) => { this.flashEntity = e; this.flashUntil = performance.now() + 1200; });
    this.updateEmptyState();
  }

  /** Create the editing engine for a renderer kind. */
  static createEngine(canvas: HTMLCanvasElement, renderer: '2d' | '3d', pixelsPerUnit: number): Engine {
    return Engine.create(canvas, { renderer, pixelsPerUnit, input: false, defaultBindings: false, touchOverlay: false, render: { preserveDrawingBuffer: true } });
  }

  private updateEmptyState(): void {
    const all = this.scene.all();
    const empty = all.every((e) => this.engine.world.hasComponent(e, Camera2D) || this.engine.world.getComponentTypes(e).every((t) => t === 'Transform' || t === 'Name' || t === 'Camera3D' || t === 'AudioListener'));
    this.emptyState.hidden = !empty || this.state.isPlaying;
  }

  private resizeOverlay(): void {
    const r = this.engine.renderer;
    const w = r?.width ?? this.root.clientWidth, h = r?.height ?? this.root.clientHeight;
    const dpr = r?.pixelRatio ?? 1;
    this.overlay.width = Math.floor(w * dpr);
    this.overlay.height = Math.floor(h * dpr);
    this.overlay.style.width = `${w}px`;
    this.overlay.style.height = `${h}px`;
  }

  get width(): number { return this.engine.renderer?.width ?? this.root.clientWidth; }
  get height(): number { return this.engine.renderer?.height ?? this.root.clientHeight; }

  // ------------------------------------------------------------ rendering

  private beforeRender(): void {
    this.camera.apply();
    // Hide entities flagged hidden by temporarily clearing their `visible` flags.
    this.hiddenRestore.length = 0;
    const w = this.engine.world;
    for (const e of this.scene.all()) {
      if (!this.scene.isHidden(e)) continue;
      for (const c of w.getComponents(e)) {
        const v = c as unknown as { visible?: boolean; enabled?: boolean };
        if (typeof v.visible === 'boolean') { this.hiddenRestore.push({ c: v as { visible: boolean }, v: v.visible }); v.visible = false; }
      }
    }
    if (this.is3d) this.draw3DDebug();
  }

  private afterRender(): void {
    for (const r of this.hiddenRestore) r.c.visible = r.v;
    this.hiddenRestore.length = 0;
    this.drawOverlay();
  }

  private draw3DDebug(): void {
    const dbg = this.engine.renderer?.debug;
    if (!dbg) return;
    const ov = this.state.overlays;
    if (ov.grid) {
      const size = 20;
      const minor = new Color(1, 1, 1, 0.08), major = new Color(1, 1, 1, 0.18);
      for (let i = -size; i <= size; i++) {
        const c = i % 5 === 0 ? major : minor;
        dbg.line3({ x: i, y: 0, z: -size }, { x: i, y: 0, z: size }, i === 0 ? new Color(0.3, 0.76, 1, 0.8) : c);
        dbg.line3({ x: -size, y: 0, z: i }, { x: size, y: 0, z: i }, i === 0 ? new Color(1, 0.36, 0.48, 0.8) : c);
      }
      dbg.line3({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }, new Color(0.5, 0.9, 0.53, 0.9));
    }
    const sel = new Color(1, 0.48, 0.24, 1);
    for (const e of this.state.selection) {
      const b = this.picker.worldBounds(e);
      if (b) dbg.box3(b.min, b.max, sel);
    }
    for (const p of this.remote) {
      const c = Color.fromHex(p.color);
      for (const e of p.selection) { const b = this.picker.worldBounds(e); if (b) dbg.box3(b.min, b.max, c); }
    }
    if (ov.colliders) {
      const cc = new Color(0.49, 0.91, 0.53, 0.9);
      const w = this.engine.world;
      for (const e of this.scene.all()) {
        const t = w.getComponent(e, Transform);
        if (!t) continue;
        const box = w.getComponent(e, BoxCollider3D);
        if (box) { const p = t.getWorldPosition(); const s = t.getWorldScale(); dbg.box3({ x: p.x + box.offset.x - box.size.x * s.x / 2, y: p.y + box.offset.y - box.size.y * s.y / 2, z: p.z + box.offset.z - box.size.z * s.z / 2 }, { x: p.x + box.offset.x + box.size.x * s.x / 2, y: p.y + box.offset.y + box.size.y * s.y / 2, z: p.z + box.offset.z + box.size.z * s.z / 2 }, cc); }
        const sp = w.getComponent(e, SphereCollider3D);
        if (sp) { const p = t.getWorldPosition(); const r = sp.radius; dbg.box3({ x: p.x - r, y: p.y - r, z: p.z - r }, { x: p.x + r, y: p.y + r, z: p.z + r }, cc); }
      }
    }
  }

  private drawOverlay(): void {
    const ctx = this.ctx;
    const dpr = this.engine.renderer?.pixelRatio ?? 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (this.state.isPlaying) return;
    if (!this.is3d && this.state.overlays.grid) this.drawGrid2D(ctx);
    if (!this.is3d) {
      this.drawCameraFrames(ctx);
      if (this.state.overlays.colliders) this.drawColliders2D(ctx);
      if (this.state.overlays.bounds) this.drawAllBounds(ctx);
      this.drawSelection2D(ctx);
    }
    if (this.state.overlays.remoteCursors) this.drawRemote(ctx);
    this.gizmo.draw(ctx, this.state.tool, this.state.selection);
    if (this.boxRect) {
      const b = this.boxRect;
      ctx.fillStyle = 'rgba(76,194,255,0.12)';
      ctx.strokeStyle = 'rgba(76,194,255,0.9)';
      ctx.lineWidth = 1;
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
    }
    if (this.dropHover) {
      ctx.strokeStyle = 'rgba(76,194,255,0.9)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, this.width - 8, this.height - 8);
      ctx.setLineDash([]);
    }
    if (this.flashEntity && performance.now() < this.flashUntil) {
      const b = this.picker.worldBounds(this.flashEntity);
      if (b) {
        const a = this.engine.worldToScreen(b.min, new Vec2()), c = this.engine.worldToScreen(b.max, new Vec2());
        const k = (this.flashUntil - performance.now()) / 1200;
        ctx.strokeStyle = `rgba(255,209,102,${k})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(Math.min(a.x, c.x) - 6, Math.min(a.y, c.y) - 6, Math.abs(c.x - a.x) + 12, Math.abs(c.y - a.y) + 12);
      }
    }
  }

  private drawGrid2D(ctx: CanvasRenderingContext2D): void {
    const ppu = this.engine.renderer?.pixelsPerUnit ?? 32;
    const s = this.camera.zoom * ppu;
    let step = 1;
    while (step * s < 24) step *= step === 1 || Math.log10(step) % 1 === 0 ? 2 : 2.5;
    while (step * s > 160) step /= 2;
    const tl = this.engine.screenToWorld(0, 0), br = this.engine.screenToWorld(this.width, this.height);
    const x0 = Math.floor(Math.min(tl.x, br.x) / step) * step, x1 = Math.max(tl.x, br.x);
    const y0 = Math.floor(Math.min(tl.y, br.y) / step) * step, y1 = Math.max(tl.y, br.y);
    ctx.lineWidth = 1;
    const p = new Vec2();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let x = x0; x <= x1; x += step) { if (Math.abs(x) < 1e-9) continue; this.engine.worldToScreen(new Vec3(x, 0, 0), p); ctx.moveTo(Math.round(p.x) + 0.5, 0); ctx.lineTo(Math.round(p.x) + 0.5, this.height); }
    for (let y = y0; y <= y1; y += step) { if (Math.abs(y) < 1e-9) continue; this.engine.worldToScreen(new Vec3(0, y, 0), p); ctx.moveTo(0, Math.round(p.y) + 0.5); ctx.lineTo(this.width, Math.round(p.y) + 0.5); }
    ctx.stroke();
    // Axes.
    this.engine.worldToScreen(new Vec3(0, 0, 0), p);
    ctx.beginPath(); ctx.strokeStyle = 'rgba(255,92,122,0.7)'; ctx.moveTo(0, Math.round(p.y) + 0.5); ctx.lineTo(this.width, Math.round(p.y) + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.strokeStyle = 'rgba(126,231,135,0.7)'; ctx.moveTo(Math.round(p.x) + 0.5, 0); ctx.lineTo(Math.round(p.x) + 0.5, this.height); ctx.stroke();
    // Design viewport frame of the active scene camera is drawn by drawCameraFrames.
    this.hint.textContent = `grid ${step} · zoom ${this.camera.zoom.toFixed(2)}×`;
  }

  private drawCameraFrames(ctx: CanvasRenderingContext2D): void {
    const w = this.engine.world;
    const ppu = this.engine.renderer?.pixelsPerUnit ?? 32;
    for (const cam of w.componentsOfType(Camera2D)) {
      if (this.scene.editorEntities.has(cam.entity)) continue;
      const t = w.getComponent(cam.entity, Transform);
      if (!t) continue;
      const pos = t.getWorldPosition();
      const hw = (this.width / 2) / (cam.zoom * ppu) * 0.6, hh = (this.height / 2) / (cam.zoom * ppu) * 0.6;
      // Use the project design size if available via viewHalfSize (computed while playing); fall back to an aspect box.
      const a = this.engine.worldToScreen(new Vec3(pos.x - hw, pos.y + hh, 0), new Vec2());
      const b = this.engine.worldToScreen(new Vec3(pos.x + hw, pos.y - hh, 0), new Vec2());
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = this.state.isSelected(cam.entity) ? 'rgba(255,122,61,0.9)' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      this.drawIcon(ctx, pos, 'camera', this.state.isSelected(cam.entity));
    }
    for (const l of w.componentsOfType(Light2D)) {
      const t = w.getComponent(l.entity, Transform);
      if (t) this.drawIcon(ctx, t.getWorldPosition(), 'sun', this.state.isSelected(l.entity));
    }
    for (const p of w.componentsOfType(ParticleEmitter)) {
      const t = w.getComponent(p.entity, Transform);
      if (t) this.drawIcon(ctx, t.getWorldPosition(), 'sparkles', this.state.isSelected(p.entity));
    }
  }

  private drawIcon(ctx: CanvasRenderingContext2D, pos: Vec3, kind: string, selected: boolean): void {
    const s = this.engine.worldToScreen(pos, new Vec2());
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.strokeStyle = selected ? '#ff7a3d' : 'rgba(255,255,255,0.7)';
    ctx.fillStyle = 'rgba(13,15,20,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    if (kind === 'camera') { ctx.rect(-6, -4, 9, 8); ctx.moveTo(3, -1); ctx.lineTo(7, -4); ctx.lineTo(7, 4); ctx.lineTo(3, 1); }
    else if (kind === 'sun') { ctx.arc(0, 0, 4, 0, Math.PI * 2); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5); } }
    else { for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); } }
    ctx.stroke();
    ctx.restore();
  }

  private polygonOf(e: Entity): Vec2[] | null {
    const r = this.picker.localRect(e);
    if (!r) return null;
    return this.picker.worldCorners(e, r).map((c) => this.engine.worldToScreen(c, new Vec2()));
  }

  private strokePoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  }

  private drawSelection2D(ctx: CanvasRenderingContext2D): void {
    for (const e of this.state.selection) {
      const pts = this.polygonOf(e);
      if (!pts) continue;
      ctx.strokeStyle = 'rgba(255,122,61,0.95)';
      ctx.lineWidth = 2;
      this.strokePoly(ctx, pts);
      // Pivot marker.
      const t = this.engine.world.getComponent(e, Transform);
      if (t) {
        const s = this.engine.worldToScreen(t.getWorldPosition(), new Vec2());
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#ff7a3d'; ctx.fill();
      }
    }
    if (this.hoverEntity !== null && !this.state.isSelected(this.hoverEntity) && this.drag === 'none') {
      const pts = this.polygonOf(this.hoverEntity);
      if (pts) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; this.strokePoly(ctx, pts); }
    }
  }

  private drawAllBounds(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    for (const e of this.scene.all()) { const pts = this.polygonOf(e); if (pts) this.strokePoly(ctx, pts); }
  }

  private drawColliders2D(ctx: CanvasRenderingContext2D): void {
    const w = this.engine.world;
    ctx.strokeStyle = 'rgba(126,231,135,0.9)';
    ctx.lineWidth = 1.5;
    const toScreen = (t: Transform, x: number, y: number): Vec2 => this.engine.worldToScreen(t.localToWorld(new Vec3(x, y, 0)), new Vec2());
    for (const e of this.scene.all()) {
      const t = w.getComponent(e, Transform);
      if (!t) continue;
      const box = w.getComponent(e, BoxCollider2D);
      if (box) {
        const hx = box.width / 2, hy = box.height / 2, ox = box.offset.x, oy = box.offset.y;
        this.strokePoly(ctx, [toScreen(t, ox - hx, oy - hy), toScreen(t, ox + hx, oy - hy), toScreen(t, ox + hx, oy + hy), toScreen(t, ox - hx, oy + hy)]);
      }
      const circle = w.getComponent(e, CircleCollider2D);
      if (circle) {
        const pts: Vec2[] = [];
        for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; pts.push(toScreen(t, circle.offset.x + Math.cos(a) * circle.radius, circle.offset.y + Math.sin(a) * circle.radius)); }
        this.strokePoly(ctx, pts);
      }
      const poly = w.getComponent(e, PolygonCollider2D);
      if (poly && poly.points.length >= 4) {
        const pts: Vec2[] = [];
        for (let i = 0; i + 1 < poly.points.length; i += 2) pts.push(toScreen(t, poly.points[i] + poly.offset.x, poly.points[i + 1] + poly.offset.y));
        this.strokePoly(ctx, pts);
      }
    }
  }

  private drawRemote(ctx: CanvasRenderingContext2D): void {
    for (const p of this.remote) {
      if (!this.is3d) {
        for (const e of p.selection) {
          const pts = this.polygonOf(e);
          if (!pts) continue;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          this.strokePoly(ctx, pts);
          ctx.setLineDash([]);
        }
      }
      if (p.cursor) {
        const s = this.engine.worldToScreen(new Vec3(p.cursor.x, p.cursor.y, p.cursor.z), new Vec2());
        if (s.x < -20 || s.y < -20 || s.x > this.width + 20 || s.y > this.height + 20) continue;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#0d0f14';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + 12, s.y + 10); ctx.lineTo(s.x + 5, s.y + 11); ctx.lineTo(s.x + 2, s.y + 17); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.font = '11px system-ui, sans-serif';
        const tw = ctx.measureText(p.name).width + 10;
        ctx.fillRect(s.x + 12, s.y + 14, tw, 16);
        ctx.fillStyle = '#0d0f14';
        ctx.fillText(p.name, s.x + 17, s.y + 26);
      }
    }
  }

  // ---------------------------------------------------------------- input

  private hoverEntity: Entity | null = null;

  private local(ev: MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return new Vec2(ev.clientX - r.left, ev.clientY - r.top);
  }

  /** Entity under a screen point (2D or 3D). */
  pickAt(sx: number, sy: number): Entity | null {
    if (this.is3d) {
      const r = this.engine.renderer as unknown as { screenRay?: (x: number, y: number, o: Vec3, d: Vec3) => void };
      if (!r.screenRay) return null;
      const o = new Vec3(), d = new Vec3();
      r.screenRay(sx, sy, o, d);
      return this.picker.pick3D(o, d)[0] ?? null;
    }
    const w = this.engine.screenToWorld(sx, sy);
    return this.picker.pick2D(w.x, w.y)[0] ?? null;
  }

  private setCursor(c: string): void { this.root.style.cursor = c; }

  private bindEvents(): void {
    const root = this.root;
    root.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    root.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    root.addEventListener('pointerup', (ev) => this.onPointerUp(ev));
    root.addEventListener('pointercancel', (ev) => this.onPointerUp(ev));
    root.addEventListener('pointerleave', () => { if (this.drag === 'none') { this.hoverEntity = null; this.events.emit('cursor', null); } });
    root.addEventListener('wheel', (ev) => {
      if (this.state.isPlaying) return;
      ev.preventDefault();
      const p = this.local(ev);
      const factor = Math.exp(Math.sign(ev.deltaY) * 0.12 * (ev.deltaMode === 1 ? 3 : Math.min(3, Math.abs(ev.deltaY) / 50 + 0.2)));
      this.camera.zoomAt(p.x, p.y, factor);
      this.events.emit('camera', this.camera.getPose());
    }, { passive: false });
    root.addEventListener('contextmenu', (ev) => {
      if (this.state.isPlaying) return;
      ev.preventDefault();
      if (this.drag !== 'none' && this.drag !== 'pan' && this.drag !== 'rotate') return;
      if (this.dragMoved) { this.dragMoved = false; return; }
      const p = this.local(ev);
      const world = this.engine.screenToWorld(p.x, p.y);
      this.events.emit('contextMenu', { x: ev.clientX, y: ev.clientY, world, entity: this.pickAt(p.x, p.y) });
    });
    root.addEventListener('keydown', (ev) => this.onKeyDown(ev));
    root.addEventListener('dblclick', (ev) => {
      if (this.state.isPlaying) return;
      const p = this.local(ev);
      const e = this.pickAt(p.x, p.y);
      if (e !== null) { this.state.select(e); this.frameSelected(); }
    });
    // Asset drops.
    root.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer?.types.includes('application/x-forge-asset')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      this.dropHover = true;
    });
    root.addEventListener('dragleave', () => { this.dropHover = false; });
    root.addEventListener('drop', (ev) => {
      this.dropHover = false;
      const raw = ev.dataTransfer?.getData('application/x-forge-asset');
      if (!raw) return;
      ev.preventDefault();
      const { id, kind } = JSON.parse(raw) as { id: string; kind: string };
      const p = this.local(ev);
      const world = this.engine.screenToWorld(p.x, p.y);
      if (this.state.snap.enabled) { const g = this.state.snap.grid; world.set(Math.round(world.x / g) * g, Math.round(world.y / g) * g, Math.round(world.z / g) * g); }
      this.events.emit('assetDrop', { id, kind, position: world });
    });
  }

  private dragMoved = false;

  private onPointerDown(ev: PointerEvent): void {
    if (this.state.isPlaying) return;
    if ((ev.target as HTMLElement).closest('.viewport-tools')) return;
    this.root.focus({ preventScroll: true });
    const p = this.local(ev);
    this.dragStart.copy(p);
    this.dragLast.copy(p);
    this.dragMoved = false;
    const cameraDrag = ev.button === 1 || ev.button === 2 || (ev.button === 0 && ev.altKey);
    if (cameraDrag) {
      this.drag = this.is3d && (ev.button === 2 || ev.altKey) && !ev.shiftKey ? 'rotate' : 'pan';
      this.setCursor(this.drag === 'pan' ? 'grabbing' : 'move');
      this.root.setPointerCapture(ev.pointerId);
      return;
    }
    if (ev.button !== 0) return;
    if (this.state.picking) {
      const e = this.pickAt(p.x, p.y);
      this.state.endPick(e);
      return;
    }
    const handle = this.gizmo.hitTest(p.x, p.y, this.state.tool, this.state.selection);
    if (handle) {
      this.gizmo.beginDrag(handle, p.x, p.y, this.state.selection);
      this.drag = 'gizmo';
      this.root.setPointerCapture(ev.pointerId);
      return;
    }
    const hit = this.pickAt(p.x, p.y);
    if (hit !== null) {
      if (ev.shiftKey) this.state.select(hit, 'add');
      else if (ev.ctrlKey || ev.metaKey) this.state.select(hit, 'toggle');
      else if (!this.state.isSelected(hit)) this.state.select(hit);
      if (this.state.isSelected(hit) && !this.scene.isLocked(hit) && (this.state.tool === 'select' || this.state.tool === 'move')) {
        this.moveStarted = false;
        this.drag = 'move';
        this.root.setPointerCapture(ev.pointerId);
      }
      return;
    }
    // Empty space: box select.
    this.drag = 'box';
    this.boxRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    this.boxAdditive = ev.shiftKey;
    this.root.setPointerCapture(ev.pointerId);
  }

  private boxAdditive = false;

  private onPointerMove(ev: PointerEvent): void {
    const p = this.local(ev);
    const dx = p.x - this.dragLast.x, dy = p.y - this.dragLast.y;
    this.dragLast.copy(p);
    if (Math.abs(p.x - this.dragStart.x) + Math.abs(p.y - this.dragStart.y) > 3) this.dragMoved = true;
    const now = performance.now();
    if (now - this.lastCursorEmit > 50) {
      this.lastCursorEmit = now;
      const w = this.engine.screenToWorld(p.x, p.y);
      this.events.emit('cursor', { x: w.x, y: w.y, z: w.z });
      if (!this.is3d) this.hint.textContent = `x ${w.x.toFixed(2)}  y ${w.y.toFixed(2)} · zoom ${this.camera.zoom.toFixed(2)}×`;
      else this.hint.textContent = `x ${w.x.toFixed(2)}  z ${w.z.toFixed(2)} · dist ${this.camera.orbit?.distance.toFixed(1)}`;
    }
    switch (this.drag) {
      case 'pan': this.camera.pan(dx, dy); this.events.emit('camera', this.camera.getPose()); break;
      case 'rotate': this.camera.rotate(dx, dy); this.events.emit('camera', this.camera.getPose()); break;
      case 'gizmo': this.gizmo.drag(p.x, p.y, ev); break;
      case 'move':
        if (!this.moveStarted) {
          if (!this.dragMoved) return;
          this.moveStarted = true;
          this.gizmo.beginFreeMove(this.dragStart.x, this.dragStart.y, this.state.selection);
        }
        this.gizmo.drag(p.x, p.y, ev);
        break;
      case 'box':
        if (this.boxRect) { this.boxRect.x1 = p.x; this.boxRect.y1 = p.y; }
        break;
      default: {
        const h = this.gizmo.hitTest(p.x, p.y, this.state.tool, this.state.selection);
        this.gizmo.hover = h;
        if (h) this.setCursor(h === 'rot' ? 'grab' : 'move');
        else {
          this.hoverEntity = this.state.picking ? this.pickAt(p.x, p.y) : this.pickAt(p.x, p.y);
          this.setCursor(this.state.picking ? 'crosshair' : this.hoverEntity !== null ? 'pointer' : 'default');
        }
      }
    }
  }

  private onPointerUp(ev: PointerEvent): void {
    const mode = this.drag;
    this.drag = 'none';
    if (this.root.hasPointerCapture(ev.pointerId)) this.root.releasePointerCapture(ev.pointerId);
    this.setCursor('default');
    if (mode === 'gizmo' || (mode === 'move' && this.moveStarted)) {
      const targets = this.gizmo.endDrag();
      if (targets) {
        const label = this.state.tool === 'rotate' ? 'Rotate' : this.state.tool === 'scale' ? 'Scale' : 'Move';
        this.commands.breakMerge();
        this.commands.push(new SetFieldsCommand(this.scene, targets, `${label} ${targets.length === 1 ? this.engine.world.nameOf(this.state.primary ?? 0) : targets.length + ' entities'}`), { merge: false });
      }
    } else if (mode === 'box' && this.boxRect) {
      const b = this.boxRect;
      this.boxRect = null;
      if (Math.abs(b.x1 - b.x0) > 3 || Math.abs(b.y1 - b.y0) > 3) {
        const hits = this.picker.boxSelect(b.x0, b.y0, b.x1, b.y1).filter((e) => !this.scene.isLocked(e));
        this.state.select(hits, this.boxAdditive ? 'add' : 'replace');
      } else if (!this.boxAdditive) this.state.select(null);
    }
    this.moveStarted = false;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.state.isPlaying) return;
    if (ev.key === 'Escape') {
      if (this.drag === 'gizmo' || this.drag === 'move') { this.gizmo.cancelDrag(); this.drag = 'none'; }
      else if (this.state.picking) this.state.endPick(null);
      else this.state.select(null);
      return;
    }
    // Arrow nudges.
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const a = arrows[ev.key];
    if (a && this.state.selection.length) {
      ev.preventDefault();
      const step = (ev.shiftKey ? 5 : 1) * (this.state.snap.enabled ? this.state.snap.grid : 0.1);
      this.nudge(a[0] * step, a[1] * step);
    }
  }

  /** Move the selection by a world delta (2D plane / 3D ground plane). */
  nudge(dx: number, dy: number): void {
    const targets = [];
    for (const e of this.state.selection) {
      const t = this.engine.world.getComponent(e, Transform);
      const guid = this.scene.guidOf(e);
      if (!t || !guid || this.scene.isLocked(e)) continue;
      const old = t.position.toJSON();
      const value = this.is3d ? { x: old.x + dx, y: old.y, z: old.z - dy } : { x: old.x + dx, y: old.y + dy, z: old.z };
      targets.push({ guid, type: 'Transform', field: 'position', value, old });
    }
    if (targets.length) this.commands.push(new SetFieldsCommand(this.scene, targets, 'Nudge'));
  }

  /** Center the camera on the selection (or the whole scene). */
  frameSelected(): void {
    const list = this.state.selection.length ? this.state.selection : this.scene.all();
    const b = this.picker.boundsOf(list);
    if (!b) { this.camera.reset(); return; }
    this.camera.frame(b.min, b.max, this.width, this.height);
    this.events.emit('camera', this.camera.getPose());
  }

  /** Force a render (used after mutations while paused, e.g. undo). */
  requestRender(): void {
    // The engine renders every frame while running-paused; nothing to do.
  }

  /** Snapshot of the edit canvas as a data URL (thumbnails). */
  thumbnail(width = 320): string {
    const src = this.play.engine?.canvas ?? this.canvas;
    const c = document.createElement('canvas');
    const scale = width / Math.max(1, src.width);
    c.width = width;
    c.height = Math.max(1, Math.round(src.height * scale));
    const ctx = c.getContext('2d');
    if (ctx) { try { ctx.drawImage(src, 0, 0, c.width, c.height); } catch { /* tainted */ } }
    return c.toDataURL('image/jpeg', 0.7);
  }

  dispose(): void {
    this.play.stop();
    this.engine.dispose();
  }
}

/** Registered drawable component classes with a `visible` flag (used for hide/show). */
export const VISIBLE_COMPONENTS = [Sprite, Shape, Text, Tilemap, ParticleEmitter, MeshRenderer];
