import type { Engine } from '../../core/Engine';
import type { Entity } from '../../core/ecs/Entity';
import { NULL_ENTITY } from '../../core/ecs/Entity';
import { Transform } from '../../core/ecs/Transform';
import { Quat, Vec2, Vec3 } from '../../core/math';
import type { EditorState, Tool } from '../app/EditorState';
import type { FieldTarget } from '../commands/SceneCommands';
import type { SceneEditor } from '../project/SceneEditor';

export type GizmoHandle = 'x' | 'y' | 'z' | 'free' | 'rot' | 'sx' | 'sy' | 'sz' | 'suni';

interface StartState { entity: Entity; guid: string; position: Vec3; rotation: Quat; scale: Vec3; worldPos: Vec3; angle: number }

const AXIS_LEN = 80;
const ROT_RADIUS = 70;
const COLORS = { x: '#ff5c7a', y: '#7ee787', z: '#4cc2ff', free: '#ffffff', rot: '#ffd166', s: '#c8b6ff' };
const AXES: Record<'x' | 'y' | 'z', Vec3> = { x: new Vec3(1, 0, 0), y: new Vec3(0, 1, 0), z: new Vec3(0, 0, 1) };

/**
 * Move / rotate / scale manipulator drawn on the overlay canvas in screen
 * space. Drags write straight into the selected Transforms (so the scene and
 * collaborators update live) and return field targets with the original
 * values for the final undo command.
 */
export class Gizmo {
  hover: GizmoHandle | null = null;
  private dragging: GizmoHandle | null = null;
  private start: StartState[] = [];
  private startScreen = new Vec2();
  private startWorld = new Vec3();
  private center = new Vec3();
  private lastEmit = 0;

  constructor(private readonly engine: Engine, private readonly scene: SceneEditor, private readonly state: EditorState) {}

  get is3d(): boolean { return this.engine.renderer?.kind === '3d'; }
  get active(): boolean { return this.dragging !== null; }

  /** World-space pivot of the gizmo (primary selection). */
  pivot(selection: readonly Entity[]): Vec3 | null {
    const e = selection[selection.length - 1];
    const t = e !== undefined ? this.engine.world.getComponent(e, Transform) : undefined;
    return t ? t.getWorldPosition(this.center) : null;
  }

  private screenAxis(c: Vec3, axis: Vec3): { dir: Vec2; pxPerUnit: number } {
    const s0 = this.engine.worldToScreen(c, new Vec2());
    const s1 = this.engine.worldToScreen(new Vec3().copy(c).add(axis), new Vec2());
    const d = s1.sub(s0);
    const len = d.length();
    return { dir: len > 1e-6 ? d.scale(1 / len) : new Vec2(1, 0), pxPerUnit: Math.max(1e-3, len) };
  }

  /** Which handle is under the screen point for the current tool. */
  hitTest(sx: number, sy: number, tool: Tool, selection: readonly Entity[]): GizmoHandle | null {
    if (tool === 'select' || !this.state.overlays.gizmos) return null;
    const c = this.pivot(selection);
    if (!c) return null;
    const sc = this.engine.worldToScreen(c, new Vec2());
    const p = new Vec2(sx, sy);
    const d = p.distanceTo(sc);
    if (tool === 'rotate') return Math.abs(d - ROT_RADIUS) < 9 ? 'rot' : null;
    if (d < 9) return tool === 'move' ? 'free' : 'suni';
    const axes: ('x' | 'y' | 'z')[] = this.is3d ? ['x', 'y', 'z'] : ['x', 'y'];
    let best: GizmoHandle | null = null, bestD = 9;
    for (const a of axes) {
      const { dir } = this.screenAxis(c, AXES[a]);
      const end = new Vec2(sc.x + dir.x * AXIS_LEN, sc.y + dir.y * AXIS_LEN);
      const dist = segDist(p, sc, end);
      if (dist < bestD) { bestD = dist; best = tool === 'move' ? a : (`s${a}` as GizmoHandle); }
    }
    return best;
  }

