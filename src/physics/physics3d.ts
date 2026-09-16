import { EventEmitter } from '../core/EventEmitter';
import { Vec3, type Vec3Like } from '../core/math';
import { Component } from '../core/ecs/Component';
import type { Entity } from '../core/ecs/Entity';
import { registerComponent } from '../core/ecs/Registry';
import { SystemBase } from '../core/ecs/System';
import { Transform } from '../core/ecs/Transform';
import type { World } from '../core/ecs/World';
import type { BodyType } from './components2d';

/** Simple 3D rigid body: linear motion only (no rotation dynamics). */
export class RigidBody3D extends Component {
  static override readonly type = 'RigidBody3D';
  bodyType: BodyType = 'dynamic';
  mass = 1;
  restitution = 0.1;
  friction = 0.5;
  gravityScale = 1;
  velocity = new Vec3();
  linearDamping = 0;
  layer = 0;
  collisionMask = 0xffffffff;
  /** True when resting on a surface whose normal points up. */
  grounded = false;
  /** @internal */
  _invMass = 1;
}
registerComponent(RigidBody3D, {
  category: 'Physics 3D',
  description: 'Linear rigid body for the simple 3D physics world.',
  icon: 'atom',
  fields: { bodyType: { type: 'enum', options: ['dynamic', 'kinematic', 'static'] }, grounded: { type: 'boolean', readonly: true, transient: true } },
});

export class BoxCollider3D extends Component {
  static override readonly type = 'BoxCollider3D';
  size = new Vec3(1, 1, 1);
  offset = new Vec3();
  isTrigger = false;
}
registerComponent(BoxCollider3D, { category: 'Physics 3D', description: 'Axis-aligned box (rotation ignored).', icon: 'box', requires: ['RigidBody3D'] });

export class SphereCollider3D extends Component {
  static override readonly type = 'SphereCollider3D';
  radius = 0.5;
  offset = new Vec3();
  isTrigger = false;
}
registerComponent(SphereCollider3D, { category: 'Physics 3D', description: 'Sphere collider.', icon: 'circle', requires: ['RigidBody3D'] });

export interface Collision3DEvent {
  a: Entity;
  b: Entity;
  normal: Vec3;
  penetration: number;
}

export interface Physics3DEvents extends Record<string, unknown> {
  collisionEnter: Collision3DEvent;
  collisionExit: Collision3DEvent;
  triggerEnter: Collision3DEvent;
  triggerExit: Collision3DEvent;
}

interface Proxy3 {
  entity: Entity;
  body: RigidBody3D;
  isTrigger: boolean;
  kind: 'box' | 'sphere';
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number; // half extents (box) or radius in hx (sphere)
}

interface Hit { nx: number; ny: number; nz: number; pen: number }

const _hit: Hit = { nx: 0, ny: 1, nz: 0, pen: 0 };

function collide(a: Proxy3, b: Proxy3, h: Hit): boolean {
  if (a.kind === 'sphere' && b.kind === 'sphere') {
    const dx = b.cx - a.cx, dy = b.cy - a.cy, dz = b.cz - a.cz;
    const r = a.hx + b.hx;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2) || 1e-9;
    h.nx = dx / d; h.ny = dy / d; h.nz = dz / d; h.pen = r - d;
    return true;
  }
  if (a.kind === 'box' && b.kind === 'box') {
    const dx = b.cx - a.cx, dy = b.cy - a.cy, dz = b.cz - a.cz;
    const ox = a.hx + b.hx - Math.abs(dx);
    if (ox <= 0) return false;
    const oy = a.hy + b.hy - Math.abs(dy);
    if (oy <= 0) return false;
    const oz = a.hz + b.hz - Math.abs(dz);
    if (oz <= 0) return false;
    if (ox < oy && ox < oz) { h.nx = Math.sign(dx) || 1; h.ny = 0; h.nz = 0; h.pen = ox; }
    else if (oy < oz) { h.nx = 0; h.ny = Math.sign(dy) || 1; h.nz = 0; h.pen = oy; }
    else { h.nx = 0; h.ny = 0; h.nz = Math.sign(dz) || 1; h.pen = oz; }
    return true;
  }
  // Sphere vs box: make `s` the sphere.
  const flip = a.kind === 'box';
  const s = flip ? b : a;
  const bx = flip ? a : b;
  const cx = Math.max(bx.cx - bx.hx, Math.min(s.cx, bx.cx + bx.hx));
  const cy = Math.max(bx.cy - bx.hy, Math.min(s.cy, bx.cy + bx.hy));
  const cz = Math.max(bx.cz - bx.hz, Math.min(s.cz, bx.cz + bx.hz));
  let dx = cx - s.cx, dy = cy - s.cy, dz = cz - s.cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= s.hx * s.hx) return false;
  let d = Math.sqrt(d2);
  if (d < 1e-9) {
    // Centre inside the box: push out along the smallest axis.
    const px = bx.hx - Math.abs(s.cx - bx.cx), py = bx.hy - Math.abs(s.cy - bx.cy), pz = bx.hz - Math.abs(s.cz - bx.cz);
    if (px < py && px < pz) { dx = Math.sign(s.cx - bx.cx) || 1; dy = 0; dz = 0; d = -px; }
    else if (py < pz) { dx = 0; dy = Math.sign(s.cy - bx.cy) || 1; dz = 0; d = -py; }
    else { dx = 0; dy = 0; dz = Math.sign(s.cz - bx.cz) || 1; d = -pz; }
    // Normal from sphere to box is opposite of the outward push.
    dx = -dx; dy = -dy; dz = -dz;
    h.pen = s.hx - d;
    h.nx = dx; h.ny = dy; h.nz = dz;
  } else {
    h.nx = dx / d; h.ny = dy / d; h.nz = dz / d; h.pen = s.hx - d;
  }
  if (flip) { h.nx = -h.nx; h.ny = -h.ny; h.nz = -h.nz; }
  return true;
}

