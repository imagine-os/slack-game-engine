import { EventEmitter } from '../core/EventEmitter';
import { Vec2, type Vec2Like } from '../core/math';
import type { Entity } from '../core/ecs/Entity';
import { Transform } from '../core/ecs/Transform';
import type { World } from '../core/ecs/World';
import { Tilemap } from '../render/components';
import {
  type Manifold, type PolygonShape, type Shape2D, boxPoints, collideShapes, createManifold, raycastShape, shapeAABB, shapeContains, transformPolygon,
} from './collision2d';
import { BoxCollider2D, CircleCollider2D, type Collider2D, PolygonCollider2D, RigidBody2D, TilemapCollider2D } from './components2d';
import { SpatialHash } from './SpatialHash';

/** Payload for collision and trigger events. `normal` points from `a` to `b`. */
export interface CollisionEvent {
  a: Entity;
  b: Entity;
  normal: Vec2;
  /** First contact point in world space. */
  point: Vec2;
  penetration: number;
  /** Approach speed along the normal at the time of the first contact. */
  impulse: number;
}

export interface PhysicsEvents extends Record<string, unknown> {
  collisionEnter: CollisionEvent;
  collisionStay: CollisionEvent;
  collisionExit: CollisionEvent;
  triggerEnter: CollisionEvent;
  triggerStay: CollisionEvent;
  triggerExit: CollisionEvent;
}

export interface RaycastHit2D {
  entity: Entity;
  point: Vec2;
  normal: Vec2;
  distance: number;
}

interface Proxy {
  id: number;
  entity: Entity;
  body: RigidBody2D;
  collider: Collider2D | null;
  shape: Shape2D;
  isTrigger: boolean;
  restitution: number;
  friction: number;
  layer: number;
  aabb: Float64Array;
}

interface Contact {
  a: Proxy;
  b: Proxy;
  m: Manifold;
  e: number;
  mu: number;
  key: number;
  trigger: boolean;
}

/** Static body shared by tilemap tile proxies. */
const STATIC_BODY = new RigidBody2D();
STATIC_BODY.bodyType = 'static';
STATIC_BODY._invMass = 0;
STATIC_BODY._invInertia = 0;


/**
 * Deterministic fixed-step 2D rigid body simulation: semi-implicit Euler,
 * spatial-hash broadphase, SAT narrowphase, sequential impulses with
 * friction/restitution, Baumgarte positional correction, layers with a
 * collision matrix, triggers, raycasts and overlap queries.
 *
 * Given identical component state and the same sequence of `step` calls the
 * results are bit-identical, which is what lockstep networking relies on.
 */
export class Physics2DWorld {
  readonly gravity = new Vec2(0, -20);
  /** Impulse solver iterations. */
  iterations = 8;
  /** Fraction of penetration corrected per step. */
  positionCorrection = 0.4;
  /** Penetration tolerated before correction. */
  slop = 0.01;
  /** Speed below which restitution is ignored (resting contact). */
  restingSpeed = 1;
  /** Broadphase cell size in world units. */
  get cellSize(): number { return this.hash.cellSize; }
  set cellSize(v: number) { this.hash.cellSize = v; }

  readonly events = new EventEmitter<PhysicsEvents>();
  /** Number of contacts solved in the last step. */
  contactCount = 0;

  private matrix = new Uint32Array(32).fill(0xffffffff);
  private hash = new SpatialHash(2);
  private proxies: Proxy[] = [];
  private pairBuffer: number[] = [];
  private contacts: Contact[] = [];
  private prevPairs = new Map<number, CollisionEvent>();
  private prevTriggers = new Map<number, CollisionEvent>();
  private queryBuffer: number[] = [];
  private polyCache = new Map<Collider2D, PolygonShape>();
  private tileProxies: Proxy[] = [];

  // --------------------------------------------------------------- layers

  /** Enable/disable collisions between two layers (symmetric). */
  setLayerCollision(a: number, b: number, enabled: boolean): void {
    if (enabled) { this.matrix[a] |= 1 << b; this.matrix[b] |= 1 << a; }
    else { this.matrix[a] &= ~(1 << b); this.matrix[b] &= ~(1 << a); }
  }

  layersCollide(a: number, b: number): boolean {
    return (this.matrix[a] & (1 << b)) !== 0;
  }

