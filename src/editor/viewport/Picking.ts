import type { Engine } from '../../core/Engine';
import type { Entity } from '../../core/ecs/Entity';
import { Transform } from '../../core/ecs/Transform';
import { Vec3 } from '../../core/math';
import type { Atlas } from '../../assets/types';
import { BoxCollider2D, CircleCollider2D, PolygonCollider2D } from '../../physics/components2d';
import { BoxCollider3D, SphereCollider3D } from '../../physics/physics3d';
import { Camera2D, Camera3D, Light, Light2D, MeshRenderer, ParticleEmitter, Shape, Sprite, Text, Tilemap } from '../../render/components';
import type { SceneEditor } from '../project/SceneEditor';

/** Axis-aligned rectangle in an entity's local space. */
export interface LocalRect { x: number; y: number; w: number; h: number; kind: 'drawable' | 'icon' | 'collider' }
/** Axis-aligned box in local space. */
export interface LocalBox { min: Vec3; max: Vec3 }

/** Size of icon boxes for entities without a visual (cameras, lights, empties). */
const ICON = 0.6;

/**
 * Editor hit-testing. 2D uses local-space rectangles derived from the
 * drawable/collider components; 3D casts a ray against local AABBs of
 * MeshRenderers (and icon boxes for lights/cameras).
 */
export class Picker {
  constructor(readonly engine: Engine, readonly scene: SceneEditor) {}

  private imageSize(texture: string, frame: string): { w: number; h: number } | null {
    const asset = this.engine.assets.get<HTMLImageElement | HTMLCanvasElement | Atlas>(texture);
    if (!asset) return null;
    if (asset instanceof HTMLImageElement || asset instanceof HTMLCanvasElement) return { w: asset.width, h: asset.height };
    const f = (asset as Atlas).frames?.[frame] ?? Object.values((asset as Atlas).frames ?? {})[0];
    return f ? { w: f.w, h: f.h } : null;
  }

  /** Local-space bounds of the entity's visual (2D). */
  localRect(e: Entity): LocalRect | null {
    const w = this.engine.world;
    const ppu = this.engine.renderer?.pixelsPerUnit ?? 32;
    const sprite = w.getComponent(e, Sprite);
    if (sprite) {
      let sw = sprite.width, sh = sprite.height;
      if (!sw || !sh) {
        const img = this.imageSize(sprite.texture, sprite.frame);
        sw = sw || (img ? img.w / ppu : 1);
        sh = sh || (img ? img.h / ppu : 1);
      }
      return { x: -sw * sprite.pivot.x, y: -sh * sprite.pivot.y, w: sw, h: sh, kind: 'drawable' };
    }
    const shape = w.getComponent(e, Shape);
    if (shape) {
      if (shape.kind === 'circle') return { x: -shape.radius, y: -shape.radius, w: shape.radius * 2, h: shape.radius * 2, kind: 'drawable' };
      if (shape.kind === 'polygon' || shape.kind === 'line') return pointsBounds(shape.points) ?? { x: -0.5, y: -0.5, w: 1, h: 1, kind: 'drawable' };
      return { x: -shape.width / 2, y: -shape.height / 2, w: shape.width, h: shape.height, kind: 'drawable' };
    }
    const text = w.getComponent(e, Text);
    if (text && !text.screenSpace) {
      const tw = Math.max(0.3, text.text.length * text.size * 0.55);
      const th = text.size * 1.2;
      const x = text.align === 'left' ? 0 : text.align === 'right' ? -tw : -tw / 2;
      const y = text.baseline === 'top' ? -th : text.baseline === 'bottom' ? 0 : -th / 2;
      return { x, y, w: tw, h: th, kind: 'drawable' };
    }
    const tm = w.getComponent(e, Tilemap);
    if (tm) return { x: 0, y: -tm.height * tm.tileSize, w: tm.width * tm.tileSize, h: tm.height * tm.tileSize, kind: 'drawable' };
    const box = w.getComponent(e, BoxCollider2D);
    if (box) return { x: box.offset.x - box.width / 2, y: box.offset.y - box.height / 2, w: box.width, h: box.height, kind: 'collider' };
    const circle = w.getComponent(e, CircleCollider2D);
    if (circle) return { x: circle.offset.x - circle.radius, y: circle.offset.y - circle.radius, w: circle.radius * 2, h: circle.radius * 2, kind: 'collider' };
    const poly = w.getComponent(e, PolygonCollider2D);
    if (poly) { const b = pointsBounds(poly.points); if (b) return { ...b, x: b.x + poly.offset.x, y: b.y + poly.offset.y, kind: 'collider' }; }
    if (w.hasComponent(e, ParticleEmitter) || w.hasComponent(e, Camera2D) || w.hasComponent(e, Light2D)) return { x: -ICON / 2, y: -ICON / 2, w: ICON, h: ICON, kind: 'icon' };
    if (w.hasComponent(e, Transform)) return { x: -ICON / 3, y: -ICON / 3, w: ICON / 1.5, h: ICON / 1.5, kind: 'icon' };
    return null;
  }