/**
 * Minimal deterministic 3D physics: gravity, AABB and sphere colliders,
 * impulse response without rotation, triggers and enter/exit events.
 * Suitable for arcade-style 3D games; not a full rigid body solver.
 */
export class Physics3DWorld {
  readonly gravity = new Vec3(0, -20, 0);
  iterations = 4;
  positionCorrection = 0.6;
  slop = 0.005;
  readonly events = new EventEmitter<Physics3DEvents>();

  private proxies: Proxy3[] = [];
  private prev = new Map<number, Collision3DEvent>();
  private prevTriggers = new Map<number, Collision3DEvent>();

  private buildProxies(world: World): { rb: RigidBody3D; t: Transform }[] {
    const bodies: { rb: RigidBody3D; t: Transform }[] = [];
    this.proxies.length = 0;
    for (const rb of world.componentsOfType(RigidBody3D)) {
      const t = world.getComponent(rb.entity, Transform);
      if (!t) continue;
      bodies.push({ rb, t });
    }
    bodies.sort((a, b) => a.rb.entity - b.rb.entity);
    for (const { rb, t } of bodies) {
      rb._invMass = rb.bodyType === 'dynamic' && rb.mass > 0 ? 1 / rb.mass : 0;
      const box = world.getComponent(rb.entity, BoxCollider3D);
      const sph = world.getComponent(rb.entity, SphereCollider3D);
      const p = t.position, s = t.scale;
      if (box) {
        this.proxies.push({
          entity: rb.entity, body: rb, isTrigger: box.isTrigger, kind: 'box',
          cx: p.x + box.offset.x * s.x, cy: p.y + box.offset.y * s.y, cz: p.z + box.offset.z * s.z,
          hx: (box.size.x * Math.abs(s.x)) / 2, hy: (box.size.y * Math.abs(s.y)) / 2, hz: (box.size.z * Math.abs(s.z)) / 2,
        });
      }
      if (sph) {
        const r = sph.radius * Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        this.proxies.push({
          entity: rb.entity, body: rb, isTrigger: sph.isTrigger, kind: 'sphere',
          cx: p.x + sph.offset.x * s.x, cy: p.y + sph.offset.y * s.y, cz: p.z + sph.offset.z * s.z, hx: r, hy: r, hz: r,
        });
      }
    }
    return bodies;
  }