  /** Load a matrix from an array of 32 bitmasks (project settings). */
  setCollisionMatrix(masks: ArrayLike<number>): void {
    for (let i = 0; i < 32; i++) this.matrix[i] = masks[i] ?? 0xffffffff;
  }

  getCollisionMatrix(): number[] {
    return Array.from(this.matrix);
  }

  // ----------------------------------------------------------------- step

  /** Advance the simulation by `dt` seconds. */
  step(world: World, dt: number): void {
    const bodies = this.collectBodies(world);
    // 1. Integrate forces into velocities.
    for (let i = 0; i < bodies.length; i++) {
      const rb = bodies[i].rb;
      const t = bodies[i].t;
      rb._px = t.position.x;
      rb._py = t.position.y;
      rb._angle = t.angle;
      rb.contacts.length = 0;
      if (rb.bodyType !== 'dynamic') {
        rb._invMass = 0;
        rb._invInertia = 0;
        if (rb.bodyType === 'static') { rb.velocity.set(0, 0); rb.angularVelocity = 0; }
        rb.force.set(0, 0);
        rb.torque = 0;
        continue;
      }
      const g = this.gravity;
      rb.velocity.x += (g.x * rb.gravityScale + rb.force.x * rb._invMass) * dt;
      rb.velocity.y += (g.y * rb.gravityScale + rb.force.y * rb._invMass) * dt;
      rb.angularVelocity += rb.torque * rb._invInertia * dt;
      if (rb.linearDamping > 0) rb.velocity.scale(1 / (1 + rb.linearDamping * dt));
      if (rb.angularDamping > 0) rb.angularVelocity /= 1 + rb.angularDamping * dt;
      if (rb.fixedRotation) rb.angularVelocity = 0;
      rb.force.set(0, 0);
      rb.torque = 0;
    }
    // 2. Shapes, mass properties and broadphase.
    this.buildProxies(world, bodies);
    this.hash.clear();
    for (const p of this.proxies) this.hash.insert(p.id, p.aabb[0], p.aabb[1], p.aabb[2], p.aabb[3]);
    const pairs = this.hash.pairs(this.pairBuffer);
    // 3. Narrowphase.
    this.contacts.length = 0;
    for (let i = 0; i < pairs.length; i += 2) this.tryContact(this.proxies[pairs[i]], this.proxies[pairs[i + 1]]);
    this.collideTilemaps(world);
    this.contactCount = this.contacts.length;
    // 4. Solve velocities.
    for (const c of this.contacts) if (!c.trigger) this.prepare(c, dt);
    for (let it = 0; it < this.iterations; it++) for (const c of this.contacts) if (!c.trigger) this.applyImpulse(c);
    // 5. Integrate positions.
    for (let i = 0; i < bodies.length; i++) {
      const rb = bodies[i].rb;
      if (rb.bodyType === 'static') continue;
      let vx = rb.velocity.x, vy = rb.velocity.y;
      if (rb.bullet) {
        const maxStep = this.minExtent(rb.entity, world) * 0.9;
        const len = Math.hypot(vx, vy) * dt;
        if (len > maxStep) { const k = maxStep / len; vx *= k; vy *= k; }
      }
      rb._px += vx * dt;
      rb._py += vy * dt;
      rb._angle += rb.angularVelocity * dt;
    }
    // 6. Positional correction.
    for (const c of this.contacts) if (!c.trigger) this.correctPosition(c);
    // 7. Write back.
    for (let i = 0; i < bodies.length; i++) {
      const rb = bodies[i].rb;
      const t = bodies[i].t;
      if (rb.bodyType === 'static') continue;
      t.position.x = rb._px;
      t.position.y = rb._py;
      if (!rb.fixedRotation) t.angle = rb._angle;
      t.markDirty();
    }
    this.emitEvents();
  }

  private collectBodies(world: World): { rb: RigidBody2D; t: Transform }[] {
    const list: { rb: RigidBody2D; t: Transform }[] = [];
    for (const rb of world.componentsOfType(RigidBody2D)) {
      const t = world.getComponent(rb.entity, Transform);
      if (t) list.push({ rb, t });
    }
    list.sort((a, b) => a.rb.entity - b.rb.entity);
    return list;
  }