  /** World-space corners of the local rect (4 points). */
  worldCorners(e: Entity, r: LocalRect): Vec3[] {
    const t = this.engine.world.getComponent(e, Transform);
    if (!t) return [];
    const pts = [new Vec3(r.x, r.y, 0), new Vec3(r.x + r.w, r.y, 0), new Vec3(r.x + r.w, r.y + r.h, 0), new Vec3(r.x, r.y + r.h, 0)];
    return pts.map((p) => t.localToWorld(p, p));
  }

  /** World-space AABB of an entity (2D or 3D). */
  worldBounds(e: Entity): { min: Vec3; max: Vec3 } | null {
    const t = this.engine.world.getComponent(e, Transform);
    if (!t) return null;
    const is3d = this.engine.renderer?.kind === '3d';
    let corners: Vec3[];
    if (is3d) {
      const b = this.localBox(e);
      if (!b) return null;
      corners = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(t.localToWorld(new Vec3(x, y, z)));
    } else {
      const r = this.localRect(e);
      if (!r) return null;
      corners = this.worldCorners(e, r);
    }
    const min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity);
    for (const c of corners) {
      min.x = Math.min(min.x, c.x); min.y = Math.min(min.y, c.y); min.z = Math.min(min.z, c.z);
      max.x = Math.max(max.x, c.x); max.y = Math.max(max.y, c.y); max.z = Math.max(max.z, c.z);
    }
    return { min, max };
  }

  /** Combined bounds of several entities. */
  boundsOf(entities: readonly Entity[]): { min: Vec3; max: Vec3 } | null {
    let out: { min: Vec3; max: Vec3 } | null = null;
    for (const e of entities) {
      const b = this.worldBounds(e) ?? this.pointBounds(e);
      if (!b) continue;
      if (!out) out = { min: b.min.clone(), max: b.max.clone() };
      else {
        out.min.set(Math.min(out.min.x, b.min.x), Math.min(out.min.y, b.min.y), Math.min(out.min.z, b.min.z));
        out.max.set(Math.max(out.max.x, b.max.x), Math.max(out.max.y, b.max.y), Math.max(out.max.z, b.max.z));
      }
    }
    return out;
  }

  private pointBounds(e: Entity): { min: Vec3; max: Vec3 } | null {
    const t = this.engine.world.getComponent(e, Transform);
    if (!t) return null;
    const p = t.getWorldPosition();
    return { min: p.clone().sub(new Vec3(0.5, 0.5, 0.5)), max: p.clone().add(new Vec3(0.5, 0.5, 0.5)) };
  }

  /** Entities under a world point (2D), nearest/smallest first. */
  pick2D(wx: number, wy: number): Entity[] {
    const hits: { e: Entity; area: number; pri: number }[] = [];
    const p = new Vec3();
    for (const e of this.scene.all()) {
      if (this.scene.isHidden(e)) continue;
      const r = this.localRect(e);
      const t = this.engine.world.getComponent(e, Transform);
      if (!r || !t) continue;
      t.worldToLocal(p.set(wx, wy, 0), p);
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        const ws = t.getWorldScale();
        hits.push({ e, area: r.w * r.h * Math.abs(ws.x * ws.y), pri: r.kind === 'icon' ? 0 : r.kind === 'drawable' ? 2 : 1 });
      }
    }
    hits.sort((a, b) => b.pri - a.pri || a.area - b.area);
    return hits.map((h) => h.e);
  }

  /** Entities whose world position falls inside a screen rectangle. */
  boxSelect(sx0: number, sy0: number, sx1: number, sy1: number): Entity[] {
    const minX = Math.min(sx0, sx1), maxX = Math.max(sx0, sx1), minY = Math.min(sy0, sy1), maxY = Math.max(sy0, sy1);
    const out: Entity[] = [];
    const sp = this.engine.worldToScreen.bind(this.engine);
    for (const e of this.scene.all()) {
      if (this.scene.isHidden(e)) continue;
      const t = this.engine.world.getComponent(e, Transform);
      if (!t) continue;
      const s = sp(t.getWorldPosition());
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) out.push(e);
    }
    return out;
  }

  /** Local AABB for 3D picking. */
  localBox(e: Entity): LocalBox | null {
    const w = this.engine.world;
    const mr = w.getComponent(e, MeshRenderer);
    if (mr) {
      if (mr.mesh === 'plane') return { min: new Vec3(-0.5, -0.03, -0.5), max: new Vec3(0.5, 0.03, 0.5) };
      return { min: new Vec3(-0.5, -0.5, -0.5), max: new Vec3(0.5, 0.5, 0.5) };
    }
    const box = w.getComponent(e, BoxCollider3D);
    if (box) return { min: new Vec3(box.offset.x - box.size.x / 2, box.offset.y - box.size.y / 2, box.offset.z - box.size.z / 2), max: new Vec3(box.offset.x + box.size.x / 2, box.offset.y + box.size.y / 2, box.offset.z + box.size.z / 2) };
    const sphere = w.getComponent(e, SphereCollider3D);
    if (sphere) { const r = sphere.radius; return { min: new Vec3(sphere.offset.x - r, sphere.offset.y - r, sphere.offset.z - r), max: new Vec3(sphere.offset.x + r, sphere.offset.y + r, sphere.offset.z + r) }; }
    if (w.hasComponent(e, Light) || w.hasComponent(e, Camera3D)) return { min: new Vec3(-0.4, -0.4, -0.4), max: new Vec3(0.4, 0.4, 0.4) };
    if (w.hasComponent(e, Transform)) return { min: new Vec3(-0.2, -0.2, -0.2), max: new Vec3(0.2, 0.2, 0.2) };
    return null;
  }

  /** Ray pick (3D): entities hit along the ray, nearest first. */
  pick3D(origin: Vec3, dir: Vec3): Entity[] {
    const hits: { e: Entity; t: number }[] = [];
    for (const e of this.scene.all()) {
      if (this.scene.isHidden(e)) continue;
      const box = this.localBox(e);
      const tr = this.engine.world.getComponent(e, Transform);
      if (!box || !tr) continue;
      const m = tr.worldMatrix.clone().invert();
      const lo = m.transformPoint(origin, new Vec3());
      const ld = m.transformDirection(dir, new Vec3());
      const t = rayBox(lo, ld, box.min, box.max);
      if (t !== null) {
        // Distance in world units for sorting: transform hit point back.
        const hit = lo.clone().addScaled(ld, t);
        const wh = tr.worldMatrix.transformPoint(hit, new Vec3());
        hits.push({ e, t: wh.distanceTo(origin) });
      }
    }
    hits.sort((a, b) => a.t - b.t);
    return hits.map((h) => h.e);
  }
}

function pointsBounds(points: number[]): LocalRect | null {
  if (points.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  return { x: minX, y: minY, w: Math.max(0.05, maxX - minX), h: Math.max(0.05, maxY - minY), kind: 'drawable' };
}

/** Slab test; returns the entry distance along the ray or null. */
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let tmin = -Infinity, tmax = Infinity;
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (const a of axes) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    let t1 = (min[a] - o[a]) / d[a];
    let t2 = (max[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}