  step(world: World, dt: number): void {
    const bodies = this.buildProxies(world);
    for (const { rb } of bodies) {
      rb.grounded = false;
      if (rb.bodyType !== 'dynamic') { if (rb.bodyType === 'static') rb.velocity.set(0, 0, 0); continue; }
      rb.velocity.addScaled(this.gravity, rb.gravityScale * dt);
      if (rb.linearDamping > 0) rb.velocity.scale(1 / (1 + rb.linearDamping * dt));
    }
    const cur = new Map<number, Collision3DEvent>();
    const curTriggers = new Map<number, Collision3DEvent>();
    const P = this.proxies;
    for (let it = 0; it < this.iterations; it++) {
      for (let i = 0; i < P.length; i++) {
        for (let j = i + 1; j < P.length; j++) {
          const a = P[i], b = P[j];
          if (a.entity === b.entity) continue;
          const A = a.body, B = b.body;
          if (A.bodyType !== 'dynamic' && B.bodyType !== 'dynamic') continue;
          if (!(A.collisionMask & (1 << B.layer)) || !(B.collisionMask & (1 << A.layer))) continue;
          if (!collide(a, b, _hit)) continue;
          const key = a.entity < b.entity ? a.entity * 4294967296 + b.entity : b.entity * 4294967296 + a.entity;
          const trigger = a.isTrigger || b.isTrigger;
          const target = trigger ? curTriggers : cur;
          if (it === 0 && !target.has(key)) {
            target.set(key, { a: a.entity, b: b.entity, normal: new Vec3(_hit.nx, _hit.ny, _hit.nz), penetration: _hit.pen });
          }
          if (trigger) continue;
          if (_hit.ny < -0.5) A.grounded = true;
          if (_hit.ny > 0.5) B.grounded = true;
          const sum = A._invMass + B._invMass;
          if (sum === 0) continue;
          const rvx = B.velocity.x - A.velocity.x, rvy = B.velocity.y - A.velocity.y, rvz = B.velocity.z - A.velocity.z;
          const vn = rvx * _hit.nx + rvy * _hit.ny + rvz * _hit.nz;
          if (vn < 0) {
            const e = Math.abs(vn) < 2 ? 0 : Math.max(A.restitution, B.restitution);
            const jn = (-(1 + e) * vn) / sum;
            A.velocity.x -= _hit.nx * jn * A._invMass; A.velocity.y -= _hit.ny * jn * A._invMass; A.velocity.z -= _hit.nz * jn * A._invMass;
            B.velocity.x += _hit.nx * jn * B._invMass; B.velocity.y += _hit.ny * jn * B._invMass; B.velocity.z += _hit.nz * jn * B._invMass;
            // Friction.
            const tvx = rvx - _hit.nx * vn, tvy = rvy - _hit.ny * vn, tvz = rvz - _hit.nz * vn;
            const tl = Math.hypot(tvx, tvy, tvz);
            if (tl > 1e-6) {
              const mu = Math.sqrt(A.friction * B.friction);
              const jt = Math.min(tl / sum, jn * mu);
              const fx = (tvx / tl) * jt, fy = (tvy / tl) * jt, fz = (tvz / tl) * jt;
              A.velocity.x += fx * A._invMass; A.velocity.y += fy * A._invMass; A.velocity.z += fz * A._invMass;
              B.velocity.x -= fx * B._invMass; B.velocity.y -= fy * B._invMass; B.velocity.z -= fz * B._invMass;
            }
          }
          // Positional correction applied directly to proxies and transforms.
          const corr = (Math.max(_hit.pen - this.slop, 0) / sum) * this.positionCorrection;
          const ta = world.getComponent(A.entity, Transform)!;
          const tb = world.getComponent(B.entity, Transform)!;
          if (A._invMass > 0) {
            const k = corr * A._invMass;
            ta.position.x -= _hit.nx * k; ta.position.y -= _hit.ny * k; ta.position.z -= _hit.nz * k;
            a.cx -= _hit.nx * k; a.cy -= _hit.ny * k; a.cz -= _hit.nz * k;
          }
          if (B._invMass > 0) {
            const k = corr * B._invMass;
            tb.position.x += _hit.nx * k; tb.position.y += _hit.ny * k; tb.position.z += _hit.nz * k;
            b.cx += _hit.nx * k; b.cy += _hit.ny * k; b.cz += _hit.nz * k;
          }
        }
      }
    }
    for (const { rb, t } of bodies) {
      if (rb.bodyType === 'static') continue;
      t.position.addScaled(rb.velocity, dt);
      t.markDirty();
    }
    for (const [k, ev] of cur) if (!this.prev.has(k)) this.events.emit('collisionEnter', ev);
    for (const [k, ev] of this.prev) if (!cur.has(k)) this.events.emit('collisionExit', ev);
    for (const [k, ev] of curTriggers) if (!this.prevTriggers.has(k)) this.events.emit('triggerEnter', ev);
    for (const [k, ev] of this.prevTriggers) if (!curTriggers.has(k)) this.events.emit('triggerExit', ev);
    this.prev = cur;
    this.prevTriggers = curTriggers;
  }