  private buildProxies(world: World, bodies: { rb: RigidBody2D; t: Transform }[]): void {
    const proxies = this.proxies;
    proxies.length = 0;
    for (const { rb, t } of bodies) {
      const sx = t.scale.x, sy = t.scale.y;
      let inertia = 0;
      const colliders = this.collidersOf(world, rb.entity);
      for (const col of colliders) {
        let shape: Shape2D;
        let localInertia = 0;
        if (col instanceof CircleCollider2D) {
          const r = col.radius * Math.max(Math.abs(sx), Math.abs(sy));
          const c = Math.cos(rb._angle), s = Math.sin(rb._angle);
          const ox = col.offset.x * sx, oy = col.offset.y * sy;
          shape = { kind: 'circle', x: rb._px + ox * c - oy * s, y: rb._py + ox * s + oy * c, r };
          localInertia = 0.5 * rb.mass * r * r + rb.mass * (ox * ox + oy * oy);
        } else {
          const pts = col instanceof BoxCollider2D ? boxPoints(col.width, col.height) : (col as PolygonCollider2D).points;
          const poly = transformPolygon(pts, rb._px, rb._py, rb._angle, sx, sy, col.offset.x, col.offset.y, this.polyCache.get(col));
          this.polyCache.set(col, poly);
          shape = poly;
          localInertia = polygonInertia(pts, rb.mass, sx, sy) + rb.mass * (col.offset.x * col.offset.x * sx * sx + col.offset.y * col.offset.y * sy * sy);
        }
        inertia += localInertia;
        const p: Proxy = {
          id: proxies.length, entity: rb.entity, body: rb, collider: col, shape,
          isTrigger: col.isTrigger,
          restitution: col.restitution >= 0 ? col.restitution : rb.restitution,
          friction: col.friction >= 0 ? col.friction : rb.friction,
          layer: rb.layer,
          aabb: new Float64Array(4),
        };
        shapeAABB(shape, p.aabb);
        proxies.push(p);
      }
      if (rb.bodyType === 'dynamic') {
        rb._invMass = rb.mass > 0 ? 1 / rb.mass : 0;
        rb._invInertia = rb.fixedRotation || inertia <= 0 ? 0 : 1 / inertia;
      }
    }
  }

  private collidersOf(world: World, e: Entity): Collider2D[] {
    const out: Collider2D[] = [];
    const a = world.getComponent(e, BoxCollider2D);
    const b = world.getComponent(e, CircleCollider2D);
    const c = world.getComponent(e, PolygonCollider2D);
    if (a) out.push(a);
    if (b) out.push(b);
    if (c) out.push(c);
    return out;
  }

  private minExtent(e: Entity, world: World): number {
    let m = Infinity;
    for (const col of this.collidersOf(world, e)) {
      if (col instanceof CircleCollider2D) m = Math.min(m, col.radius * 2);
      else if (col instanceof BoxCollider2D) m = Math.min(m, col.width, col.height);
      else m = Math.min(m, 0.5);
    }
    return Number.isFinite(m) ? m : 1;
  }

  private pairKey(a: Entity, b: Entity): number {
    return a < b ? a * 4294967296 + b : b * 4294967296 + a;
  }

  private tryContact(pa: Proxy, pb: Proxy): void {
    if (pa.entity === pb.entity) return;
    const A = pa.body, B = pb.body;
    if (A.bodyType !== 'dynamic' && B.bodyType !== 'dynamic') return;
    if (!this.layersCollide(pa.layer, pb.layer)) return;
    if (!A.collidesWithLayer(pb.layer) || !B.collidesWithLayer(pa.layer)) return;
    const m = createManifold();
    if (!collideShapes(pa.shape, pb.shape, m)) return;
    const trigger = pa.isTrigger || pb.isTrigger;
    this.contacts.push({
      a: pa, b: pb, m,
      e: Math.max(pa.restitution, pb.restitution),
      mu: Math.sqrt(pa.friction * pb.friction),
      key: this.pairKey(pa.entity, pb.entity),
      trigger,
    });
    if (!trigger) {
      A.contacts.push({ other: pb.entity, nx: -m.nx, ny: -m.ny });
      B.contacts.push({ other: pa.entity, nx: m.nx, ny: m.ny });
    }
  }