  beginDrag(handle: GizmoHandle, sx: number, sy: number, selection: readonly Entity[]): void {
    this.dragging = handle;
    this.startScreen.set(sx, sy);
    this.engine.screenToWorld(sx, sy, this.startWorld);
    const c = this.pivot(selection);
    if (c) this.center.copy(c);
    this.start = [];
    for (const e of selection) {
      const t = this.engine.world.getComponent(e, Transform);
      const guid = this.scene.guidOf(e);
      if (!t || !guid || this.scene.isLocked(e)) continue;
      this.start.push({ entity: e, guid, position: t.position.clone(), rotation: t.rotation.clone(), scale: t.scale.clone(), worldPos: t.getWorldPosition(), angle: t.angle });
    }
  }

  /** Begin a free move without a handle (dragging the entity body). */
  beginFreeMove(sx: number, sy: number, selection: readonly Entity[]): void {
    this.beginDrag('free', sx, sy, selection);
  }

  private snapping(ev: { ctrlKey: boolean; metaKey: boolean }): boolean {
    return this.state.snap.enabled !== (ev.ctrlKey || ev.metaKey);
  }

  /** Update the drag; applies live to the world. */
  drag(sx: number, sy: number, ev: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    const h = this.dragging;
    if (!h) return;
    const snap = this.snapping(ev);
    const world = this.engine.world;
    const dx = sx - this.startScreen.x, dy = sy - this.startScreen.y;
    for (const s of this.start) {
      const t = world.getComponent(s.entity, Transform);
      if (!t) continue;
      if (h === 'free' || h === 'x' || h === 'y' || h === 'z') {
        const delta = new Vec3();
        if (h === 'free') {
          const cur = this.engine.screenToWorld(sx, sy, new Vec3());
          delta.copy(cur).sub(this.startWorld);
          if (!this.is3d) delta.z = 0;
        } else {
          const { dir, pxPerUnit } = this.screenAxis(this.center, AXES[h]);
          const along = dx * dir.x + dy * dir.y;
          delta.copy(AXES[h]).scale(along / pxPerUnit);
        }
        const target = s.worldPos.clone().add(delta);
        if (snap) { const g = this.state.snap.grid || 0.5; target.set(Math.round(target.x / g) * g, Math.round(target.y / g) * g, Math.round(target.z / g) * g); }
        const parent = world.getParent(s.entity);
        const pt = parent !== NULL_ENTITY ? world.getComponent(parent, Transform) : undefined;
        const local = pt ? pt.worldToLocal(target, new Vec3()) : target;
        t.position.copy(local);
        t.markDirty();
      } else if (h === 'rot') {
        let delta: number;
        if (this.is3d) delta = -dx * 0.01;
        else {
          const sc = this.engine.worldToScreen(this.center, new Vec2());
          const a0 = Math.atan2(-(this.startScreen.y - sc.y), this.startScreen.x - sc.x);
          const a1 = Math.atan2(-(sy - sc.y), sx - sc.x);
          delta = a1 - a0;
        }
        if (snap) { const step = ((this.state.snap.angle || 15) * Math.PI) / 180; delta = Math.round(delta / step) * step; }
        if (this.is3d) t.rotation.copy(Quat.fromAxisAngle(AXES.y, delta).multiply(s.rotation));
        else t.rotation.copy(Quat.fromAngle2D(s.angle + delta));
        t.markDirty();
      } else {
        let fx = 1, fy = 1, fz = 1;
        if (h === 'suni') {
          const sc = this.engine.worldToScreen(this.center, new Vec2());
          const d0 = Math.max(4, this.startScreen.distanceTo(sc));
          const d1 = new Vec2(sx, sy).distanceTo(sc);
          fx = fy = fz = Math.max(0.01, d1 / d0);
        } else {
          const a = h.slice(1) as 'x' | 'y' | 'z';
          const { dir } = this.screenAxis(this.center, AXES[a]);
          const f = Math.max(0.01, 1 + (dx * dir.x + dy * dir.y) / 100);
          if (a === 'x') fx = f; else if (a === 'y') fy = f; else fz = f;
        }
        const ns = new Vec3(s.scale.x * fx, s.scale.y * fy, s.scale.z * fz);
        if (snap) { const g = this.state.snap.scale || 0.1; ns.set(Math.max(g, Math.round(ns.x / g) * g), Math.max(g, Math.round(ns.y / g) * g), Math.max(g, Math.round(ns.z / g) * g)); }
        t.scale.copy(ns);
        t.markDirty();
      }
      t.updateWorldMatrix(true);
    }
    // Let collaborators see the drag (throttled); the final command re-emits the end value.
    const now = performance.now();
    if (now - this.lastEmit > 40) { this.lastEmit = now; this.emitLive(); }
  }