  reset(): void {
    this.prev.clear();
    this.prevTriggers.clear();
    this.proxies.length = 0;
  }

  /** Ray vs all colliders (boxes and spheres). Returns the closest hit. */
  raycast(origin: Vec3Like, direction: Vec3Like, maxDistance = Infinity, mask = 0xffffffff): { entity: Entity; point: Vec3; normal: Vec3; distance: number } | null {
    const dl = Math.hypot(direction.x, direction.y, direction.z) || 1;
    const dx = direction.x / dl, dy = direction.y / dl, dz = direction.z / dl;
    let best: { entity: Entity; point: Vec3; normal: Vec3; distance: number } | null = null;
    for (const p of this.proxies) {
      if (p.isTrigger || !(mask & (1 << p.body.layer))) continue;
      let t = -1;
      const n = new Vec3();
      if (p.kind === 'sphere') {
        const fx = origin.x - p.cx, fy = origin.y - p.cy, fz = origin.z - p.cz;
        const b = 2 * (fx * dx + fy * dy + fz * dz);
        const c = fx * fx + fy * fy + fz * fz - p.hx * p.hx;
        const disc = b * b - 4 * c;
        if (disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / 2;
        if (t < 0) continue;
        n.set(origin.x + dx * t - p.cx, origin.y + dy * t - p.cy, origin.z + dz * t - p.cz).normalize();
      } else {
        let tmin = -Infinity, tmax = Infinity;
        let axis = -1, sign = 1;
        const o = [origin.x, origin.y, origin.z], d = [dx, dy, dz], c = [p.cx, p.cy, p.cz], h = [p.hx, p.hy, p.hz];
        let miss = false;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(d[i]) < 1e-12) { if (Math.abs(o[i] - c[i]) > h[i]) { miss = true; break; } continue; }
          let t1 = (c[i] - h[i] - o[i]) / d[i], t2 = (c[i] + h[i] - o[i]) / d[i];
          let s = -1;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { miss = true; break; }
        }
        if (miss || tmin < 0 || axis < 0) continue;
        t = tmin;
        n.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
      }
      if (t > maxDistance || (best && t >= best.distance)) continue;
      best = { entity: p.entity, distance: t, point: new Vec3(origin.x + dx * t, origin.y + dy * t, origin.z + dz * t), normal: n };
    }
    return best;
  }
}

/**
 * Kinematic character helper for 3D: `move()` sets a desired horizontal
 * velocity, `jump()` launches when grounded; the body slides along surfaces
 * via the physics response.
 */
export class CharacterController3D extends Component {
  static override readonly type = 'CharacterController3D';
  moveSpeed = 6;
  acceleration = 40;
  jumpSpeed = 8;
  coyoteTime = 0.1;
  grounded = false;
  /** @internal */
  _mx = 0;
  _mz = 0;
  _jump = false;
  _coyote = 0;

  move(x: number, z: number): void {
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    this._mx = x;
    this._mz = z;
  }

  jump(): void {
    this._jump = true;
  }

  apply(rb: RigidBody3D, dt: number): void {
    this.grounded = rb.grounded;
    this._coyote = this.grounded ? this.coyoteTime : Math.max(0, this._coyote - dt);
    const tx = this._mx * this.moveSpeed, tz = this._mz * this.moveSpeed;
    const k = Math.min(1, this.acceleration * dt / this.moveSpeed);
    rb.velocity.x += (tx - rb.velocity.x) * k;
    rb.velocity.z += (tz - rb.velocity.z) * k;
    if (this._jump && this._coyote > 0) {
      rb.velocity.y = this.jumpSpeed;
      this._coyote = 0;
    }
    this._jump = false;
  }
}
registerComponent(CharacterController3D, {
  category: 'Physics 3D',
  description: 'Move-and-slide character helper.',
  icon: 'person',
  requires: ['RigidBody3D'],
  fields: { grounded: { type: 'boolean', readonly: true, transient: true } },
});

/** Runs the 3D physics world each fixed step. */
export class Physics3DSystem extends SystemBase {
  readonly name = 'Physics3DSystem';
  readonly phase = 'fixedUpdate' as const;
  override readonly priority = 100;

  constructor(readonly physics: Physics3DWorld) {
    super();
  }

  override update(world: World, dt: number): void {
    world.each(CharacterController3D, RigidBody3D, (_e, cc, rb) => cc.apply(rb, dt));
    this.physics.step(world, dt);
  }
}