  /** Generate static tile proxies around dynamic bodies and collide with them. */
  private collideTilemaps(world: World): void {
    const tilemaps = world.componentsOfType(TilemapCollider2D);
    if (tilemaps.length === 0) return;
    this.tileProxies.length = 0;
    for (const tc of tilemaps) {
      const tm = world.getComponent(tc.entity, Tilemap);
      const tt = world.getComponent(tc.entity, Transform);
      if (!tm || !tt) continue;
      const ox = tt.worldMatrix.m[12], oy = tt.worldMatrix.m[13];
      const ts = tm.tileSize;
      for (const p of this.proxies) {
        if (p.body.bodyType !== 'dynamic') continue;
        if (!this.layersCollide(p.layer, tc.layer) || !p.body.collidesWithLayer(tc.layer)) continue;
        const minX = Math.floor((p.aabb[0] - ox) / ts), maxX = Math.floor((p.aabb[2] - ox) / ts);
        const minY = Math.floor((oy - p.aabb[3]) / ts), maxY = Math.floor((oy - p.aabb[1]) / ts);
        for (let ty = Math.max(0, minY); ty <= Math.min(tm.height - 1, maxY); ty++) {
          for (let tx = Math.max(0, minX); tx <= Math.min(tm.width - 1, maxX); tx++) {
            if (!tm.isSolid(tx, ty)) continue;
            const cx = ox + tx * ts + ts / 2;
            const cy = oy - ty * ts - ts / 2;
            const shape = transformPolygon(boxPoints(ts, ts), cx, cy, 0, 1, 1, 0, 0);
            const tile: Proxy = {
              id: -1, entity: tc.entity, body: STATIC_BODY, collider: null, shape, isTrigger: false,
              restitution: tc.restitution, friction: tc.friction, layer: tc.layer, aabb: new Float64Array(4),
            };
            shapeAABB(shape, tile.aabb);
            const m = createManifold();
            if (!collideShapes(p.shape, tile.shape, m)) continue;
            this.contacts.push({
              a: p, b: tile, m, e: Math.max(p.restitution, tc.restitution), mu: Math.sqrt(p.friction * tc.friction),
              key: this.pairKey(p.entity, tc.entity), trigger: p.isTrigger,
            });
            if (!p.isTrigger) p.body.contacts.push({ other: tc.entity, nx: -m.nx, ny: -m.ny });
          }
        }
      }
    }
  }

  private prepare(c: Contact, dt: number): void {
    // Resting contacts: disable restitution when the approach speed is small.
    const A = c.a.body, B = c.b.body;
    const rvx = B.velocity.x - A.velocity.x;
    const rvy = B.velocity.y - A.velocity.y;
    const rel = rvx * c.m.nx + rvy * c.m.ny;
    const gStep = Math.hypot(this.gravity.x, this.gravity.y) * dt;
    if (Math.abs(rel) < Math.max(this.restingSpeed, gStep * 2)) c.e = 0;
  }