  private emitLive(): void {
    for (const t of this.currentTargets(false)) this.scene.setField(t.guid, 'Transform', t.field, t.value);
  }

  private currentTargets(withOld: boolean): FieldTarget[] {
    const out: FieldTarget[] = [];
    const field = this.dragging === 'rot' ? 'rotation' : this.dragging?.startsWith('s') ? 'scale' : 'position';
    for (const s of this.start) {
      const t = this.engine.world.getComponent(s.entity, Transform);
      if (!t) continue;
      const value = field === 'rotation' ? t.rotation.toJSON() : field === 'scale' ? t.scale.toJSON() : t.position.toJSON();
      const old = field === 'rotation' ? s.rotation.toJSON() : field === 'scale' ? s.scale.toJSON() : s.position.toJSON();
      out.push({ guid: s.guid, type: 'Transform', field, value, old: withOld ? old : undefined });
    }
    return out;
  }

  /** Finish the drag; returns targets (with old values) or null when nothing changed. */
  endDrag(): FieldTarget[] | null {
    if (!this.dragging) return null;
    const targets = this.currentTargets(true);
    this.dragging = null;
    this.start = [];
    const changed = targets.some((t) => JSON.stringify(t.value) !== JSON.stringify(t.old));
    return changed ? targets : null;
  }

  cancelDrag(): void {
    for (const s of this.start) {
      const t = this.engine.world.getComponent(s.entity, Transform);
      if (!t) continue;
      t.position.copy(s.position); t.rotation.copy(s.rotation); t.scale.copy(s.scale); t.markDirty();
    }
    this.dragging = null;
    this.start = [];
  }

  /** Draw the gizmo for the current tool. */
  draw(ctx: CanvasRenderingContext2D, tool: Tool, selection: readonly Entity[]): void {
    if (tool === 'select' || !this.state.overlays.gizmos) return;
    const c = this.pivot(selection);
    if (!c) return;
    const sc = this.engine.worldToScreen(c, new Vec2());
    const hl = this.dragging ?? this.hover;
    ctx.save();
    ctx.lineCap = 'round';
    const axes: ('x' | 'y' | 'z')[] = this.is3d ? ['x', 'y', 'z'] : ['x', 'y'];
    if (tool === 'rotate') {
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, ROT_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = hl === 'rot' ? '#ffffff' : COLORS.rot;
      ctx.lineWidth = hl === 'rot' ? 3 : 2;
      ctx.stroke();
      const e = selection[selection.length - 1];
      const t = e !== undefined ? this.engine.world.getComponent(e, Transform) : undefined;
      if (t && !this.is3d) {
        const a = t.getWorldAngle();
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.lineTo(sc.x + Math.cos(a) * ROT_RADIUS, sc.y - Math.sin(a) * ROT_RADIUS);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else {
      for (const a of axes) {
        const { dir } = this.screenAxis(c, AXES[a]);
        const ex = sc.x + dir.x * AXIS_LEN, ey = sc.y + dir.y * AXIS_LEN;
        const active = hl === a || hl === `s${a}`;
        ctx.strokeStyle = ctx.fillStyle = active ? '#ffffff' : COLORS[a];
        ctx.lineWidth = active ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(sc.x, sc.y); ctx.lineTo(ex, ey); ctx.stroke();
        if (tool === 'move') {
          const ang = Math.atan2(dir.y, dir.x);
          ctx.beginPath();
          ctx.moveTo(ex + Math.cos(ang) * 10, ey + Math.sin(ang) * 10);
          ctx.lineTo(ex + Math.cos(ang + 2.5) * 8, ey + Math.sin(ang + 2.5) * 8);
          ctx.lineTo(ex + Math.cos(ang - 2.5) * 8, ey + Math.sin(ang - 2.5) * 8);
          ctx.closePath(); ctx.fill();
        } else {
          ctx.fillRect(ex - 5, ey - 5, 10, 10);
        }
      }
      const centerActive = hl === 'free' || hl === 'suni';
      ctx.fillStyle = centerActive ? '#ffffff' : 'rgba(255,255,255,0.35)';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(sc.x - 7, sc.y - 7, 14, 14); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