  private applyImpulse(c: Contact): void {
    const A = c.a.body, B = c.b.body;
    const m = c.m;
    const nx = m.nx, ny = m.ny;
    const invMassSum0 = A._invMass + B._invMass;
    if (invMassSum0 === 0) return;
    for (let k = 0; k < m.count; k++) {
      const rax = m.px[k] - A._px, ray = m.py[k] - A._py;
      const rbx = m.px[k] - B._px, rby = m.py[k] - B._py;
      // Relative velocity at the contact point.
      let rvx = B.velocity.x - B.angularVelocity * rby - A.velocity.x + A.angularVelocity * ray;
      let rvy = B.velocity.y + B.angularVelocity * rbx - A.velocity.y - A.angularVelocity * rax;
      const contactVel = rvx * nx + rvy * ny;
      if (contactVel > 0) continue;
      const raCrossN = rax * ny - ray * nx;
      const rbCrossN = rbx * ny - rby * nx;
      const invMassSum = invMassSum0 + raCrossN * raCrossN * A._invInertia + rbCrossN * rbCrossN * B._invInertia;
      let j = (-(1 + c.e) * contactVel) / invMassSum / m.count;
      const ix = nx * j, iy = ny * j;
      A.velocity.x -= ix * A._invMass; A.velocity.y -= iy * A._invMass;
      A.angularVelocity -= A._invInertia * (rax * iy - ray * ix);
      B.velocity.x += ix * B._invMass; B.velocity.y += iy * B._invMass;
      B.angularVelocity += B._invInertia * (rbx * iy - rby * ix);
      // Friction.
      rvx = B.velocity.x - B.angularVelocity * rby - A.velocity.x + A.angularVelocity * ray;
      rvy = B.velocity.y + B.angularVelocity * rbx - A.velocity.y - A.angularVelocity * rax;
      const dot = rvx * nx + rvy * ny;
      let tx = rvx - nx * dot, ty = rvy - ny * dot;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-9) continue;
      tx /= tl; ty /= tl;
      let jt = -(rvx * tx + rvy * ty) / invMassSum / m.count;
      const maxF = j * c.mu;
      if (jt > maxF) jt = maxF; else if (jt < -maxF) jt = -maxF;
      const fx = tx * jt, fy = ty * jt;
      A.velocity.x -= fx * A._invMass; A.velocity.y -= fy * A._invMass;
      A.angularVelocity -= A._invInertia * (rax * fy - ray * fx);
      B.velocity.x += fx * B._invMass; B.velocity.y += fy * B._invMass;
      B.angularVelocity += B._invInertia * (rbx * fy - rby * fx);
      if (A.fixedRotation) A.angularVelocity = 0;
      if (B.fixedRotation) B.angularVelocity = 0;
    }
  }

  private correctPosition(c: Contact): void {
    const A = c.a.body, B = c.b.body;
    const sum = A._invMass + B._invMass;
    if (sum === 0) return;
    const corr = (Math.max(c.m.penetration - this.slop, 0) / sum) * this.positionCorrection;
    A._px -= c.m.nx * corr * A._invMass; A._py -= c.m.ny * corr * A._invMass;
    B._px += c.m.nx * corr * B._invMass; B._py += c.m.ny * corr * B._invMass;
  }

  private emitEvents(): void {
    const current = new Map<number, CollisionEvent>();
    const currentTriggers = new Map<number, CollisionEvent>();
    for (const c of this.contacts) {
      const target = c.trigger ? currentTriggers : current;
      if (target.has(c.key)) continue;
      const A = c.a.body, B = c.b.body;
      const rel = (B.velocity.x - A.velocity.x) * c.m.nx + (B.velocity.y - A.velocity.y) * c.m.ny;
      target.set(c.key, {
        a: c.a.entity, b: c.b.entity,
        normal: new Vec2(c.m.nx, c.m.ny),
        point: new Vec2(c.m.px[0], c.m.py[0]),
        penetration: c.m.penetration,
        impulse: Math.abs(rel),
      });
    }
    this.diffEvents(this.prevPairs, current, 'collisionEnter', 'collisionStay', 'collisionExit');
    this.diffEvents(this.prevTriggers, currentTriggers, 'triggerEnter', 'triggerStay', 'triggerExit');
    this.prevPairs = current;
    this.prevTriggers = currentTriggers;
  }

  private diffEvents(prev: Map<number, CollisionEvent>, cur: Map<number, CollisionEvent>, enter: keyof PhysicsEvents, stay: keyof PhysicsEvents, exit: keyof PhysicsEvents): void {
    for (const [k, ev] of cur) this.events.emit(prev.has(k) ? stay : enter, ev);
    for (const [k, ev] of prev) if (!cur.has(k)) this.events.emit(exit, ev);
  }

  /** Forget contact history (call when loading a new scene). */
  reset(): void {
    this.prevPairs.clear();
    this.prevTriggers.clear();
    this.contacts.length = 0;
    this.proxies.length = 0;
    this.polyCache.clear();
    this.hash.clear();
  }

  // -------------------------------------------------------------- queries
  // Queries use the proxies from the last `step` (or `refresh`).

  /** Rebuild proxies from the current world state without stepping. */
  refresh(world: World): void {
    const bodies = this.collectBodies(world);
    for (const { rb, t } of bodies) { rb._px = t.position.x; rb._py = t.position.y; rb._angle = t.angle; }
    this.buildProxies(world, bodies);
    this.hash.clear();
    for (const p of this.proxies) this.hash.insert(p.id, p.aabb[0], p.aabb[1], p.aabb[2], p.aabb[3]);
  }

  /** Closest hit along a ray, or null. `mask` filters by body layer bit. */
  raycast(origin: Vec2Like, direction: Vec2Like, maxDistance = Infinity, mask = 0xffffffff, ignore: Entity = 0): RaycastHit2D | null {
    const dl = Math.hypot(direction.x, direction.y) || 1;
    const dx = direction.x / dl, dy = direction.y / dl;
    let best: RaycastHit2D | null = null;
    const n: [number, number] = [0, 0];
    for (const p of this.proxies) {
      if (p.isTrigger || p.entity === ignore || !(mask & (1 << p.layer))) continue;
      const t = raycastShape(p.shape, origin.x, origin.y, dx, dy, maxDistance, n);
      if (t < 0 || (best && t >= best.distance)) continue;
      best = { entity: p.entity, distance: t, point: new Vec2(origin.x + dx * t, origin.y + dy * t), normal: new Vec2(n[0], n[1]) };
    }
    return best;
  }

  /** All hits along a ray sorted by distance. */
  raycastAll(origin: Vec2Like, direction: Vec2Like, maxDistance = Infinity, mask = 0xffffffff): RaycastHit2D[] {
    const dl = Math.hypot(direction.x, direction.y) || 1;
    const dx = direction.x / dl, dy = direction.y / dl;
    const out: RaycastHit2D[] = [];
    const n: [number, number] = [0, 0];
    for (const p of this.proxies) {
      if (p.isTrigger || !(mask & (1 << p.layer))) continue;
      const t = raycastShape(p.shape, origin.x, origin.y, dx, dy, maxDistance, n);
      if (t < 0) continue;
      out.push({ entity: p.entity, distance: t, point: new Vec2(origin.x + dx * t, origin.y + dy * t), normal: new Vec2(n[0], n[1]) });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /** Entities whose colliders overlap a circle. */
  overlapCircle(center: Vec2Like, radius: number, mask = 0xffffffff): Entity[] {
    const ids = this.hash.query(center.x - radius, center.y - radius, center.x + radius, center.y + radius, this.queryBuffer);
    const probe: Shape2D = { kind: 'circle', x: center.x, y: center.y, r: radius };
    const m = createManifold();
    const out = new Set<Entity>();
    for (const id of ids) {
      const p = this.proxies[id];
      if (!(mask & (1 << p.layer))) continue;
      if (collideShapes(probe, p.shape, m)) out.add(p.entity);
    }
    return Array.from(out);
  }

  /** Entities whose colliders overlap an axis-aligned box. */
  overlapBox(center: Vec2Like, width: number, height: number, mask = 0xffffffff): Entity[] {
    const ids = this.hash.query(center.x - width / 2, center.y - height / 2, center.x + width / 2, center.y + height / 2, this.queryBuffer);
    const probe = transformPolygon(boxPoints(width, height), center.x, center.y, 0, 1, 1, 0, 0);
    const m = createManifold();
    const out = new Set<Entity>();
    for (const id of ids) {
      const p = this.proxies[id];
      if (!(mask & (1 << p.layer))) continue;
      if (collideShapes(probe, p.shape, m)) out.add(p.entity);
    }
    return Array.from(out);
  }

  /** Entities containing a point. */
  queryPoint(point: Vec2Like, mask = 0xffffffff): Entity[] {
    const ids = this.hash.query(point.x, point.y, point.x, point.y, this.queryBuffer);
    const out: Entity[] = [];
    for (const id of ids) {
      const p = this.proxies[id];
      if ((mask & (1 << p.layer)) && shapeContains(p.shape, point.x, point.y)) out.push(p.entity);
    }
    return out;
  }

  /** Draw collider outlines via a debug drawer (`(fn) => fn(shape)` style callback). */
  debugShapes(fn: (shape: Shape2D, isTrigger: boolean, entity: Entity) => void): void {
    for (const p of this.proxies) fn(p.shape, p.isTrigger, p.entity);
  }
}

/** Moment of inertia of a convex polygon about its local origin. */
function polygonInertia(points: ArrayLike<number>, mass: number, sx: number, sy: number): number {
  const n = points.length / 2;
  let area = 0;
  let inertia = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = points[i * 2] * sx, y0 = points[i * 2 + 1] * sy;
    const x1 = points[j * 2] * sx, y1 = points[j * 2 + 1] * sy;
    const cross = Math.abs(x0 * y1 - x1 * y0);
    area += cross / 2;
    inertia += cross * (x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1);
  }
  if (area <= 0) return mass;
  return (inertia / 12) * (mass / area);
}

